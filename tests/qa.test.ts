import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { readDatabase, writeDatabase } from '../server/db.ts';
import { createSeedDatabase } from '../server/seedData.ts';
import { AiProviderError } from '../server/gapEngine.ts';
import { INSUFFICIENT_EVIDENCE_MESSAGE, type QaAiResponder } from '../server/qaEngine.ts';
import { createQaTestApp } from '../server/qaRoutes.ts';
import type {
  ActivitySource,
  KnowledgeGap,
  QaCitation,
  QaConversation,
  QaConversationsListResponse,
  QaMessage,
} from '../src/types.ts';

let tempDir: string;
let dbFilePath: string;
let server: http.Server | null = null;
let baseUrl = '';

async function startQaServer(responder: QaAiResponder) {
  const app = createQaTestApp({ responder, dbFilePath });
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoversync-qa-test-'));
  dbFilePath = path.join(tempDir, 'test_db.json');
  writeDatabase(createSeedDatabase(), dbFilePath);
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Promise 2 — Evidence-Cited Handover Q&A', () => {
  test('1, 2, 3, 4, 8: grounded answer with validated & remapped citations, evidence API, and cross-project isolation', async () => {
    let seenChunkProjectIds: string[] = [];
    let seenSourceIds: string[] = [];

    const responder: QaAiResponder = async ({ project, retrievedChunks }) => {
      seenChunkProjectIds = Array.from(new Set(retrievedChunks.map((c) => c.chunk.projectId)));
      seenSourceIds = Array.from(new Set(retrievedChunks.map((c) => c.chunk.sourceId)));

      // Pick an authentic CSV or GitHub chunk from retrievedChunks
      const pay404 = retrievedChunks.find((c) => c.chunk.text.includes('PAY-404')) ?? retrievedChunks[0];
      const issue24 = retrievedChunks.find((c) => c.chunk.text.includes('Issue #24') || c.chunk.sourceType === 'github') ?? retrievedChunks[1];

      return {
        sufficientEvidence: true,
        answer: `Webhook retry backoff and DLQ handling remain blocked under PAY-404 [${pay404.refId}] and GitHub Issue #24 [${issue24.refId}], plus fabricated [C999] which must be stripped.`,
        sections: [
          {
            heading: 'Direct Project Evidence',
            kind: 'direct_evidence',
            body: `PAY-404 is marked Blocked [${pay404.refId}] and Issue #24 tracks the DLQ replay problem [${issue24.refId}].`,
          },
          {
            heading: 'Recommended Next Step',
            kind: 'interpretation',
            body: `Prioritize resolving [${pay404.refId}] before the ${project.targetExitDate} exit target.`,
          },
        ],
        citedRefs: [
          {
            refId: pay404.refId,
            snippet: 'PAY-404 | Finish Stripe webhook retry backoff and DLQ handler | Blocked',
          },
          {
            refId: issue24.refId,
            snippet: 'Stripe webhook timeout on 3DS callback causes duplicate retry',
          },
          {
            // Fabricated refId must be rejected by backend validator
            refId: 'C999',
            snippet: 'Hallucinated source reference that does not exist',
          },
        ],
      };
    };

    await startQaServer(responder);

    // 1. Create conversation in proj-checkout-v3
    const createRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/qa/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ createdBy: 'Priya Nair' }),
    });
    assert.equal(createRes.status, 201);
    const { conversation } = (await createRes.json()) as { conversation: QaConversation };
    assert.equal(conversation.projectId, 'proj-checkout-v3');

    // 2. Ask grounded question
    const msgRes = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        question: 'What work is still blocked around PAY-404 and Issue #24?',
        author: 'Priya Nair',
      }),
    });
    assert.equal(msgRes.status, 201);
    const msgData = (await msgRes.json()) as {
      conversation: QaConversation;
      userMessage: QaMessage;
      assistantMessage: QaMessage;
    };

    // Strict project isolation during retrieval
    assert.deepEqual(seenChunkProjectIds, ['proj-checkout-v3']);
    assert.ok(!seenSourceIds.includes('src-sso-csv'));
    assert.ok(!seenSourceIds.includes('src-tel-csv'));

    // Citations must be sequentially remapped [1], [2], and [C999] stripped!
    const aiMsg = msgData.assistantMessage;
    assert.equal(aiMsg.insufficientEvidence, false);
    assert.equal(aiMsg.citations.length, 2);
    assert.deepEqual(
      aiMsg.citations.map((c) => c.citationNumber),
      [1, 2],
    );
    assert.ok(aiMsg.content.includes('[1]'));
    assert.ok(aiMsg.content.includes('[2]'));
    assert.ok(!aiMsg.content.includes('C999'));
    assert.ok(!aiMsg.content.includes('[C'));
    assert.equal(aiMsg.sections?.length, 2);
    assert.equal(aiMsg.sections?.[0].kind, 'direct_evidence');
    assert.equal(aiMsg.sections?.[1].kind, 'interpretation');

    // Conversation title auto-derived from first question
    assert.ok(msgData.conversation.title.includes('PAY-404'));

    // 3. Evidence endpoint returns exact verified citations and project-scoped sources
    const evRes = await fetch(
      `${baseUrl}/api/qa/messages/${aiMsg.id}/evidence?projectId=proj-checkout-v3`,
    );
    assert.equal(evRes.status, 200);
    const evData = (await evRes.json()) as {
      messageId: string;
      projectId: string;
      citations: QaCitation[];
      sources: ActivitySource[];
    };
    assert.equal(evData.projectId, 'proj-checkout-v3');
    assert.equal(evData.citations.length, 2);
    assert.ok(evData.sources.every((s) => s.projectId === 'proj-checkout-v3'));

    // 4. Cross-project access must be forbidden (403)
    const crossConvRes = await fetch(
      `${baseUrl}/api/qa/conversations/${conversation.id}?projectId=proj-sso-rbac`,
    );
    assert.equal(crossConvRes.status, 403);

    const crossMsgRes = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-sso-rbac',
        question: 'Cross project attempt',
      }),
    });
    assert.equal(crossMsgRes.status, 403);

    const crossEvRes = await fetch(
      `${baseUrl}/api/qa/messages/${aiMsg.id}/evidence?projectId=proj-sso-rbac`,
    );
    assert.equal(crossEvRes.status, 403);
  });

  test('5, 6: insufficient evidence returns exact fallback message and rejects hallucinated citation-less answers', async () => {
    const responder: QaAiResponder = async ({ question }) => {
      if (question.includes('fake citation test')) {
        // AI claims sufficientEvidence=true but only gives non-existent refId C999
        return {
          sufficientEvidence: true,
          answer: 'Unverified claim [C999].',
          sections: [],
          citedRefs: [{ refId: 'C999', snippet: 'Made up' }],
        };
      }
      return {
        sufficientEvidence: false,
        answer: INSUFFICIENT_EVIDENCE_MESSAGE,
        sections: [],
        citedRefs: [],
        missingDetails: 'No database sharding or multi-region failover budget is mentioned in project sources.',
      };
    };

    await startQaServer(responder);

    const createRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/qa/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { conversation } = (await createRes.json()) as { conversation: QaConversation };

    // Case A: explicit insufficientEvidence: false
    const resA = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        question: 'What is the multi-region CockroachDB failover budget?',
      }),
    });
    assert.equal(resA.status, 201);
    const dataA = (await resA.json()) as { assistantMessage: QaMessage };
    assert.equal(dataA.assistantMessage.insufficientEvidence, true);
    assert.equal(dataA.assistantMessage.content, INSUFFICIENT_EVIDENCE_MESSAGE);
    assert.equal(dataA.assistantMessage.citations.length, 0);

    // Case B: AI claimed sufficientEvidence=true with invalid citation C999 -> backend enforces insufficient evidence
    const resB = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        question: 'Run fake citation test',
      }),
    });
    assert.equal(resB.status, 201);
    const dataB = (await resB.json()) as { assistantMessage: QaMessage };
    assert.equal(dataB.assistantMessage.insufficientEvidence, true);
    assert.equal(dataB.assistantMessage.content, INSUFFICIENT_EVIDENCE_MESSAGE);
    assert.equal(dataB.assistantMessage.citations.length, 0);
  });

  test('7: empty project without sources returns insufficient evidence without invoking AI', async () => {
    const db = readDatabase(dbFilePath);
    db.projects.push({
      id: 'proj-empty',
      name: 'Empty Project',
      code: 'EMP-001',
      department: 'Core Eng',
      description: 'No sources attached yet.',
      outgoingLead: {
        name: 'A. Dev',
        role: 'Lead',
        email: 'a@example.com',
        avatar: 'https://example.com/a.png',
      },
      incomingOwner: {
        name: 'B. Dev',
        role: 'Manager',
        email: 'b@example.com',
        avatar: 'https://example.com/b.png',
      },
      targetExitDate: '2026-06-01',
      healthState: 'Drafting',
      updatedAt: new Date().toISOString(),
    });
    writeDatabase(db, dbFilePath);

    let aiCalled = false;
    const responder: QaAiResponder = async () => {
      aiCalled = true;
      throw new Error('Should not invoke AI when project has zero evidence chunks');
    };

    await startQaServer(responder);

    const listRes = await fetch(`${baseUrl}/api/projects/proj-empty/qa/conversations`);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as QaConversationsListResponse;
    assert.equal(listData.sourceSummary.totalSources, 0);
    assert.equal(listData.sourceSummary.handoverPackCount, 0);
    assert.equal(listData.sourceSummary.knowledgeGapCount, 0);

    const convRes = await fetch(`${baseUrl}/api/projects/proj-empty/qa/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { conversation } = (await convRes.json()) as { conversation: QaConversation };

    const msgRes = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-empty',
        question: 'Why was Redis chosen?',
      }),
    });
    assert.equal(msgRes.status, 201);
    const msgData = (await msgRes.json()) as { assistantMessage: QaMessage };
    assert.equal(aiCalled, false);
    assert.equal(msgData.assistantMessage.insufficientEvidence, true);
    assert.equal(msgData.assistantMessage.content, INSUFFICIENT_EVIDENCE_MESSAGE);
  });

  test('9, 10: distinguishes Knowledge Gap Findings with isGapFinding=true and preserves conversation on AI errors', async () => {
    const db = readDatabase(dbFilePath);
    const sampleGap: KnowledgeGap = {
      id: 'gap-qa-test-1',
      projectId: 'proj-checkout-v3',
      fingerprint: 'fp-qa-test-1',
      title: 'Rollback procedure for Stripe webhook key rotation is undocumented',
      category: 'Missing Operational Knowledge',
      severity: 'High',
      confidence: 'Confirmed',
      description: 'Runbook lacks step-by-step webhook secret rotation rollback steps.',
      reasonForDetection: 'Checked payment_v3_handover_runbook.txt and no rotation rollback steps exist.',
      evidenceReferences: [],
      relevantSourceIds: ['src-pay-docs'],
      suggestedAction: 'Document dual-key rotation window before exit.',
      assignedOwner: 'Arjun Mehta',
      humanOwnerLocked: true,
      humanStatusLocked: false,
      reviewNotes: [],
      status: 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      analysisRunId: 'run-1',
      lastSeenRunId: 'run-1',
      activityHistory: [],
    };
    db.knowledgeGaps.push(sampleGap);
    writeDatabase(db, dbFilePath);

    let shouldFail = false;
    const responder: QaAiResponder = async ({ retrievedChunks }) => {
      if (shouldFail) {
        throw new AiProviderError('Simulated Gemini rate limit (429)');
      }
      const gapChunk = retrievedChunks.find((c) => c.chunk.isGapFinding);
      assert.ok(gapChunk, 'Expected knowledge gap chunk to be indexed');
      return {
        sufficientEvidence: true,
        answer: `A detected knowledge gap notes that webhook secret rotation rollback steps are missing [${gapChunk.refId}].`,
        sections: [
          {
            heading: 'Knowledge Gap Context',
            kind: 'direct_evidence',
            body: `Gap finding indicates rollback steps are undocumented [${gapChunk.refId}].`,
          },
        ],
        citedRefs: [
          {
            refId: gapChunk.refId,
            snippet: 'Rollback procedure for Stripe webhook key rotation is undocumented',
          },
        ],
      };
    };

    await startQaServer(responder);

    const createRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/qa/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { conversation } = (await createRes.json()) as { conversation: QaConversation };

    // Ask gap-related question
    const okRes = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        question: 'Which knowledge gaps exist around webhook rotation or rollback?',
      }),
    });
    assert.equal(okRes.status, 201);
    const okData = (await okRes.json()) as { assistantMessage: QaMessage };
    assert.equal(okData.assistantMessage.citations.length, 1);
    assert.equal(okData.assistantMessage.citations[0].sourceType, 'knowledge_gap');
    assert.equal(okData.assistantMessage.citations[0].isGapFinding, true);
    assert.equal(okData.assistantMessage.citations[0].canOpenSource, false);

    // Trigger AI failure and confirm 502 + no fake answer saved
    shouldFail = true;
    const errRes = await fetch(`${baseUrl}/api/qa/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        question: 'Another question while AI is down',
      }),
    });
    assert.equal(errRes.status, 502);
    const errBody = (await errRes.json()) as { error: string };
    assert.ok(errBody.error.includes('429'));

    // Verify conversation still has only the 2 persisted messages (no fake answer)
    const convGetRes = await fetch(
      `${baseUrl}/api/qa/conversations/${conversation.id}?projectId=proj-checkout-v3`,
    );
    const convGet = (await convGetRes.json()) as { conversation: QaConversation };
    assert.equal(convGet.conversation.messages.length, 2);

    // Recent conversations list persists across reads
    const listRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/qa/conversations`);
    const listData = (await listRes.json()) as QaConversationsListResponse;
    assert.equal(listData.conversations.length, 1);
    assert.equal(listData.sourceSummary.knowledgeGapCount, 1);
  });
});
