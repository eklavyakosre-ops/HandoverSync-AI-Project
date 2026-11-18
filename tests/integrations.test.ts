import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { readDatabase, writeDatabase } from '../server/db.ts';
import { createSeedDatabase } from '../server/seedData.ts';
import { createIntegrationTestApp } from '../server/integrationRoutes.ts';
import type { FetchLike } from '../server/integrationService.ts';
import { runKnowledgeGapAnalysis } from '../server/gapEngine.ts';
import { registerKnowledgeGapRoutes } from '../server/gapRoutes.ts';
import { answerProjectQuestion } from '../server/qaEngine.ts';
import { generateHandoverWithAI } from '../server/aiAgent.ts';
import type {
  ExternalSourceRecord,
  IntegrationConfiguration,
  IntegrationProviderStatusDTO,
  IntegrationSyncRun,
} from '../src/types.ts';

let tempDir: string;
let dbFilePath: string;
let server: http.Server | null = null;
let baseUrl = '';

const SAVED_ENV = {
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  JIRA_CLIENT_ID: process.env.JIRA_CLIENT_ID,
  JIRA_CLIENT_SECRET: process.env.JIRA_CLIENT_SECRET,
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
  APP_URL: process.env.APP_URL,
};

function restoreEnv(): void {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

async function startTestServer(fetchFn: FetchLike) {
  const app = createIntegrationTestApp({ fetchFn, dbFilePath });
  registerKnowledgeGapRoutes(app, { dbFilePath });
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

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoversync-integrations-test-'));
  dbFilePath = path.join(tempDir, 'test_db.json');
  writeDatabase(createSeedDatabase(), dbFilePath);
});

