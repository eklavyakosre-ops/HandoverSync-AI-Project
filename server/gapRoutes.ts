import express, { type Express } from 'express';
import { readDatabase, writeDatabase } from './db.ts';
import {
  buildProjectInventory,
  computeGapSummaryCounts,
  extractProjectMembers,
  normalizeGapSeverity,
  runKnowledgeGapAnalysis,
  type GapAiAnalyzer,
} from './gapEngine.ts';
import type { GapActivity, GapReviewNote, GapStatus } from '../src/types.ts';

export function registerKnowledgeGapRoutes(
  app: Express,
  options?: { analyzer?: GapAiAnalyzer; dbFilePath?: string },
): void {
  const dbFilePath = options?.dbFilePath;
  const analyzer = options?.analyzer;

  // GET /api/projects/:id/knowledge-gaps
  app.get('/api/projects/:id/knowledge-gaps', (req, res) => {
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { sources, inventory } = buildProjectInventory(db, project.id);
    const projectGaps = db.knowledgeGaps.filter((g) => g.projectId === project.id);
    const projectRuns = db.gapAnalysisRuns
      .filter((r) => r.projectId === project.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const latestCompletedRun = projectRuns.find((r) => r.status === 'completed') ?? null;

    res.json({
      projectId: project.id,
      lastAnalyzedAt: latestCompletedRun?.completedAt ?? null,
      latestRun: projectRuns[0] ?? null,
      sourceInventory: inventory,
      summary: computeGapSummaryCounts(projectGaps),
      gaps: projectGaps,
      projectMembers: extractProjectMembers(project, sources),
    });
  });

  // POST /api/projects/:id/knowledge-gaps/analyze
  app.post('/api/projects/:id/knowledge-gaps/analyze', async (req, res) => {
    try {
      const result = await runKnowledgeGapAnalysis({
        projectId: req.params.id,
        analyzer,
        dbFilePath,
      });
      res.status(201).json(result);
    } catch (err: unknown) {
      const statusCode =
        typeof err === 'object' &&
        err !== null &&
        'statusCode' in err &&
        typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
      const message =
        err instanceof Error ? err.message : 'Failed to run knowledge gap analysis.';
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/projects/:id/knowledge-gaps/history
  app.get('/api/projects/:id/knowledge-gaps/history', (req, res) => {
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const runs = db.gapAnalysisRuns
      .filter((r) => r.projectId === project.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    res.json({ projectId: project.id, runs });
  });

  // GET /api/knowledge-gaps/:gapId
  app.get('/api/knowledge-gaps/:gapId', (req, res) => {
    const db = readDatabase(dbFilePath);
    const gap = db.knowledgeGaps.find((g) => g.id === req.params.gapId);
    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    const scopedProjectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (scopedProjectId && gap.projectId !== scopedProjectId) {
      res.status(403).json({ error: 'Cross-project gap access is forbidden.' });
      return;
    }

    const relatedSources = db.sources.filter(
      (s) => s.projectId === gap.projectId && gap.relevantSourceIds.includes(s.id),
    );

    res.json({ gap, relatedSources });
  });

  // PATCH /api/knowledge-gaps/:gapId
  app.patch('/api/knowledge-gaps/:gapId', (req, res) => {
    const db = readDatabase(dbFilePath);
    const gap = db.knowledgeGaps.find((g) => g.id === req.params.gapId);
    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    const { projectId, severity, suggestedAction, title, description } = req.body as {
      projectId?: string;
      severity?: string;
      suggestedAction?: string;
      title?: string;
      description?: string;
    };

    if (projectId && gap.projectId !== projectId) {
      res.status(403).json({ error: 'Cross-project modification is forbidden.' });
      return;
    }

    if (typeof title === 'string' && title.trim()) gap.title = title.trim();
    if (typeof description === 'string' && description.trim()) gap.description = description.trim();
    if (typeof suggestedAction === 'string' && suggestedAction.trim()) {
      gap.suggestedAction = suggestedAction.trim();
    }
    if (typeof severity === 'string' && severity.trim()) {
      gap.severity = normalizeGapSeverity(severity);
    }

    gap.updatedAt = new Date().toISOString();
    writeDatabase(db, dbFilePath);

    const projectGaps = db.knowledgeGaps.filter((g) => g.projectId === gap.projectId);
    res.json({ gap, summary: computeGapSummaryCounts(projectGaps) });
  });

  // POST /api/knowledge-gaps/:gapId/notes
  app.post('/api/knowledge-gaps/:gapId/notes', (req, res) => {
    const db = readDatabase(dbFilePath);
    const gap = db.knowledgeGaps.find((g) => g.id === req.params.gapId);
    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    const { projectId, author, authorRole, content } = req.body as {
      projectId?: string;
      author?: string;
      authorRole?: string;
      content?: string;
    };

    if (projectId && gap.projectId !== projectId) {
      res.status(403).json({ error: 'Cross-project modification is forbidden.' });
      return;
    }

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Review note content is required.' });
      return;
    }

    const safeAuthor = author?.trim() || 'Human Reviewer';
    const safeRole = authorRole?.trim() || 'Reviewer';
    const now = new Date().toISOString();

    const note: GapReviewNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: safeAuthor,
      authorRole: safeRole,
      content: content.trim(),
      createdAt: now,
    };

    gap.reviewNotes.push(note);
    gap.updatedAt = now;
    const activity: GapActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'note_added',
      actor: safeAuthor,
      timestamp: now,
      details: `Added review note: "${content.trim().slice(0, 120)}${content.trim().length > 120 ? '...' : ''}"`,
    };
    gap.activityHistory.unshift(activity);

    writeDatabase(db, dbFilePath);
    res.status(201).json({ gap, note });
  });

  // POST /api/knowledge-gaps/:gapId/assign
  app.post('/api/knowledge-gaps/:gapId/assign', (req, res) => {
    const db = readDatabase(dbFilePath);
    const gap = db.knowledgeGaps.find((g) => g.id === req.params.gapId);
    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    const { projectId, owner, actor } = req.body as {
      projectId?: string;
      owner?: string;
      actor?: string;
    };

    if (projectId && gap.projectId !== projectId) {
      res.status(403).json({ error: 'Cross-project modification is forbidden.' });
      return;
    }

    if (!owner || !owner.trim()) {
      res.status(400).json({ error: 'Assigned owner name is required.' });
      return;
    }

    const now = new Date().toISOString();
    const safeOwner = owner.trim();
    const safeActor = actor?.trim() || 'Human Reviewer';

    gap.assignedOwner = safeOwner;
    gap.humanOwnerLocked = true;
    gap.updatedAt = now;
    gap.activityHistory.unshift({
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action: 'assigned_owner',
      actor: safeActor,
      timestamp: now,
      details: `Assigned gap owner to ${safeOwner}.`,
    });

    writeDatabase(db, dbFilePath);
    res.json({ gap });
  });

  // POST /api/knowledge-gaps/:gapId/review
  app.post('/api/knowledge-gaps/:gapId/review', (req, res) => {
    const db = readDatabase(dbFilePath);
    const gap = db.knowledgeGaps.find((g) => g.id === req.params.gapId);
    if (!gap) {
      res.status(404).json({ error: 'Knowledge gap not found.' });
      return;
    }

    const { projectId, status, reason, actor, confirmed } = req.body as {
      projectId?: string;
      status?: GapStatus;
      reason?: string;
      actor?: string;
      confirmed?: boolean;
    };

    if (projectId && gap.projectId !== projectId) {
      res.status(403).json({ error: 'Cross-project modification is forbidden.' });
      return;
    }

    const allowedStatuses: GapStatus[] = ['Open', 'In Progress', 'Resolved', 'Not a Gap'];
    if (!status || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Valid review status is required.' });
      return;
    }

    const safeActor = actor?.trim() || 'Human Reviewer';
    const now = new Date().toISOString();

    if (status === 'Resolved') {
      if (!confirmed) {
        res.status(400).json({ error: 'Human confirmation is required to mark a gap Resolved.' });
        return;
      }
      if (!reason || !reason.trim()) {
        res.status(400).json({ error: 'Resolution explanation is required when marking Resolved.' });
        return;
      }
      gap.status = 'Resolved';
      gap.humanStatusLocked = true;
      gap.resolutionReason = reason.trim();
      gap.resolvedBy = safeActor;
      gap.resolvedAt = now;
      gap.activityHistory.unshift({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: 'resolved',
        actor: safeActor,
        timestamp: now,
        details: `Marked Resolved: "${reason.trim()}"`,
      });
    } else if (status === 'Not a Gap') {
      if (!reason || !reason.trim()) {
        res.status(400).json({ error: 'A human explanation is required when marking Not a Gap.' });
        return;
      }
      gap.status = 'Not a Gap';
      gap.humanStatusLocked = true;
      gap.dismissalReason = reason.trim();
      gap.dismissedBy = safeActor;
      gap.dismissedAt = now;
      gap.activityHistory.unshift({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: 'dismissed',
        actor: safeActor,
        timestamp: now,
        details: `Marked Not a Gap (retained for audit): "${reason.trim()}"`,
      });
    } else {
      const previous = gap.status;
      gap.status = status;
      gap.humanStatusLocked = true;
      gap.activityHistory.unshift({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: 'status_changed',
        actor: safeActor,
        timestamp: now,
        details: `Changed status from ${previous} to ${status}${reason?.trim() ? ` — "${reason.trim()}"` : ''}.`,
      });
    }

    gap.updatedAt = now;
    writeDatabase(db, dbFilePath);

    const projectGaps = db.knowledgeGaps.filter((g) => g.projectId === gap.projectId);
    res.json({
      gap,
      summary: computeGapSummaryCounts(projectGaps),
    });
  });
}

export function createKnowledgeGapTestApp(options?: {
  analyzer?: GapAiAnalyzer;
  dbFilePath?: string;
}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerKnowledgeGapRoutes(app, options);
  return app;
}
