import express, { type Express } from 'express';
import { readDatabase, writeDatabase } from './db.ts';
import {
  answerProjectQuestion,
  buildProjectEvidenceIndex,
  buildSuggestedQuestions,
  type QaAiResponder,
} from './qaEngine.ts';
import type { QaConversation, QaMessage } from '../src/types.ts';

function deriveConversationTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 64) return cleaned;
  return `${cleaned.slice(0, 61)}...`;
}

export function registerQaRoutes(
  app: Express,
  options?: { responder?: QaAiResponder; dbFilePath?: string },
): void {
  const dbFilePath = options?.dbFilePath;
  const responder = options?.responder;

  // GET /api/projects/:id/qa/conversations
  app.get('/api/projects/:id/qa/conversations', (req, res) => {
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { sourceSummary } = buildProjectEvidenceIndex(db, project.id);
    const suggestedQuestions = buildSuggestedQuestions(project, db);
    const conversations = db.qaConversations
      .filter((c) => c.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      projectId: project.id,
      sourceSummary,
      suggestedQuestions,
      conversations,
    });
  });

  // POST /api/projects/:id/qa/conversations
  app.post('/api/projects/:id/qa/conversations', (req, res) => {
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { title, createdBy } = (req.body ?? {}) as {
      title?: string;
      createdBy?: string;
    };

    const now = new Date().toISOString();
    const conversation: QaConversation = {
      id: `qaconv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      projectId: project.id,
      title: title?.trim() || 'New Handover Q&A',
      createdBy: createdBy?.trim() || project.incomingOwner.name,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    db.qaConversations.unshift(conversation);
    writeDatabase(db, dbFilePath);

    res.status(201).json({ conversation });
  });

  // GET /api/qa/conversations/:conversationId
  app.get('/api/qa/conversations/:conversationId', (req, res) => {
    const db = readDatabase(dbFilePath);
    const conversation = db.qaConversations.find(
      (c) => c.id === req.params.conversationId,
    );
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const scopedProjectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (scopedProjectId && conversation.projectId !== scopedProjectId) {
      res.status(403).json({ error: 'Cross-project Q&A conversation access is forbidden.' });
      return;
    }

    const sanitized: QaConversation = {
      ...conversation,
      messages: conversation.messages.filter((m) => m.projectId === conversation.projectId),
    };

    res.json({ conversation: sanitized });
  });

  // POST /api/qa/conversations/:conversationId/messages
  app.post('/api/qa/conversations/:conversationId/messages', async (req, res) => {
    const db = readDatabase(dbFilePath);
    const conversation = db.qaConversations.find(
      (c) => c.id === req.params.conversationId,
    );
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const { projectId, question, author } = (req.body ?? {}) as {
      projectId?: string;
      question?: string;
      author?: string;
    };

    if (projectId && projectId !== conversation.projectId) {
      res.status(403).json({ error: 'Cross-project Q&A message submission is forbidden.' });
      return;
    }

    if (!question || !question.trim()) {
      res.status(400).json({ error: 'A non-empty question is required.' });
      return;
    }

    const project = db.projects.find((p) => p.id === conversation.projectId);
    if (!project) {
      res.status(404).json({ error: 'Associated project not found.' });
      return;
    }

    const cleanQuestion = question.trim();
    const recentHistory = conversation.messages
      .filter((m) => m.projectId === project.id)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const generated = await answerProjectQuestion({
        db,
        project,
        question: cleanQuestion,
        recentHistory,
        responder,
      });

      const userTime = new Date().toISOString();
      const userMessage: QaMessage = {
        id: `qamsg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conversation.id,
        projectId: project.id,
        role: 'user',
        author: author?.trim() || project.incomingOwner.name,
        content: cleanQuestion,
        citations: [],
        createdAt: userTime,
      };

      const assistantTime = new Date(Date.now() + 1).toISOString();
      const assistantMessage: QaMessage = {
        id: `qamsg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conversation.id,
        projectId: project.id,
        role: 'assistant',
        author: 'HandoverSync Q&A',
        content: generated.content,
        sections: generated.sections,
        citations: generated.citations,
        insufficientEvidence: generated.insufficientEvidence,
        ...(generated.missingDetails ? { missingDetails: generated.missingDetails } : {}),
        createdAt: assistantTime,
      };

      if (
        conversation.messages.length === 0 &&
        (!conversation.title || conversation.title === 'New Handover Q&A')
      ) {
        conversation.title = deriveConversationTitle(cleanQuestion);
      }

      conversation.messages.push(userMessage, assistantMessage);
      conversation.updatedAt = assistantTime;
      writeDatabase(db, dbFilePath);

      res.status(201).json({
        conversation,
        userMessage,
        assistantMessage,
      });
    } catch (err: unknown) {
      const statusCode =
        typeof err === 'object' &&
        err !== null &&
        'statusCode' in err &&
        typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
      const message =
        err instanceof Error ? err.message : 'Failed to generate evidence-cited answer.';
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/qa/messages/:messageId/evidence
  app.get('/api/qa/messages/:messageId/evidence', (req, res) => {
    const db = readDatabase(dbFilePath);
    let matchedConversation: QaConversation | undefined;
    let matchedMessage: QaMessage | undefined;

    for (const conv of db.qaConversations) {
      const msg = conv.messages.find((m) => m.id === req.params.messageId);
      if (msg) {
        matchedConversation = conv;
        matchedMessage = msg;
        break;
      }
    }

    if (!matchedConversation || !matchedMessage) {
      res.status(404).json({ error: 'Q&A message not found.' });
      return;
    }

    const scopedProjectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (
      scopedProjectId &&
      (matchedMessage.projectId !== scopedProjectId ||
        matchedConversation.projectId !== scopedProjectId)
    ) {
      res.status(403).json({ error: 'Cross-project evidence access is forbidden.' });
      return;
    }

    const citedSourceIds = new Set(matchedMessage.citations.map((c) => c.sourceId));
    const projectSources = db.sources.filter(
      (s) => s.projectId === matchedMessage!.projectId && citedSourceIds.has(s.id),
    );

    res.json({
      messageId: matchedMessage.id,
      conversationId: matchedConversation.id,
      projectId: matchedMessage.projectId,
      citations: matchedMessage.citations,
      sources: projectSources,
    });
  });
}

export function createQaTestApp(options?: {
  responder?: QaAiResponder;
  dbFilePath?: string;
}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerQaRoutes(app, options);
  return app;
}