afterEach(async () => {
  restoreEnv();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Real Project Integrations & Full Round 3 Pipeline (Mocked Provider APIs)', () => {
  test('Reports honest Not Configured status when OAuth credentials are unset', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.JIRA_CLIENT_ID;
    delete process.env.JIRA_CLIENT_SECRET;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;

    await startTestServer(async () => jsonResponse({}, 404));

    const res = await fetch(`${baseUrl}/api/integrations?projectId=proj-checkout-v3`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { providers: IntegrationProviderStatusDTO[] };

    const gh = body.providers.find((p) => p.provider === 'github')!;
    const jira = body.providers.find((p) => p.provider === 'jira')!;
    const slack = body.providers.find((p) => p.provider === 'slack')!;
    const drive = body.providers.find((p) => p.provider === 'drive')!;

    assert.equal(gh.oauthConfigured, false);
    assert.equal(gh.tokenAuthSupported, false);
    assert.equal(gh.account.status, 'not_configured');
    assert.equal(jira.account.status, 'not_configured');
    assert.equal(slack.account.status, 'not_configured');
    assert.equal(drive.oauthConfigured, true);
    assert.equal(drive.account.status, 'disconnected');

    const oauthUrlRes = await fetch(`${baseUrl}/api/integrations/github/oauth-url`);
    assert.equal(oauthUrlRes.status, 400);
  });

  test('GitHub OAuth flow validates state CSRF, configures per-project repo, fetches docs/README/commits/issues/PRs, prevents duplicates, and isolates projects', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-gh-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-gh-client-secret';
    process.env.APP_URL = 'https://handoversync.example.com';

    let repoUpdatedAt = '2026-11-16T10:00:00Z';

    const mockFetch: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization || '';

      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({ access_token: 'gho_oauth_secret_token', token_type: 'bearer' });
      }

      if (url === 'https://api.github.com/user') {
        if (auth !== 'Bearer gho_oauth_secret_token') {
          return jsonResponse({ message: 'Bad credentials' }, 401);
        }
        return jsonResponse(
          { login: 'arjun-mehta', name: 'Arjun Mehta' },
          200,
          { 'x-ratelimit-remaining': '5', 'x-ratelimit-limit': '5000' },
        );
      }

      if (url.startsWith('https://api.github.com/user/repos')) {
        return jsonResponse(
          [
            {
              id: 101,
              full_name: 'acme/live-payments',
              name: 'live-payments',
              owner: { login: 'acme' },
              private: true,
              default_branch: 'main',
              description: 'Live PaymentIntents service',
              html_url: 'https://github.com/acme/live-payments',
              updated_at: repoUpdatedAt,
              language: 'TypeScript',
            },
          ],
          200,
          { 'x-ratelimit-remaining': '4', 'x-ratelimit-limit': '5000' },
        );
      }

      if (url === 'https://api.github.com/repos/acme/live-payments') {
        return jsonResponse({
          full_name: 'acme/live-payments',
          html_url: 'https://github.com/acme/live-payments',
          description: 'Live PaymentIntents service',
          default_branch: 'main',
          language: 'TypeScript',
          topics: ['payments', 'stripe', 'redis'],
          created_at: '2026-01-10T00:00:00Z',
          updated_at: repoUpdatedAt,
          owner: { login: 'acme' },
        });
      }

      if (url.includes('/commits')) {
        return jsonResponse([
          {
            sha: 'abc1234def5678',
            html_url: 'https://github.com/acme/live-payments/commit/abc1234',
            commit: {
              message: 'fix(stripe): add Redis lock around 3DS callback',
              author: { name: 'Arjun Mehta', date: '2026-11-15T09:00:00Z' },
            },
          },
        ]);
      }

      if (url.includes('/issues')) {
        return jsonResponse([
          {
            number: 99,
            title: 'Verify Stripe webhook retry queue backoff in production',
            state: 'open',
            html_url: 'https://github.com/acme/live-payments/issues/99',
            body: 'Backoff parameters need confirmation before Dec 1 cutover.',
            labels: [{ name: 'critical' }],
            assignee: { login: 'priya-nair' },
            user: { login: 'arjun-mehta' },
            created_at: '2026-11-14T10:00:00Z',
            updated_at: '2026-11-15T10:00:00Z',
          },
        ]);
      }

      if (url.includes('/pulls')) {
        return jsonResponse([
          {
            number: 205,
            title: 'feat: use Stripe settlement_rate for EUR refunds',
            state: 'open',
            html_url: 'https://github.com/acme/live-payments/pull/205',
            user: { login: 'arjun-mehta' },
            created_at: '2026-11-14T12:00:00Z',
            updated_at: '2026-11-15T12:00:00Z',
            body: 'Replaces cached ECB rate lookup.',
          },
        ]);
      }

      if (url.includes('/readme')) {
        return new Response('# Live Payments\nUses Node 22, Express, Redis, and Stripe PaymentIntents.', {
          status: 200,
          headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-limit': '5000' },
        });
      }

      if (url.endsWith('/contents/docs')) {
        return jsonResponse([
          {
            type: 'file',
            name: 'runbook.md',
            path: 'docs/runbook.md',
            html_url: 'https://github.com/acme/live-payments/blob/main/docs/runbook.md',
            url: 'https://api.github.com/repos/acme/live-payments/contents/docs/runbook.md',
          },
        ]);
      }

      if (url.endsWith('/contents/docs/runbook.md')) {
        return new Response('## Failover Runbook\nSet checkout-v3-canary flag to 0% before draining Redis locks.', {
          status: 200,
        });
      }

      return jsonResponse({ message: 'Not Found' }, 404);
    };

    await startTestServer(mockFetch);

    // 1. OAuth URL generation includes valid client_id, redirect_uri, and CSRF state
    const oauthRes = await fetch(`${baseUrl}/api/integrations/github/oauth-url`);
    assert.equal(oauthRes.status, 200);
    const { url: authUrl } = (await oauthRes.json()) as { url: string };
    const parsedAuth = new URL(authUrl);
    assert.equal(parsedAuth.searchParams.get('client_id'), 'test-gh-client-id');
    assert.equal(
      parsedAuth.searchParams.get('redirect_uri'),
      'https://handoversync.example.com/api/integrations/github/callback',
    );
    const state = parsedAuth.searchParams.get('state')!;
    assert.ok(state.length >= 20);

    // 2. Rejects tampered state
    const badCb = await fetch(
      `${baseUrl}/api/integrations/github/callback?code=abc&state=tampered-state`,
    );
    assert.equal(badCb.status, 400);

    // 3. Valid OAuth callback exchanges code and connects account
    const goodCb = await fetch(
      `${baseUrl}/api/integrations/github/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    );
    assert.equal(goodCb.status, 200);
    const goodHtml = await goodCb.text();
    assert.ok(goodHtml.includes('OAUTH_AUTH_SUCCESS'));

    // 4. List repos returns low rate-limit warning
    const reposRes = await fetch(`${baseUrl}/api/integrations/github/repos`);
    assert.equal(reposRes.status, 200);
    const reposBody = (await reposRes.json()) as {
      repos: Array<{ fullName: string }>;
      warning?: string;
    };
    assert.equal(reposBody.repos[0].fullName, 'acme/live-payments');
    assert.ok(reposBody.warning?.includes('rate limit is low'));

    // 5. Save per-project configuration via PUT /api/integrations/github/configure
    const cfgRes = await fetch(`${baseUrl}/api/integrations/github/configure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        selectedTargetId: 'acme/live-payments',
        selectedTargetLabel: 'acme/live-payments',
        includeCommits: true,
        includeIssues: true,
        includePullRequests: true,
        includeDocs: true,
      }),
    });
    assert.equal(cfgRes.status, 200);
    const cfgBody = (await cfgRes.json()) as { configuration: IntegrationConfiguration };
    assert.equal(cfgBody.configuration.selectedTargetId, 'acme/live-payments');

    // 6. Sync using saved configuration (no repoFullName needed in body)
    const sync1 = await fetch(`${baseUrl}/api/integrations/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3' }),
    });
    assert.equal(sync1.status, 200);
    const sync1Data = (await sync1.json()) as {
      source: { id: string };
      syncRun: { recordsImported: number; duplicatesSkipped: number };
    };
    // 1 commit + 1 issue + 1 PR + 1 README + 1 docs/runbook.md = 5 records
    assert.equal(sync1Data.syncRun.recordsImported, 5);
    assert.equal(sync1Data.syncRun.duplicatesSkipped, 0);

    const dbAfterFirst = readDatabase(dbFilePath);
    const firstExt = dbAfterFirst.externalSources!.find(
      (e) => e.projectId === 'proj-checkout-v3' && e.provider === 'github',
    )!;
    assert.equal(firstExt.internalSourceId, sync1Data.source.id);
    assert.equal(firstExt.sourceType, 'github_sync');
    assert.ok(firstExt.createdAt);
    assert.ok(firstExt.syncedAt);
    const firstCreatedAt = firstExt.createdAt;
    const afterFirstCount = dbAfterFirst.sources.filter(
      (s) => s.projectId === 'proj-checkout-v3',
    ).length;

    // 7. Re-sync updates in-place, preserves createdAt, updates updatedAt/syncedAt, zero duplicates
    repoUpdatedAt = '2026-11-16T12:30:00Z';
    const sync2 = await fetch(`${baseUrl}/api/integrations/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', repoFullName: 'acme/live-payments' }),
    });
    assert.equal(sync2.status, 200);
    const sync2Data = (await sync2.json()) as {
      source: { id: string };
      syncRun: { duplicatesSkipped: number };
    };
    assert.equal(sync2Data.source.id, sync1Data.source.id);
    assert.equal(sync2Data.syncRun.duplicatesSkipped, 5);

    const dbAfterSecond = readDatabase(dbFilePath);
    const secondExt = dbAfterSecond.externalSources!.find(
      (e) => e.projectId === 'proj-checkout-v3' && e.provider === 'github',
    )!;
    assert.equal(secondExt.createdAt, firstCreatedAt);
    assert.equal(secondExt.updatedAt, '2026-11-16T12:30:00Z');
    assert.equal(
      dbAfterSecond.sources.filter((s) => s.projectId === 'proj-checkout-v3').length,
      afterFirstCount,
    );

    // 8. Verify token non-exposure & project isolation (proj-sso-rbac must not see proj-checkout-v3 syncs/configs)
    const listCheckoutRes = await fetch(`${baseUrl}/api/integrations?projectId=proj-checkout-v3`);
    const listCheckoutText = await listCheckoutRes.text();
    assert.equal(listCheckoutText.includes('gho_oauth_secret_token'), false);
    const parsedCheckout = JSON.parse(listCheckoutText) as {
      providers: IntegrationProviderStatusDTO[];
      configurations: IntegrationConfiguration[];
      externalSources: ExternalSourceRecord[];
      syncRuns: IntegrationSyncRun[];
    };
    assert.equal(
      parsedCheckout.providers.find((p) => p.provider === 'github')?.account.status,
      'connected',
    );
    assert.equal(parsedCheckout.configurations.length, 1);
    assert.equal(parsedCheckout.externalSources.length, 1);

    const listSsoRes = await fetch(`${baseUrl}/api/integrations?projectId=proj-sso-rbac`);
    const parsedSso = (await listSsoRes.json()) as {
      configurations: IntegrationConfiguration[];
      externalSources: ExternalSourceRecord[];
      syncRuns: IntegrationSyncRun[];
    };
    assert.equal(parsedSso.configurations.length, 0);
    assert.equal(parsedSso.externalSources.length, 0);
    assert.equal(parsedSso.syncRuns.length, 0);
  });

  test('GitHub error handling: records failed SyncRun on rate-limit 429 and upstream 502 errors', async () => {
    let failMode: 'none' | 'rate_limit' | 'upstream_502' = 'none';

    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.github.com/user') {
        return jsonResponse({ login: 'arjun-mehta', name: 'Arjun Mehta' });
      }
      if (url === 'https://api.github.com/repos/acme/live-payments') {
        if (failMode === 'upstream_502') {
          return jsonResponse({ message: 'Bad Gateway' }, 502);
        }
        return jsonResponse({
          full_name: 'acme/live-payments',
          html_url: 'https://github.com/acme/live-payments',
          default_branch: 'main',
        });
      }
      if (url.includes('/commits')) {
        if (failMode === 'rate_limit') {
          return jsonResponse(
            { message: 'API rate limit exceeded' },
            403,
            { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000' },
          );
        }
        return jsonResponse([]);
      }
      return jsonResponse([], 200);
    };

    await startTestServer(mockFetch);

    // Connect on backend for test
    const conn = await fetch(`${baseUrl}/api/integrations/github/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_err_test' }),
    });
    assert.equal(conn.status, 200);

    // Trigger upstream 502
    failMode = 'upstream_502';
    const err502Res = await fetch(`${baseUrl}/api/integrations/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', repoFullName: 'acme/live-payments' }),
    });
    assert.equal(err502Res.status, 502);

    // Trigger rate-limit 429
    failMode = 'rate_limit';
    const err429Res = await fetch(`${baseUrl}/api/integrations/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', repoFullName: 'acme/live-payments' }),
    });
    assert.equal(err429Res.status, 429);

    const historyRes = await fetch(`${baseUrl}/api/integrations/history?projectId=proj-checkout-v3`);
    const historyBody = (await historyRes.json()) as { syncRuns: IntegrationSyncRun[] };
    assert.equal(historyBody.syncRuns.length, 2);
    assert.equal(historyBody.syncRuns[0].status, 'failed');
    assert.ok(historyBody.syncRuns[0].error?.includes('rate limit'));
    assert.equal(historyBody.syncRuns[1].status, 'failed');
  });

  test('Google Drive, Jira, and Slack verify credentials, import real external items, and handle API warnings cleanly', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Drive mocks
      if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
        return jsonResponse({ user: { displayName: 'Priya Nair', emailAddress: 'priya@acme.io' } });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        return jsonResponse({
          files: [
            {
              id: 'drv-doc-1',
              name: 'Checkout Architecture ADR',
              mimeType: 'application/vnd.google-apps.document',
              modifiedTime: '2026-11-15T10:00:00Z',
              webViewLink: 'https://docs.google.com/document/d/drv-doc-1/edit',
            },
          ],
        });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/drv-doc-1?fields=')) {
        return jsonResponse({
          id: 'drv-doc-1',
          name: 'Checkout Architecture ADR',
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2026-11-15T10:00:00Z',
          webViewLink: 'https://docs.google.com/document/d/drv-doc-1/edit',
        });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/drv-doc-1/export')) {
        return new Response('Decision: Selected Redis Cluster for idempotency locks due to <2ms p99 latency.', {
          status: 200,
        });
      }

      // Jira mocks
      if (url === 'https://acme.atlassian.net/rest/api/3/myself') {
        return jsonResponse({ displayName: 'Arjun Mehta', emailAddress: 'arjun@acme.io' });
      }
      if (url.startsWith('https://acme.atlassian.net/rest/api/3/project/search')) {
        return jsonResponse({ values: [{ id: '10001', key: 'PAY', name: 'Payments v3' }] });
      }
      if (url.startsWith('https://acme.atlassian.net/rest/api/3/search/jql')) {
        return jsonResponse({
          issues: [
            {
              id: '2001',
              key: 'PAY-901',
              fields: {
                summary: 'Rotate Stripe v3 signing secret in Vault',
                status: { name: 'In Progress' },
                priority: { name: 'High' },
                assignee: { displayName: 'Priya Nair' },
                issuetype: { name: 'Task' },
                updated: '2026-11-15T11:00:00Z',
                description: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Coordinate secret rotation with SRE before Nov 25.' }],
                    },
                  ],
                },
              },
            },
          ],
        });
      }

      // Slack mocks
      if (url === 'https://slack.com/api/auth.test') {
        return jsonResponse({ ok: true, team: 'Acme Eng', user: 'handover-bot' });
      }
      if (url.includes('conversations.list') && url.includes('private_channel')) {
        return jsonResponse({ ok: false, error: 'missing_scope' });
      }
      if (url.includes('conversations.list') && url.includes('types=public_channel')) {
        return jsonResponse({
          ok: true,
          channels: [{ id: 'C123', name: 'eng-payments', is_private: false, is_member: true }],
        });
      }
      if (url.includes('conversations.history')) {
        return jsonResponse({
          ok: true,
          messages: [
            {
              ts: '1763200000.000100',
              user: 'U01ARJUN',
              text: 'Decision: Tax microservice v2.4 dependency is tracked by Maya Lin.',
            },
          ],
        });
      }

      return jsonResponse({ error: 'unexpected url ' + url }, 404);
    };

    await startTestServer(mockFetch);

    // Google Drive flow
    const drvConn = await fetch(`${baseUrl}/api/integrations/drive/connect`, {
      method: 'POST',
      headers: { Authorization: 'Bearer drive-session-tok' },
    });
    assert.equal(drvConn.status, 200);
    const drvFiles = await fetch(`${baseUrl}/api/integrations/drive/files`, {
      headers: { Authorization: 'Bearer drive-session-tok' },
    });
    assert.equal(drvFiles.status, 200);
    const drvSync = await fetch(`${baseUrl}/api/integrations/drive/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer drive-session-tok',
      },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', fileIds: ['drv-doc-1'] }),
    });
    assert.equal(drvSync.status, 200);
    const drvSyncBody = (await drvSync.json()) as { sources: Array<{ title: string; content: string }> };
    assert.ok(drvSyncBody.sources[0].content.includes('Redis Cluster'));

    // Jira flow
    const jiraConn = await fetch(`${baseUrl}/api/integrations/jira/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteUrl: 'https://acme.atlassian.net',
        email: 'arjun@acme.io',
        apiToken: 'jira-secret-token',
      }),
    });
    assert.equal(jiraConn.status, 200);
    const jiraSync = await fetch(`${baseUrl}/api/integrations/jira/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', jiraProjectKey: 'PAY' }),
    });
    assert.equal(jiraSync.status, 200);
    const jiraSyncBody = (await jiraSync.json()) as { source: { content: string } };
    assert.ok(jiraSyncBody.source.content.includes('[PAY-901]'));
    assert.ok(jiraSyncBody.source.content.includes('Coordinate secret rotation with SRE'));

    // Slack flow
    const slackConn = await fetch(`${baseUrl}/api/integrations/slack/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'xoxb-secret-slack' }),
    });
    assert.equal(slackConn.status, 200);
    const slackChannelsRes = await fetch(`${baseUrl}/api/integrations/slack/channels`);
    const slackChannelsBody = (await slackChannelsRes.json()) as {
      channels: Array<{ id: string; name: string }>;
      warning?: string;
    };
    assert.equal(slackChannelsBody.channels[0].name, 'eng-payments');
    assert.ok(slackChannelsBody.warning?.includes('groups:read'));

    const slackSyncRes = await fetch(`${baseUrl}/api/integrations/slack/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        channels: [{ id: 'C123', name: 'eng-payments' }],
      }),
    });
    assert.equal(slackSyncRes.status, 200);

    // Ensure no secret tokens leak
    const statusText = await (await fetch(`${baseUrl}/api/integrations`)).text();
    assert.equal(statusText.includes('jira-secret-token'), false);
    assert.equal(statusText.includes('xoxb-secret-slack'), false);
    assert.equal(statusText.includes('drive-session-tok'), false);
  });

  test('Integrated Round 3 workflow: Sync GitHub (README + docs + Issue) -> Knowledge Gap Detector -> Evidence-Cited Q&A -> Complete Handover Pack', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.github.com/user') {
        return jsonResponse({ login: 'arjun-mehta', name: 'Arjun Mehta' });
      }
      if (url === 'https://api.github.com/repos/acme/live-payments') {
        return jsonResponse({
          full_name: 'acme/live-payments',
          html_url: 'https://github.com/acme/live-payments',
          description: 'Live PaymentIntents service',
          default_branch: 'main',
          language: 'TypeScript',
          topics: ['redis', 'stripe'],
        });
      }
      if (url.includes('/commits')) return jsonResponse([]);
      if (url.includes('/issues')) {
        return jsonResponse([
          {
            number: 88,
            title: 'Missing disaster recovery runbook for Redis idempotency cluster',
            state: 'open',
            html_url: 'https://github.com/acme/live-payments/issues/88',
            body: 'Failover steps for Redis idempotency cluster are undocumented.',
            labels: [{ name: 'documentation' }],
            assignee: null,
            created_at: '2026-11-15T00:00:00Z',
            updated_at: '2026-11-15T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/pulls')) return jsonResponse([]);
      if (url.includes('/readme')) {
        return new Response('Selected Redis SETNX for sub-2ms idempotency locking.', { status: 200 });
      }
      if (url.endsWith('/contents/docs')) {
        return jsonResponse([
          {
            type: 'file',
            name: 'redis-failover.md',
            path: 'docs/redis-failover.md',
            html_url: 'https://github.com/acme/live-payments/blob/main/docs/redis-failover.md',
            url: 'https://api.github.com/repos/acme/live-payments/contents/docs/redis-failover.md',
          },
        ]);
      }
      if (url.endsWith('/contents/docs/redis-failover.md')) {
        return new Response('Runbook draft: Promote secondary sentinel before clearing stale checkout locks.', {
          status: 200,
        });
      }
      return jsonResponse({}, 404);
    };

    await startTestServer(mockFetch);

    // Step 1: Connect & Sync GitHub
    await fetch(`${baseUrl}/api/integrations/github/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_workflow_test' }),
    });
    const syncRes = await fetch(`${baseUrl}/api/integrations/github/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-checkout-v3', repoFullName: 'acme/live-payments' }),
    });
    const { source: syncedGithubSource } = (await syncRes.json()) as {
      source: { id: string; fileName: string; content: string };
    };
    assert.ok(syncedGithubSource.content.includes('docs/redis-failover.md'));

    // Step 2: Run Knowledge Gap Detector including synced GitHub source
    const gapResult = await runKnowledgeGapAnalysis({
      projectId: 'proj-checkout-v3',
      dbFilePath,
      analyzer: async ({ normalizedPrompt }) => {
        assert.ok(normalizedPrompt.includes('acme/live-payments'));
        return [
          {
            title: 'Missing DR runbook for Redis idempotency cluster (Issue #88)',
            category: 'Missing Operational Knowledge',
            severity: 'High',
            confidence: 'Confirmed',
            description: 'GitHub Issue #88 flags missing disaster recovery failover steps for Redis.',
            reasonForDetection: 'Open issue #88 in synced repository acme/live-payments.',
            suggestedAction: 'Document Redis failover steps before production cutover.',
            relevantSourceIds: [syncedGithubSource.id],
            evidenceReferences: [
              {
                sourceId: syncedGithubSource.id,
                sourceTitle: 'GitHub Sync · acme/live-payments',
                fileName: syncedGithubSource.fileName,
                recordId: 'Issue #88',
                excerpt: 'Failover steps for Redis idempotency cluster are undocumented.',
                relevanceExplanation: 'Explicitly documented in synced GitHub Issue #88.',
              },
            ],
          },
        ];
      },
    });
    assert.equal(gapResult.gaps.length, 1);
    const gapId = gapResult.gaps[0].id;

    // Assign & update status via real HTTP Knowledge Gap routes
    const assignRes = await fetch(`${baseUrl}/api/knowledge-gaps/${gapId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        owner: 'Priya Nair',
        actor: 'Arjun Mehta',
      }),
    });
    assert.equal(assignRes.status, 200);

    const reviewRes = await fetch(`${baseUrl}/api/knowledge-gaps/${gapId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-checkout-v3',
        status: 'In Progress',
        actor: 'Priya Nair',
      }),
    });
    assert.equal(reviewRes.status, 200);

    // Step 3: Ask Evidence-Cited Handover Q&A citing the synced GitHub README, docs/*.md, and Issue #88
    const dbBeforeQa = readDatabase(dbFilePath);
    const projectForQa = dbBeforeQa.projects.find((p) => p.id === 'proj-checkout-v3')!;
    const qaRes = await answerProjectQuestion({
      db: dbBeforeQa,
      project: projectForQa,
      question: 'Why was Redis SETNX selected, what is in redis-failover.md, and what is Issue #88?',
      recentHistory: [],
      responder: async ({ retrievedChunks }) => {
        const readmeChunk = retrievedChunks.find(
          (c) =>
            c.chunk.sourceId === syncedGithubSource.id &&
            c.chunk.locationIdentifier.includes('README.md'),
        );
        const docChunk = retrievedChunks.find(
          (c) =>
            c.chunk.sourceId === syncedGithubSource.id &&
            c.chunk.locationIdentifier.includes('docs/redis-failover.md'),
        );
        assert.ok(readmeChunk, 'Q&A retrieval must surface the synced GitHub README chunk');
        assert.ok(docChunk, 'Q&A retrieval must surface the synced GitHub docs/redis-failover.md chunk');
        return {
          sufficientEvidence: true,
          answer: `Redis SETNX was selected for sub-2ms idempotency locking [${readmeChunk.refId}], and redis-failover.md notes promoting the secondary sentinel [${docChunk.refId}].`,
          citedRefs: [
            {
              refId: readmeChunk.refId,
              snippet: 'Selected Redis SETNX for sub-2ms idempotency locking.',
            },
            {
              refId: docChunk.refId,
              snippet: 'Promote secondary sentinel before clearing stale checkout locks.',
            },
          ],
        };
      },
    });
    assert.equal(qaRes.insufficientEvidence, false);
    assert.ok(qaRes.citations.some((c) => c.sourceId === syncedGithubSource.id));
    assert.ok(qaRes.citations.some((c) => c.locationIdentifier.includes('README.md')));
    assert.ok(qaRes.citations.some((c) => c.locationIdentifier.includes('docs/redis-failover.md')));

    // Step 4: Generate Enriched Handover Pack fusing sources + integrations + gaps
    const db = readDatabase(dbFilePath);
    const project = db.projects.find((p) => p.id === 'proj-checkout-v3')!;
    const projectSources = db.sources.filter((s) => s.projectId === 'proj-checkout-v3');
    const handover = await generateHandoverWithAI({
      project,
      sources: projectSources,
      version: 1,
      knowledgeGaps: db.knowledgeGaps.filter((g) => g.projectId === 'proj-checkout-v3'),
      externalSources: (db.externalSources ?? []).filter((e) => e.projectId === 'proj-checkout-v3'),
      integrations: db.integrations ?? {},
      aiGenerator: async () => ({
        projectSummary: {
          executiveOverview: 'Checkout v3 migration integrating live acme/live-payments repo.',
          architectureContext: 'TypeScript + Stripe PaymentIntents + Redis SETNX.',
          handoverReadinessNote: 'Resolve Issue #88 DR runbook and Issue #24 3DS testing.',
        },
        technologyStack: ['TypeScript', 'Redis SETNX', 'Stripe PaymentIntents'],
        completedTasks: [],
        pendingTasks: [],
        unresolvedIssues: [
          {
            id: 'ui-1',
            title: 'Issue #88: Missing DR runbook for Redis idempotency cluster',
            severity: 'High',
            status: 'Open',
            sourceEvidence: 'GitHub Sync · acme/live-payments · Issue #88',
            sourceId: syncedGithubSource.id,
          },
        ],
        deadlines: [],
        importantFiles: [],
        importantDecisions: [
          {
            id: 'dec-1',
            decision: 'Use Redis SETNX for idempotency locks',
            rationale: 'Provides sub-2ms locking latency.',
            sourceEvidence: 'GitHub Sync · acme/live-payments · README',
            sourceId: syncedGithubSource.id,
          },
        ],
        dependencies: [
          {
            id: 'dep-1',
            name: 'tax-invoicing-svc v2.4',
            details: 'Required for EU VAT invoice PDF generation.',
            owner: 'Maya Lin',
            sourceEvidence: 'payment_v3_handover_runbook.txt',
            sourceId: 'src-pay-docs',
          },
        ],
        missingDocumentation: ['Redis idempotency cluster DR runbook (Issue #88)'],
        operationalInstructions: ['Revert checkout-v3-canary LaunchDarkly flag to 0% on rollback.'],
        risksAndNotes: [],
        suggestedNextActions: ['Author Redis failover runbook assigned to Priya Nair.'],
      }),
    });

    assert.equal(handover.connectedIntegrations?.length, 1);
    assert.equal(handover.connectedIntegrations?.[0].provider, 'github');
    assert.equal(handover.knowledgeGapsSnapshot?.length, 1);
    assert.equal(handover.knowledgeGapsSnapshot?.[0].assignedOwner, 'Priya Nair');
    assert.deepEqual(handover.technologyStack, ['TypeScript', 'Redis SETNX', 'Stripe PaymentIntents']);
    assert.equal(handover.unresolvedIssues?.length, 1);
    assert.equal(handover.importantDecisions?.length, 1);
    assert.equal(handover.dependencies?.length, 1);
  });
});
