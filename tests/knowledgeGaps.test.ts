import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { readDatabase, writeDatabase } from '../server/db.ts';
import { createSeedDatabase } from '../server/seedData.ts';
import type { GapAiAnalyzer } from '../server/gapEngine.ts';
import { createKnowledgeGapTestApp } from '../server/gapRoutes.ts';
import type { KnowledgeGapsResponse } from '../src/types.ts';

let tempDir: string;
let dbFilePath: string;
let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(analyzer: GapAiAnalyzer) {
  const app = createKnowledgeGapTestApp({ analyzer, dbFilePath });
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoversync-gaps-test-'));
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

describe('Knowledge Gap Detector — End-to-End Backend & Persistence', () => {
  test('1, 2, 4, 5, 15: analyzes only selected project sources, validates evidence, classifies severity, and updates dashboard counters', async () => {
    let capturedPrompt = '';
    const analyzer: GapAiAnalyzer = async ({ normalizedPrompt }) => {
      capturedPrompt = normalizedPrompt;
      return [
        {
          title: 'Load test report referenced by PAY-405 is missing',
          category: 'Missing Documentation',
          severity: 'Critical',
          confidence: 'Confirmed',
          description:
            'PAY-405 requires load test report sign-off before canary cutover, but no load test artifact exists.',
          reasonForDetection:
            'Referenced in sprint_46_payment_tasks.csv Row PAY-405; checked all sources and none contain a load test report.',
          suggestedAction: 'Run k6 checkout load test and attach report to project sources.',
          relevantSourceIds: ['src-pay-csv', 'src-sso-csv'],
          evidenceReferences: [
            {
              sourceId: 'src-pay-csv',
              sourceTitle: 'Sprint 46 Payment Migration Tracker',
              fileName: 'sprint_46_payment_tasks.csv',
              recordId: 'PAY-405',
              excerpt: 'Requires sign-off on PAY-404 and load test report',
              locationReference: 'Row 5',
              relevanceExplanation:
                'Explicitly requires a load test report not present in project sources.',
            },
            {
              sourceId: 'non-existent-source-id',
              sourceTitle: 'Hallucinated Doc',
              fileName: 'fake.md',
              excerpt: 'Not found in available sources',
              relevanceExplanation: 'Load test report was not found in any available source.',
            },
          ],
        },
        {
          title: 'Tax microservice v2.4 release dependency lacks fallback SLA',
          category: 'Missing Dependencies Information',
          severity: 'Medium',
          confidence: 'Confirmed',
          description:
            'PAY-406 is blocked on tax-invoicing-svc v2.4 with no documented timeline or workaround.',
          reasonForDetection:
            'PAY-406 in CSV and Runbook Section 2 note dependency without fallback.',
          suggestedAction: 'Confirm release ETA with Maya Lin and document fallback mode.',
          relevantSourceIds: ['src-pay-csv', 'src-pay-docs'],
          evidenceReferences: [
            {
              sourceId: 'src-pay-docs',
              sourceTitle: 'Payment Gateway v3 Architecture & Runbook Notes',
              fileName: 'payment_v3_handover_runbook.txt',
              excerpt: 'EU VAT Invoice generation (PAY-406) depends on the Tax team releasing v2.4',
              locationReference: 'Section 2',
              relevanceExplanation: 'External team dependency without documented timeline.',
            },
          ],
        },
        {
          title: 'Minor naming clarification on staging feature flag',
          category: 'Missing Documentation',
          severity: 'Low',
          confidence: 'Possible',
          description: 'Flag naming convention between v2 and v3 could be clearer.',
          reasonForDetection:
            'Runbook mentions checkout-v3-canary while Issue #27 mentions ENABLE_LEGACY_CHARGE_V2.',
          suggestedAction: 'Add flag table to runbook.',
          relevantSourceIds: ['src-pay-github'],
          evidenceReferences: [
            {
              sourceId: 'src-sso-csv',
              sourceTitle: 'Cross Project',
              fileName: 'sso_tenant_rollout.csv',
              excerpt: 'Should be stripped',
              relevanceExplanation: 'Invalid cross-project citation.',
            },
          ],
        },
      ];
    };

    await startTestServer(analyzer);

    const analyzeRes = await fetch(
      `${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`,
      { method: 'POST' },
    );
    assert.equal(analyzeRes.status, 201);
    const analyzeJson = (await analyzeRes.json()) as {
      run: { sourcesAnalyzedCount: number; findingsCreated: number; status: string };
      gaps: KnowledgeGapsResponse['gaps'];
      summary: KnowledgeGapsResponse['summary'];
    };

    assert.equal(analyzeJson.run.status, 'completed');
    assert.equal(analyzeJson.run.sourcesAnalyzedCount, 3);
    assert.equal(analyzeJson.run.findingsCreated, 3);

    // Project isolation: SSO or Telemetry sources must NOT appear in prompt
    assert.ok(capturedPrompt.includes('sprint_46_payment_tasks.csv'));
    assert.ok(!capturedPrompt.includes('sso_tenant_rollout.csv'));
    assert.ok(!capturedPrompt.includes('telemetry_sprint_tasks.csv'));

    // Cross-project sourceId must be stripped from relevantSourceIds and evidenceReferences
    const lowGap = analyzeJson.gaps.find((g) => g.severity === 'Low');
    assert.ok(lowGap);
    assert.ok(!lowGap.relevantSourceIds.includes('src-sso-csv'));
    assert.equal(lowGap.evidenceReferences[0]?.excerpt, 'Not found in available sources');
    assert.equal(lowGap.confidence, 'Requires Verification');

    // Dashboard counters
    assert.equal(analyzeJson.summary.total, 3);
    assert.equal(analyzeJson.summary.open, 3);
    assert.equal(analyzeJson.summary.critical, 1);
    assert.equal(analyzeJson.summary.medium, 1);
    assert.equal(analyzeJson.summary.low, 1);
    assert.equal(analyzeJson.summary.resolved, 0);

    // Cross-project gap access forbidden (403)
    const gapId = analyzeJson.gaps[0].id;
    const crossRes = await fetch(`${baseUrl}/api/knowledge-gaps/${gapId}?projectId=proj-sso-rbac`);
    assert.equal(crossRes.status, 403);
  });

  test('3: returns clean 400 error when project has no usable sources and creates zero fake findings', async () => {
    const db = readDatabase(dbFilePath);
    db.sources = db.sources.filter((s) => s.projectId !== 'proj-checkout-v3');
    db.handovers = db.handovers.filter((h) => h.projectId !== 'proj-checkout-v3');
    writeDatabase(db, dbFilePath);

    let analyzerCalled = false;
    await startTestServer(async () => {
      analyzerCalled = true;
      return [];
    });

    const res = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`, {
      method: 'POST',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes('No usable sources found'));
    assert.equal(analyzerCalled, false);

    const getRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps`);
    const getData = (await getRes.json()) as KnowledgeGapsResponse;
    assert.equal(getData.gaps.length, 0);
    assert.equal(getData.summary.total, 0);
  });

  test('6, 7, 8, 9, 10, 11, 12, 14: supports full human review workflow and preserves decisions without duplicates on re-analysis', async () => {
    let runNumber = 0;
    const analyzer: GapAiAnalyzer = async () => {
      runNumber += 1;
      if (runNumber === 1) {
        return [
          {
            title: 'Missing load test report for v3 canary cutover',
            category: 'Missing Documentation',
            severity: 'Critical',
            confidence: 'Confirmed',
            description: 'PAY-405 requires load test report.',
            reasonForDetection: 'Not found across project files.',
            suggestedAction: 'Upload load test report.',
            relevantSourceIds: ['src-pay-csv'],
            evidenceReferences: [
              {
                sourceId: 'src-pay-csv',
                sourceTitle: 'Sprint 46',
                fileName: 'sprint_46_payment_tasks.csv',
                recordId: 'PAY-405',
                excerpt: 'Requires sign-off on PAY-404 and load test report',
                relevanceExplanation: 'Required before production cutover.',
              },
            ],
          },
          {
            title: 'Unclear fallback plan for EUR partial refund rounding',
            category: 'Unresolved Issues',
            severity: 'Medium',
            confidence: 'Confirmed',
            description: 'PR #148 has a 1-cent rounding discrepancy.',
            reasonForDetection: 'PR #148 status is Changes Requested.',
            suggestedAction: 'Update QA fixtures and merge PR #148.',
            relevantSourceIds: ['src-pay-github'],
            evidenceReferences: [
              {
                sourceId: 'src-pay-github',
                sourceTitle: 'GitHub Activity',
                fileName: 'github_payment_gateway_activity.json',
                recordId: 'PR #148',
                excerpt: 'Changes Requested — needs QA fixture update',
                relevanceExplanation: 'Open PR blocking accurate EUR refunds.',
              },
            ],
          },
          {
            title: 'Optional webhook secret rotation checklist',
            category: 'Missing Operational Knowledge',
            severity: 'Low',
            confidence: 'Possible',
            description: 'Issue #27 mentions secret rotation.',
            reasonForDetection: 'Checklist steps not detailed.',
            suggestedAction: 'Document Vault command.',
            relevantSourceIds: ['src-pay-github'],
            evidenceReferences: [
              {
                sourceId: 'src-pay-github',
                sourceTitle: 'GitHub Activity',
                fileName: 'github_payment_gateway_activity.json',
                recordId: 'Issue #27',
                excerpt: 'rotate STRIPE_WEBHOOK_SECRET_V2 in Vault',
                relevanceExplanation: 'Operational step mentioned without CLI steps.',
              },
            ],
          },
        ];
      }

      return [
        {
          title: 'Missing load test report for v3 canary cutover',
          category: 'Missing Documentation',
          severity: 'Critical',
          confidence: 'Confirmed',
          description: 'Updated description from run 2.',
          reasonForDetection: 'Still missing.',
          suggestedAction: 'Upload report.',
          relevantSourceIds: ['src-pay-csv'],
          evidenceReferences: [
            {
              sourceId: 'src-pay-csv',
              sourceTitle: 'Sprint 46',
              fileName: 'sprint_46_payment_tasks.csv',
              recordId: 'PAY-405',
              excerpt: 'Requires sign-off on PAY-404 and load test report',
              relevanceExplanation: 'Still missing.',
            },
          ],
        },
        {
          title: 'Tax microservice v2.4 dependency lacks SLA',
          category: 'Missing Dependencies Information',
          severity: 'Medium',
          confidence: 'Confirmed',
          description: 'PAY-406 blocked on tax-invoicing-svc v2.4.',
          reasonForDetection: 'No SLA documented.',
          suggestedAction: 'Confirm ETA with Tax team.',
          relevantSourceIds: ['src-pay-docs'],
          evidenceReferences: [
            {
              sourceId: 'src-pay-docs',
              sourceTitle: 'Runbook',
              fileName: 'payment_v3_handover_runbook.txt',
              excerpt: 'depends on the Tax team releasing v2.4',
              relevanceExplanation: 'External blocker.',
            },
          ],
        },
      ];
    };

    await startTestServer(analyzer);

    // Run 1
    const r1 = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`, {
      method: 'POST',
    });
    assert.equal(r1.status, 201);
    const d1 = (await r1.json()) as { gaps: KnowledgeGapsResponse['gaps'] };
    const loadTestGap = d1.gaps.find((g) => g.title.includes('load test'))!;
    const roundingGap = d1.gaps.find((g) => g.title.includes('EUR partial refund'))!;
    const secretGap = d1.gaps.find((g) => g.title.includes('secret rotation'))!;

    // 7. Assign Owner
    const assignRes = await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        owner: 'Priya Nair',
        actor: 'Arjun Mehta',
      }),
    });
    assert.equal(assignRes.status, 200);

    // 8. Add Note
    await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        author: 'Arjun Mehta',
        authorRole: 'Outgoing Lead',
        content: 'First note: k6 script is in perf/checkout_v3.js.',
      }),
    });
    const note2Res = await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        author: 'Priya Nair',
        authorRole: 'Incoming Manager',
        content: 'Second note: verified staging run scheduled.',
      }),
    });
    assert.equal(note2Res.status, 201);

    // 9. Mark In Progress
    const inProgRes = await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        status: 'In Progress',
        actor: 'Priya Nair',
      }),
    });
    assert.equal(inProgRes.status, 200);

    // 10. Mark Resolved requires confirmation + explanation
    const badResolve = await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        status: 'Resolved',
        reason: '',
        confirmed: false,
        actor: 'Priya Nair',
      }),
    });
    assert.equal(badResolve.status, 400);

    const goodResolve = await fetch(`${baseUrl}/api/knowledge-gaps/${loadTestGap.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        status: 'Resolved',
        reason: 'Load test report generated and reviewed with Arjun.',
        confirmed: true,
        actor: 'Priya Nair',
      }),
    });
    assert.equal(goodResolve.status, 200);

    // 11. Mark Not a Gap requires reason & preserves record
    const dismissRes = await fetch(`${baseUrl}/api/knowledge-gaps/${secretGap.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        status: 'Not a Gap',
        reason: 'Covered by standard Vault SOP runbook.',
        actor: 'Priya Nair',
      }),
    });
    assert.equal(dismissRes.status, 200);

    // 12. Re-analysis: verify NO duplicate created, human decisions preserved
    const r2 = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`, {
      method: 'POST',
    });
    assert.equal(r2.status, 201);
    const d2 = (await r2.json()) as {
      run: { findingsCreated: number; findingsUpdated: number };
      gaps: KnowledgeGapsResponse['gaps'];
      summary: KnowledgeGapsResponse['summary'];
    };

    assert.equal(d2.run.findingsCreated, 1);
    assert.equal(d2.run.findingsUpdated, 1);
    assert.equal(d2.summary.total, 4);

    const recheckedLoadGap = d2.gaps.find((g) => g.id === loadTestGap.id)!;
    assert.equal(recheckedLoadGap.status, 'Resolved');
    assert.equal(recheckedLoadGap.assignedOwner, 'Priya Nair');
    assert.equal(recheckedLoadGap.reviewNotes.length, 2);
    assert.equal(
      recheckedLoadGap.resolutionReason,
      'Load test report generated and reviewed with Arjun.',
    );

    const recheckedRoundingGap = d2.gaps.find((g) => g.id === roundingGap.id)!;
    assert.equal(recheckedRoundingGap.status, 'Open');

    const recheckedDismissedGap = d2.gaps.find((g) => g.id === secretGap.id)!;
    assert.equal(recheckedDismissedGap.status, 'Not a Gap');

    // 14. Analysis history contains both runs
    const histRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/history`);
    assert.equal(histRes.status, 200);
    const histJson = (await histRes.json()) as { runs: Array<{ status: string }> };
    assert.equal(histJson.runs.length, 2);
  });

  test('13: analysis failure preserves previously saved findings and records failed run in history', async () => {
    let shouldFail = false;
    const analyzer: GapAiAnalyzer = async () => {
      if (shouldFail) {
        throw new Error('Simulated 429 rate limit from Gemini');
      }
      return [
        {
          title: 'Missing load test report',
          category: 'Missing Documentation',
          severity: 'Critical',
          confidence: 'Confirmed',
          description: 'Missing report.',
          reasonForDetection: 'Not found.',
          suggestedAction: 'Add report.',
          relevantSourceIds: ['src-pay-csv'],
          evidenceReferences: [
            {
              sourceId: 'src-pay-csv',
              sourceTitle: 'Sprint 46',
              fileName: 'sprint_46_payment_tasks.csv',
              excerpt: 'load test report',
              relevanceExplanation: 'Referenced in PAY-405.',
            },
          ],
        },
      ];
    };

    await startTestServer(analyzer);

    const okRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`, {
      method: 'POST',
    });
    assert.equal(okRes.status, 201);

    shouldFail = true;
    const failRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/analyze`, {
      method: 'POST',
    });
    assert.equal(failRes.status, 502);
    const failBody = (await failRes.json()) as { error: string };
    assert.ok(failBody.error.includes('rate limit'));

    const getRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps`);
    const getData = (await getRes.json()) as KnowledgeGapsResponse;
    assert.equal(getData.gaps.length, 1);

    const histRes = await fetch(`${baseUrl}/api/projects/proj-checkout-v3/knowledge-gaps/history`);
    const histJson = (await histRes.json()) as {
      runs: Array<{ status: string; error?: string }>;
    };
    assert.equal(histJson.runs.length, 2);
    assert.equal(histJson.runs[0].status, 'failed');
    assert.ok(histJson.runs[0].error?.includes('rate limit'));
  });
});
