import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { readDatabase, writeDatabase } from './server/db.ts';
import { generateHandoverWithAI } from './server/aiAgent.ts';
import type {
  ActivitySource,
  HandoverApprovalStatus,
  HandoverPack,
  ProjectSummaryDTO,
  SourceKind,
} from './src/types.ts';

const PORT = 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));

function buildProjectSummary(
  projectId: string,
  db = readDatabase(),
): ProjectSummaryDTO | null {
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;

  const projectSources = db.sources.filter((s) => s.projectId === project.id);
  const breakdown: Record<SourceKind, number> = {
    csv: 0,
    docs: 0,
    github: 0,
    pdf: 0,
  };
  for (const s of projectSources) {
    breakdown[s.kind] = (breakdown[s.kind] || 0) + 1;
  }

  const projectHandovers = db.handovers
    .filter((h) => h.projectId === project.id)
    .sort((a, b) => b.version - a.version);

  return {
    ...project,
    sourceCount: projectSources.length,
    sourceBreakdown: breakdown,
    latestHandover: projectHandovers[0] ?? null,
    historyCount: projectHandovers.length,
  };
}

function estimateRecordCount(kind: SourceKind, content: string): number {
  if (kind === 'csv') {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return Math.max(1, lines.length - 1);
  }
  if (kind === 'github') {
    try {
      const parsed = JSON.parse(content) as {
        issues?: unknown[];
        pullRequests?: unknown[];
        commits?: unknown[];
      };
      const total =
        (parsed.issues?.length ?? 0) +
        (parsed.pullRequests?.length ?? 0) +
        (parsed.commits?.length ?? 0);
      return total > 0 ? total : 1;
    } catch {
      return Math.max(1, content.split(/\r?\n/).filter((l) => l.trim()).length);
    }
  }
  if (kind === 'pdf') return 1;
  return Math.max(1, content.split(/\n\s*\n/).filter((b) => b.trim()).length);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'handoversync-api' });
});

app.get('/api/projects', (_req, res) => {
  const db = readDatabase();
  const summaries = db.projects
    .map((p) => buildProjectSummary(p.id, db))
    .filter((p): p is ProjectSummaryDTO => p !== null);
  res.json({ projects: summaries });
});

app.get('/api/projects/:id', (req, res) => {
  const db = readDatabase();
  const summary = buildProjectSummary(req.params.id, db);
  if (!summary) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const sources = db.sources.filter((s) => s.projectId === summary.id);
  const handovers = db.handovers
    .filter((h) => h.projectId === summary.id)
    .sort((a, b) => b.version - a.version);

  res.json({
    project: summary,
    sources,
    handovers,
  });
});

app.post('/api/projects/:id/sources', (req, res) => {
  const db = readDatabase();
  const project = db.projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const {
    title,
    kind,
    fileName,
    addedBy,
    content,
    base64Data,
    mimeType,
  } = req.body as {
    title?: string;
    kind?: SourceKind;
    fileName?: string;
    addedBy?: string;
    content?: string;
    base64Data?: string;
    mimeType?: string;
  };

  if (!fileName || !kind) {
    res.status(400).json({ error: 'fileName and kind are required.' });
    return;
  }

  if (kind !== 'pdf' && (!content || !content.trim())) {
    res.status(400).json({ error: 'Text content is required for non-PDF sources.' });
    return;
  }

  if (kind === 'pdf' && !base64Data) {
    res.status(400).json({ error: 'base64Data is required for PDF sources.' });
    return;
  }

  const safeContent = content ?? `Uploaded PDF document: ${fileName}`;
  const newSource: ActivitySource = {
    id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    title: title?.trim() || fileName,
    kind,
    fileName: fileName.trim(),
    addedBy: addedBy?.trim() || project.outgoingLead.name,
    addedAt: new Date().toISOString(),
    recordCount: estimateRecordCount(kind, safeContent),
    content: safeContent,
    ...(base64Data ? { base64Data, mimeType: mimeType || 'application/pdf' } : {}),
  };

  db.sources.unshift(newSource);
  project.updatedAt = new Date().toISOString();
  writeDatabase(db);

  res.status(201).json({ source: newSource });
});

app.delete('/api/projects/:id/sources/:sourceId', (req, res) => {
  const db = readDatabase();
  const idx = db.sources.findIndex(
    (s) => s.id === req.params.sourceId && s.projectId === req.params.id,
  );
  if (idx === -1) {
    res.status(404).json({ error: 'Source not found' });
    return;
  }
  db.sources.splice(idx, 1);
  writeDatabase(db);
  res.json({ deleted: true });
});

