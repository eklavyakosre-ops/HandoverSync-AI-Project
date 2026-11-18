import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { readDatabase, writeDatabase } from '../server/db.ts';
import { createSeedDatabase } from '../server/seedData.ts';
import { BOT_NAME, type SyncBotAiResponder } from '../server/botEngine.ts';
import { createBotTestApp } from '../server/botRoutes.ts';
import type {
  BotConversationsListResponse,
  QaConversation,
  QaMessage,
} from '../src/types.ts';

let tempDir: string;
let dbFilePath: string;
let server: http.Server | null = null;
let baseUrl = '';

async function startBotServer(responder: SyncBotAiResponder) {
  const app = createBotTestApp({ responder, dbFilePath });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoversync-syncbot-test-'));
  dbFilePath = path.join(tempDir, 'test_db.json');
  const seeded = createSeedDatabase();
  seeded.integrationSecrets = {
    github: {
      provider: 'github',
      accessToken: 'ghp_super_secret_token_should_never_leak',
      updatedAt: '2026-11-18T00:00:00Z',
    },
  };
  writeDatabase(seeded, dbFilePath);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('SyncBot — Dedicated Project Chat Assistant', () => {
  test('answers project questions with verified citations, protects secrets, isolates projects, and persists botConversations separately from qaConversations', async () => {
    let seenProjectIds: string[] = [];
    let leakedSecret = false;

    const responder: SyncBotAiResponder = async ({
      project,
      workspaceProjectsSummary,
      projectOverviewSummary,
      retrievedChunks,
    }) => {
      seenProjectIds = Array.from(new Set(retrievedChunks.map((c) => c.chunk.projectId)));
      const serialized = JSON.stringify({
        workspaceProjectsSummary,
        projectOverviewSummary,
        retrievedChunks,
      });
      if (serialized.includes('ghp_super_secret_token_should_never_leak')) {
        leakedSecret = true;
      }

      const targetRef =
        retrievedChunks.find((c) => c.chunk.sourceId === 'src-pay-github')?.refId ??
        retrievedChunks[0].refId;

      return {
        sufficientEvidence: true,
        reply: `${project.name} (${project.code}) is being handed over from ${project.outgoingLead.name} to ${project.incomingOwner.name}. The main blocker is 3DS2 challenge testing in GitHub Issue #24 [${targetRef}].`,
        keyPoints: [
          `Outgoing Lead: ${project.outgoingLead.name} -> Incoming Owner: ${project.incomingOwner.name} [C1]`,
          `GitHub Issue #24 tracks the 3DS2 race condition [${targetRef}]`,
        ],
        citedRefs: [
          { refId: 'C1', snippet: `Project: ${project.name} (${project.code})` },
          { refId: targetRef, snippet: '3DS2 challenge callback race condition under high latency' },
        ],
      };
    };

    await startBotServer(responder);

    // 1. Fetch initial SyncBot state
    const listRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/bot/conversations`);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as BotConversationsListResponse;
    assert.equal(listData.botName, BOT_NAME);
    assert.equal(listData.projectId, 'proj-checkout-v3');
    assert.ok(listData.suggestedPrompts.length > 0);

    // 2. Create conversation
    const createRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/bot/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ createdBy: 'Priya Nair' }),
    });
    assert.equal(createRes.status, 201);
    const { conversation } = (await createRes.json()) as { conversation: QaConversation };
    assert.equal(conversation.projectId, 'proj-checkout-v3');

    // 3. Ask SyncBot about the project
    const msgRes = await fetch(`${baseUrl}/api/bot/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        message: 'Is project ke bare me batao aur main blocker kya hai?',
        author: 'Priya Nair',
      }),
    });
    assert.equal(msgRes.status, 201);
    const msgPayload = (await msgRes.json()) as {
      conversation: QaConversation;
      userMessage: QaMessage;
      assistantMessage: QaMessage;
    };

    assert.deepEqual(seenProjectIds, ['proj-checkout-v3']);
    assert.equal(leakedSecret, false);
    assert.equal(msgPayload.assistantMessage.author, BOT_NAME);
    assert.ok(msgPayload.assistantMessage.citations.length >= 1);
    assert.ok(msgPayload.assistantMessage.content.includes('[1]') || msgPayload.assistantMessage.content.includes('[2]'));

    // 4. Verify separate persistence in botConversations (not qaConversations)
    const savedDb = readDatabase(dbFilePath);
    assert.equal(savedDb.botConversations?.length, 1);
    assert.equal(savedDb.qaConversations.length, 0);

    // 5. Cross-project isolation check
    const crossGet = await fetch(
      `${baseUrl}/api/bot/conversations/${conversation.id}?projectId=proj-sso-rbac`,
    );
    assert.equal(crossGet.status, 403);

    const crossPost = await fetch(`${baseUrl}/api/bot/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-sso-rbac',
        message: 'Trying to query wrong project',
      }),
    });
    assert.equal(crossPost.status, 403);

    const crossDel = await fetch(
      `${baseUrl}/api/bot/conversations/${conversation.id}?projectId=proj-sso-rbac`,
      { method: 'DELETE' },
    );
    assert.equal(crossDel.status, 403);

    // 6. Delete conversation cleanly
    const delRes = await fetch(
      `${baseUrl}/api/bot/conversations/${conversation.id}?projectId=proj-checkout-v3`,
      { method: 'DELETE' },
    );
    assert.equal(delRes.status, 200);
    assert.equal((readDatabase(dbFilePath).botConversations ?? []).length, 0);
  });
});
