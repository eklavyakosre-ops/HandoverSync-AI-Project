import express, { type Express, type Request } from 'express';
import type { IntegrationProviderId } from '../src/types.ts';
import { readDatabase } from './db.ts';
import {
  IntegrationError,
  buildGitHubOAuthUrl,
  buildJiraOAuthUrl,
  buildSlackOAuthUrl,
  completeGitHubOAuthCallback,
  completeJiraOAuthCallback,
  completeSlackOAuthCallback,
  connectGitHubWithToken,
  connectGoogleDriveWithBearer,
  connectJiraWithToken,
  connectSlackWithToken,
  disconnectIntegration,
  listGitHubRepos,
  listGoogleDriveFiles,
  listIntegrationStatuses,
  listJiraProjects,
  listSlackChannels,
  saveIntegrationConfiguration,
  syncGitHubRepo,
  syncGoogleDriveFiles,
  syncJiraProject,
  syncSlackChannels,
  type FetchLike,
} from './integrationService.ts';

function resolveCallbackBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'http';
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string'
      ? forwardedHost.split(',')[0].trim()
      : req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function renderOAuthCallbackHtml(params: {
  ok: boolean;
  provider: IntegrationProviderId;
  message: string;
}): string {
  const payload = JSON.stringify(
    params.ok
      ? { type: 'OAUTH_AUTH_SUCCESS', provider: params.provider }
      : { type: 'OAUTH_AUTH_ERROR', provider: params.provider, error: params.message },
  );
  const safeMessage = params.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HandoverSync AI — ${params.provider.toUpperCase()} Authorization</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 32px; color: #0f172a; background: #f8fafc; }
    .card { max-width: 440px; margin: 40px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
    h1 { font-size: 16px; margin: 0 0 8px; }
    p { font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    button { padding: 8px 14px; font-size: 12px; font-weight: 600; background: #1d4ed8; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${params.ok ? 'Authorization Successful' : 'Authorization Failed'}</h1>
    <p>${safeMessage}</p>
    <button onclick="window.close()">Close Window</button>
  </div>
  <script>
    (function() {
      var payload = ${payload};
      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }
      if (${params.ok ? 'true' : 'false'}) {
        setTimeout(function() { window.close(); }, 350);
      }
    })();
  </script>
</body>
</html>`;
}

function sendIntegrationError(res: express.Response, err: unknown) {
  if (err instanceof IntegrationError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  const message = err instanceof Error ? err.message : 'Integration request failed.';
  res.status(500).json({ error: message });
}

export function registerIntegrationRoutes(
  app: Express,
  options?: { fetchFn?: FetchLike; dbFilePath?: string },
): void {
  const fetchFn = options?.fetchFn;
  const dbFilePath = options?.dbFilePath;

  // List all provider statuses + sync history + external sources for optional projectId
  app.get('/api/integrations', (req, res) => {
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId.trim()
        ? req.query.projectId.trim()
        : undefined;
    const db = readDatabase(dbFilePath);
    const data = listIntegrationStatuses(db, resolveCallbackBaseUrl(req), projectId);
    res.json(data);
  });

  app.get('/api/integrations/history', (req, res) => {
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId.trim()
        ? req.query.projectId.trim()
        : undefined;
    const db = readDatabase(dbFilePath);
    const data = listIntegrationStatuses(db, resolveCallbackBaseUrl(req), projectId);
    res.json({ syncRuns: data.syncRuns, externalSources: data.externalSources });
  });

  app.put('/api/integrations/:provider/configure', (req, res) => {
    try {
      const provider = req.params.provider as IntegrationProviderId;
      if (!['github', 'drive', 'jira', 'slack'].includes(provider)) {
        res.status(400).json({ error: 'Unknown integration provider.' });
        return;
      }
      const {
        projectId,
        selectedTargetId,
        selectedTargetLabel,
        includeCommits,
        includeIssues,
        includePullRequests,
        includeDocs,
      } = req.body as {
        projectId?: string;
        selectedTargetId?: string;
        selectedTargetLabel?: string;
        includeCommits?: boolean;
        includeIssues?: boolean;
        includePullRequests?: boolean;
        includeDocs?: boolean;
      };
      if (!projectId || !selectedTargetId) {
        res.status(400).json({ error: 'projectId and selectedTargetId are required.' });
        return;
      }
      const configuration = saveIntegrationConfiguration({
        projectId,
        provider,
        selectedTargetId,
        selectedTargetLabel,
        includeCommits,
        includeIssues,
        includePullRequests,
        includeDocs,
        dbFilePath,
      });
      res.json({ configuration });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.post('/api/integrations/:provider/disconnect', (req, res) => {
    const provider = req.params.provider as IntegrationProviderId;
    if (!['github', 'drive', 'jira', 'slack'].includes(provider)) {
      res.status(400).json({ error: 'Unknown integration provider.' });
      return;
    }
    const account = disconnectIntegration(provider, dbFilePath, resolveCallbackBaseUrl(req));
    res.json({ account });
  });

  // --- GitHub Routes ---

  app.get('/api/integrations/github/oauth-url', (req, res) => {
    try {
      const url = buildGitHubOAuthUrl(resolveCallbackBaseUrl(req));
      res.json({ url });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get(
    ['/api/integrations/github/callback', '/api/integrations/github/callback/'],
    async (req, res) => {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const oauthError = typeof req.query.error_description === 'string'
        ? req.query.error_description
        : typeof req.query.error === 'string'
          ? req.query.error
          : '';

      if (oauthError || !code || !state) {
        res
          .status(400)
          .type('html')
          .send(
            renderOAuthCallbackHtml({
              ok: false,
              provider: 'github',
              message: oauthError || 'GitHub authorization was cancelled or missing code.',
            }),
          );
        return;
      }

      try {
        await completeGitHubOAuthCallback({ code, state, fetchFn, dbFilePath });
        res.type('html').send(
          renderOAuthCallbackHtml({
            ok: true,
            provider: 'github',
            message: 'GitHub connected successfully. This window will close automatically.',
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'GitHub OAuth failed.';
        res.status(400).type('html').send(
          renderOAuthCallbackHtml({ ok: false, provider: 'github', message: msg }),
        );
      }
    },
  );

  app.post('/api/integrations/github/connect', async (req, res) => {
    try {
      const { token } = req.body as { token?: string };
      const account = await connectGitHubWithToken({
        token: token || '',
        authMode: 'token',
        fetchFn,
        dbFilePath,
      });
      res.json({ account });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get('/api/integrations/github/repos', async (_req, res) => {
    try {
      const result = await listGitHubRepos({ fetchFn, dbFilePath });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.post('/api/integrations/github/sync', async (req, res) => {
    try {
      const { projectId, repoFullName } = req.body as {
        projectId?: string;
        repoFullName?: string;
      };
      if (!projectId) {
        res.status(400).json({ error: 'projectId is required.' });
        return;
      }
      const result = await syncGitHubRepo({ projectId, repoFullName, fetchFn, dbFilePath });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  // --- Google Drive Routes (Bearer token via Firebase Workspace OAuth) ---

  app.post('/api/integrations/drive/connect', async (req, res) => {
    try {
      const accessToken = extractBearerToken(req);
      const account = await connectGoogleDriveWithBearer({
        accessToken,
        fetchFn,
        dbFilePath,
      });
      res.json({ account });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get('/api/integrations/drive/files', async (req, res) => {
    try {
      const accessToken = extractBearerToken(req);
      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const files = await listGoogleDriveFiles({ accessToken, query, fetchFn });
      res.json({ files });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.post('/api/integrations/drive/sync', async (req, res) => {
    try {
      const accessToken = extractBearerToken(req);
      const { projectId, fileIds } = req.body as {
        projectId?: string;
        fileIds?: string[];
      };
      if (!projectId || !Array.isArray(fileIds)) {
        res.status(400).json({ error: 'projectId and fileIds array are required.' });
        return;
      }
      const result = await syncGoogleDriveFiles({
        projectId,
        accessToken,
        fileIds,
        fetchFn,
        dbFilePath,
      });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  // --- Jira Routes ---

  app.get('/api/integrations/jira/oauth-url', (req, res) => {
    try {
      const url = buildJiraOAuthUrl(resolveCallbackBaseUrl(req));
      res.json({ url });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get(
    ['/api/integrations/jira/callback', '/api/integrations/jira/callback/'],
    async (req, res) => {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!code || !state) {
        res.status(400).type('html').send(
          renderOAuthCallbackHtml({
            ok: false,
            provider: 'jira',
            message: 'Jira authorization was cancelled or missing code.',
          }),
        );
        return;
      }
      try {
        await completeJiraOAuthCallback({ code, state, fetchFn, dbFilePath });
        res.type('html').send(
          renderOAuthCallbackHtml({
            ok: true,
            provider: 'jira',
            message: 'Jira connected successfully. This window will close automatically.',
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Jira OAuth failed.';
        res.status(400).type('html').send(
          renderOAuthCallbackHtml({ ok: false, provider: 'jira', message: msg }),
        );
      }
    },
  );

  app.post('/api/integrations/jira/connect', async (req, res) => {
    try {
      const { siteUrl, email, apiToken } = req.body as {
        siteUrl?: string;
        email?: string;
        apiToken?: string;
      };
      const account = await connectJiraWithToken({
        siteUrl: siteUrl || '',
        email: email || '',
        apiToken: apiToken || '',
        fetchFn,
        dbFilePath,
      });
      res.json({ account });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get('/api/integrations/jira/projects', async (_req, res) => {
    try {
      const projects = await listJiraProjects({ fetchFn, dbFilePath });
      res.json({ projects });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.post('/api/integrations/jira/sync', async (req, res) => {
    try {
      const { projectId, jiraProjectKey } = req.body as {
        projectId?: string;
        jiraProjectKey?: string;
      };
      if (!projectId || !jiraProjectKey) {
        res.status(400).json({ error: 'projectId and jiraProjectKey are required.' });
        return;
      }
      const result = await syncJiraProject({ projectId, jiraProjectKey, fetchFn, dbFilePath });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  // --- Slack Routes ---

  app.get('/api/integrations/slack/oauth-url', (req, res) => {
    try {
      const url = buildSlackOAuthUrl(resolveCallbackBaseUrl(req));
      res.json({ url });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get(
    ['/api/integrations/slack/callback', '/api/integrations/slack/callback/'],
    async (req, res) => {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const errParam = typeof req.query.error === 'string' ? req.query.error : '';
      if (errParam || !code || !state) {
        res.status(400).type('html').send(
          renderOAuthCallbackHtml({
            ok: false,
            provider: 'slack',
            message: errParam || 'Slack authorization was cancelled or missing code.',
          }),
        );
        return;
      }
      try {
        await completeSlackOAuthCallback({ code, state, fetchFn, dbFilePath });
        res.type('html').send(
          renderOAuthCallbackHtml({
            ok: true,
            provider: 'slack',
            message: 'Slack connected successfully. This window will close automatically.',
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Slack OAuth failed.';
        res.status(400).type('html').send(
          renderOAuthCallbackHtml({ ok: false, provider: 'slack', message: msg }),
        );
      }
    },
  );

  app.post('/api/integrations/slack/connect', async (req, res) => {
    try {
      const { token } = req.body as { token?: string };
      const account = await connectSlackWithToken({
        token: token || '',
        authMode: 'token',
        fetchFn,
        dbFilePath,
      });
      res.json({ account });
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.get('/api/integrations/slack/channels', async (_req, res) => {
    try {
      const result = await listSlackChannels({ fetchFn, dbFilePath });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });

  app.post('/api/integrations/slack/sync', async (req, res) => {
    try {
      const { projectId, channels } = req.body as {
        projectId?: string;
        channels?: Array<{ id: string; name?: string }>;
      };
      if (!projectId || !Array.isArray(channels)) {
        res.status(400).json({ error: 'projectId and channels array are required.' });
        return;
      }
      const result = await syncSlackChannels({ projectId, channels, fetchFn, dbFilePath });
      res.json(result);
    } catch (err) {
      sendIntegrationError(res, err);
    }
  });
}

export function createIntegrationTestApp(options: {
  fetchFn?: FetchLike;
  dbFilePath: string;
}): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerIntegrationRoutes(app, options);
  return app;
}