app.post('/api/generate-handover', async (req, res) => {
  const { projectId, selectedSourceIds, focusInstructions } = req.body as {
    projectId?: string;
    selectedSourceIds?: string[];
    focusInstructions?: string;
  };

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required.' });
    return;
  }

  const db = readDatabase();
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  let projectSources = db.sources.filter((s) => s.projectId === projectId);
  if (selectedSourceIds && selectedSourceIds.length > 0) {
    const idSet = new Set(selectedSourceIds);
    projectSources = projectSources.filter((s) => idSet.has(s.id));
  }

  if (projectSources.length === 0) {
    res.status(400).json({ error: 'At least one activity source must be selected.' });
    return;
  }

  const existingVersions = db.handovers
    .filter((h) => h.projectId === projectId)
    .map((h) => h.version);
  const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

  try {
    const handover = await generateHandoverWithAI({
      project,
      sources: projectSources,
      version: nextVersion,
      focusInstructions,
    });

    db.handovers.unshift(handover);
    project.healthState = 'Ready for Review';
    project.updatedAt = new Date().toISOString();
    writeDatabase(db);

    res.status(201).json({ handover });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate handover pack with Gemini AI.';
    console.error('[generate-handover] AI error:', err);
    res.status(500).json({ error: message });
  }
});

app.patch('/api/handovers/:handoverId', (req, res) => {
  const db = readDatabase();
  const handover = db.handovers.find((h) => h.id === req.params.handoverId);
  if (!handover) {
    res.status(404).json({ error: 'Handover pack not found.' });
    return;
  }

  const updates = req.body as Partial<
    Pick<
      HandoverPack,
      | 'projectSummary'
      | 'completedTasks'
      | 'pendingTasks'
      | 'deadlines'
      | 'importantFiles'
      | 'risksAndNotes'
    >
  >;

  if (updates.projectSummary) handover.projectSummary = updates.projectSummary;
  if (updates.completedTasks) handover.completedTasks = updates.completedTasks;
  if (updates.pendingTasks) handover.pendingTasks = updates.pendingTasks;
  if (updates.deadlines) handover.deadlines = updates.deadlines;
  if (updates.importantFiles) handover.importantFiles = updates.importantFiles;
  if (updates.risksAndNotes) handover.risksAndNotes = updates.risksAndNotes;

  const project = db.projects.find((p) => p.id === handover.projectId);
  if (project) {
    project.updatedAt = new Date().toISOString();
  }

  writeDatabase(db);
  res.json({ handover });
});

app.post('/api/handovers/:handoverId/approve', (req, res) => {
  const db = readDatabase();
  const handover = db.handovers.find((h) => h.id === req.params.handoverId);
  if (!handover) {
    res.status(404).json({ error: 'Handover pack not found.' });
    return;
  }

  const {
    decision,
    reviewerName,
    reviewerRole,
    comments,
    editedFields,
  } = req.body as {
    decision?: HandoverApprovalStatus;
    reviewerName?: string;
    reviewerRole?: string;
    comments?: string;
    editedFields?: string[];
  };

  const finalDecision: HandoverApprovalStatus =
    decision === 'changes_requested' ? 'changes_requested' : 'approved';

  handover.status = finalDecision;
  handover.humanReview = {
    reviewerName: reviewerName?.trim() || 'Priya Nair',
    reviewerRole: reviewerRole?.trim() || 'Incoming Engineering Manager',
    reviewedAt: new Date().toISOString(),
    decision: finalDecision,
    comments: comments?.trim() || 'Reviewed and verified against source evidence.',
    editedFields: editedFields ?? [],
  };

  const project = db.projects.find((p) => p.id === handover.projectId);
  if (project) {
    project.healthState =
      finalDecision === 'approved' ? 'Approved' : 'Drafting';
    project.updatedAt = new Date().toISOString();
  }

  writeDatabase(db);
  res.json({ handover, project });
});

app.get('/api/history', (_req, res) => {
  const db = readDatabase();
  const entries = db.handovers
    .map((h) => {
      const project = db.projects.find((p) => p.id === h.projectId);
      return {
        handover: h,
        projectName: project?.name ?? 'Unknown Project',
        projectCode: project?.code ?? 'N/A',
        outgoingLead: project?.outgoingLead.name ?? 'N/A',
        incomingOwner: project?.incomingOwner.name ?? 'N/A',
      };
    })
    .sort(
      (a, b) =>
        new Date(b.handover.generatedAt).getTime() -
        new Date(a.handover.generatedAt).getTime(),
    );

  res.json({ history: entries });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HandoverSync AI server listening on http://localhost:${PORT}`);
  });
}

startServer();
