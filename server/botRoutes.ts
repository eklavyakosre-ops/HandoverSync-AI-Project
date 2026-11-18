import express, { type Express } from 'express';
import { readDatabase, writeDatabase } from './db.ts';
import {
  BOT_NAME,
  answerWithSyncBot,
  buildBotContextSummary,
  buildBotSuggestedPrompts,
  type SyncBotAiResponder,
} from './botEngine.ts';
import type { QaConversation, QaMessage } from '../src/types.ts';

function deriveChatTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 58) return cleaned;
  return `${cleaned.slice(0, 55)}...`;
}

export function registerBotRoutes(
  app: Express,
  options?: { responder?: SyncBotAiResponder; dbFilePath?: string },
): void {
  const dbFilePath = options?.dbFilePath;
  const responder = options?.responder;

  // GET /api/projects/:id/bot/conversations
  app.get('/api/projects/:id/bot/conversations', (req, res) => {
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const conversations = (db.botConversations ?? [])
      .filter((c) => c.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      botName: BOT_NAME,
      projectId: project.id,
      projectContextSummary: buildBotContextSummary(db, project.id),
      suggestedPrompts: buildBotSuggestedPrompts(project, db),
      conversations,
    });
  });

  // POST /api/projects/:id/bot/conversations
  app.post('/api/projects/:id/bot/conversations', (req, res) => {
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
      id: `botconv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      projectId: project.id,
      title: title?.trim() || `Chat with ${BOT_NAME}`,
      createdBy: createdBy?.trim() || project.incomingOwner.name,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    if (!Array.isArray(db.botConversations)) {
      db.botConversations = [];
    }
    db.botConversations.unshift(conversation);
    writeDatabase(db, dbFilePath);

    res.status(201).json({ conversation });
  });

  // GET /api/bot/conversations/:conversationId
  app.get('/api/bot/conversations/:conversationId', (req, res) => {
    const db = readDatabase(dbFilePath);
    const conversation = (db.botConversations ?? []).find(
      (c) => c.id === req.params.conversationId,
    );
    if (!conversation) {
      res.status(404).json({ error: 'Chat conversation not found.' });
      return;
    }

    const scopedProjectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (scopedProjectId && conversation.projectId !== scopedProjectId) {
      res.status(403).json({ error: 'Cross-project chatbot access is forbidden.' });
      return;
    }

    res.json({
      conversation: {
        ...conversation,
        messages: conversation.messages.filter((m) => m.projectId === conversation.projectId),
      },
    });
  });

  // POST /api/bot/conversations/:conversationId/messages
  app.post('/api/bot/conversations/:conversationId/messages', async (req, res) => {
    const db = readDatabase(dbFilePath);
    if (!Array.isArray(db.botConversations)) {
      db.botConversations = [];
    }

    const conversation = db.botConversations.find(
      (c) => c.id === req.params.conversationId,
    );
    if (!conversation) {
      res.status(404).json({ error: 'Chat conversation not found.' });
      return;
    }

    const { projectId, message, author } = (req.body ?? {}) as {
      projectId?: string;
      message?: string;
      author?: string;
    };

    if (projectId && projectId !== conversation.projectId) {
      res.status(403).json({ error: 'Cross-project chatbot message submission is forbidden.' });
      return;
    }

    if (!message || !message.trim()) {
      res.status(400).json({ error: 'A non-empty message is required.' });
      return;
    }

    const project = db.projects.find((p) => p.id === conversation.projectId);
    if (!project) {
      res.status(404).json({ error: 'Associated project not found.' });
      return;
    }

    const cleanMessage = message.trim();
    const recentHistory = conversation.messages
      .filter((m) => m.projectId === project.id)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const generated = await answerWithSyncBot({
        db,
        project,
        message: cleanMessage,
        recentHistory,
        responder,
      });

      const userTime = new Date().toISOString();
      const userMessage: QaMessage = {
        id: `botmsg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conversation.id,
        projectId: project.id,
        role: 'user',
        author: author?.trim() || project.incomingOwner.name,
        content: cleanMessage,
        citations: [],
        createdAt: userTime,
      };

      const assistantTime = new Date(Date.now() + 1).toISOString();
      const assistantMessage: QaMessage = {
        id: `botmsg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId: conversation.id,
        projectId: project.id,
        role: 'assistant',
        author: BOT_NAME,
        content: generated.content,
        sections: generated.sections,
        citations: generated.citations,
        insufficientEvidence: generated.insufficientEvidence,
        ...(generated.missingDetails ? { missingDetails: generated.missingDetails } : {}),
        createdAt: assistantTime,
      };

      if (
        conversation.messages.length === 0 &&
        (!conversation.title || conversation.title === `Chat with ${BOT_NAME}`)
      ) {
        conversation.title = deriveChatTitle(cleanMessage);
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
      const errMsg = err instanceof Error ? err.message : `${BOT_NAME} failed to respond.`;
      res.status(statusCode).json({ error: errMsg });
    }
  });

  // DELETE /api/bot/conversations/:conversationId
  app.delete('/api/bot/conversations/:conversationId', (req, res) => {
    const db = readDatabase(dbFilePath);
    if (!Array.isArray(db.botConversations)) {
      res.status(404).json({ error: 'Chat conversation not found.' });
      return;
    }

    const idx = db.botConversations.findIndex((c) => c.id === req.params.conversationId);
    if (idx === -1) {
      res.status(404).json({ error: 'Chat conversation not found.' });
      return;
    }

    const scopedProjectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (scopedProjectId && db.botConversations[idx].projectId !== scopedProjectId) {
      res.status(403).json({ error: 'Cross-project chatbot deletion is forbidden.' });
      return;
    }

    db.botConversations.splice(idx, 1);
    writeDatabase(db, dbFilePath);
    res.json({ deleted: true });
  });
}

export function createBotTestApp(options?: {
  responder?: SyncBotAiResponder;
  dbFilePath?: string;
}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  registerBotRoutes(app, options);
  return app;
}
