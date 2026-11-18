import crypto from 'node:crypto';
import type {
  ActivitySource,
  ExternalSourceRecord,
  ExternalSourceType,
  HandoverDatabase,
  IntegrationAccount,
  IntegrationConfiguration,
  IntegrationProviderId,
  IntegrationProviderStatusDTO,
  IntegrationSyncRun,
  SourceKind,
} from '../src/types.ts';
import { readDatabase, writeDatabase } from './db.ts';

export type FetchLike = typeof fetch;

export class IntegrationError extends Error {
  statusCode: number;
  code?: string;
  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface PendingOAuthState {
  provider: IntegrationProviderId;
  createdAt: number;
  callbackUrl: string;
}

const oauthStates = new Map<string, PendingOAuthState>();
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function pruneOAuthStates(): void {
  const now = Date.now();
  for (const [k, v] of oauthStates.entries()) {
    if (now - v.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStates.delete(k);
    }
  }
}

export function createOAuthState(provider: IntegrationProviderId, callbackUrl: string): string {
  pruneOAuthStates();
  const state = crypto.randomBytes(20).toString('hex');
  oauthStates.set(state, { provider, createdAt: Date.now(), callbackUrl });
  return state;
}

export function consumeOAuthState(
  state: string,
  expectedProvider: IntegrationProviderId,
): PendingOAuthState | null {
  pruneOAuthStates();
  const entry = oauthStates.get(state);
  if (!entry || entry.provider !== expectedProvider) {
    return null;
  }
  oauthStates.delete(state);
  return entry;
}

export function sanitizeExternalText(input: string, maxLength = 80_000): string {
  const cleaned = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}\n\n[Truncated after ${maxLength} characters]`;
}

export function getProviderMeta(
  provider: IntegrationProviderId,
  callbackBaseUrl: string,
): {
  displayName: string;
  oauthConfigured: boolean;
  tokenAuthSupported: boolean;
  callbackUrl?: string;
  setupInstructions: string;
} {
  const cleanBase = callbackBaseUrl.replace(/\/+$/, '');
  switch (provider) {
    case 'github': {
      const oauthConfigured = Boolean(
        process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim(),
      );
      const callbackUrl = `${cleanBase}/api/integrations/github/callback`;
      return {
        displayName: 'GitHub',
        oauthConfigured,
        tokenAuthSupported: false,
        callbackUrl,
        setupInstructions: oauthConfigured
          ? 'Authorize securely via GitHub OAuth (scopes: repo, read:user). Access tokens are stored exclusively on the backend.'
          : `Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and APP_URL on the server and register callback URL: ${callbackUrl}`,
      };
    }
    case 'drive': {
      return {
        displayName: 'Google Drive',
        oauthConfigured: true,
        tokenAuthSupported: false,
        setupInstructions:
          'Authenticate with your Google account using official Google Workspace OAuth (drive.readonly scope). Access tokens stay in browser memory only.',
      };
    }
    case 'jira': {
      const oauthConfigured = Boolean(
        process.env.JIRA_CLIENT_ID?.trim() && process.env.JIRA_CLIENT_SECRET?.trim(),
      );
      const callbackUrl = `${cleanBase}/api/integrations/jira/callback`;
      return {
        displayName: 'Jira',
        oauthConfigured,
        tokenAuthSupported: false,
        callbackUrl,
        setupInstructions: oauthConfigured
          ? 'Authorize via Atlassian Jira Cloud OAuth 2.0 (read:jira-work, read:jira-user).'
          : `Set JIRA_CLIENT_ID, JIRA_CLIENT_SECRET, and APP_URL on the server and register callback URL: ${callbackUrl}`,
      };
    }
    case 'slack': {
      const oauthConfigured = Boolean(
        process.env.SLACK_CLIENT_ID?.trim() && process.env.SLACK_CLIENT_SECRET?.trim(),
      );
      const callbackUrl = `${cleanBase}/api/integrations/slack/callback`;
      return {
        displayName: 'Slack',
        oauthConfigured,
        tokenAuthSupported: false,
        callbackUrl,
        setupInstructions: oauthConfigured
          ? 'Authorize via Slack OAuth v2 (channels:read, channels:history, groups:read, groups:history).'
          : `Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and APP_URL on the server and register callback URL: ${callbackUrl}`,
      };
    }
  }
}

function getDefaultAccount(
  provider: IntegrationProviderId,
  oauthConfigured: boolean,
  existing?: IntegrationAccount,
): IntegrationAccount {
  if (existing) {
    return { ...existing, provider };
  }
  return {
    provider,
    status: oauthConfigured ? 'disconnected' : 'not_configured',
  };
}

export function listIntegrationStatuses(
  db: HandoverDatabase,
  callbackBaseUrl: string,
  projectId?: string,
): {
  providers: IntegrationProviderStatusDTO[];
  configurations: IntegrationConfiguration[];
  syncRuns: IntegrationSyncRun[];
  externalSources: ExternalSourceRecord[];
} {
  const providerOrder: IntegrationProviderId[] = ['github', 'drive', 'jira', 'slack'];
  const accounts = db.integrations ?? {};
  const secrets = db.integrationSecrets ?? {};

  const providers: IntegrationProviderStatusDTO[] = providerOrder.map((provider) => {
    const meta = getProviderMeta(provider, callbackBaseUrl);
    const stored = getDefaultAccount(provider, meta.oauthConfigured, accounts[provider]);

    if (provider !== 'drive') {
      const hasSecret = Boolean(secrets[provider]?.accessToken);
      if (stored.status === 'connected' && !hasSecret) {
        stored.status = meta.oauthConfigured ? 'disconnected' : 'not_configured';
      } else if (stored.status === 'disconnected' && !meta.oauthConfigured && !hasSecret) {
        stored.status = 'not_configured';
      } else if (stored.status === 'not_configured' && meta.oauthConfigured) {
        stored.status = 'disconnected';
      }
    }

    return {
      provider,
      displayName: meta.displayName,
      oauthConfigured: meta.oauthConfigured,
      tokenAuthSupported: meta.tokenAuthSupported,
      callbackUrl: meta.callbackUrl,
      setupInstructions: meta.setupInstructions,
      account: stored,
    };
  });

  const configurations = (db.integrationConfigurations ?? [])
    .filter((c) => !projectId || c.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const syncRuns = (db.syncRuns ?? [])
    .filter((r) => !projectId || r.projectId === projectId)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  const externalSources = (db.externalSources ?? [])
    .filter((e) => !projectId || e.projectId === projectId)
    .sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());

  return { providers, configurations, syncRuns, externalSources };
}

export function upsertIntegrationConfigurationInDb(
  db: HandoverDatabase,
  params: {
    projectId: string;
    provider: IntegrationProviderId;
    selectedTargetId: string;
    selectedTargetLabel?: string;
    includeCommits?: boolean;
    includeIssues?: boolean;
    includePullRequests?: boolean;
    includeDocs?: boolean;
  },
): IntegrationConfiguration {
  const {
    projectId,
    provider,
    selectedTargetId,
    selectedTargetLabel,
    includeCommits = true,
    includeIssues = true,
    includePullRequests = true,
    includeDocs = true,
  } = params;

  const cleanTarget = selectedTargetId.trim();
  if (!cleanTarget) {
    throw new IntegrationError('Target repository/project/channel identifier is required.', 400);
  }

  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new IntegrationError('Target project not found.', 404);
  }

  db.integrationConfigurations = db.integrationConfigurations ?? [];
  const now = new Date().toISOString();
  const existing = db.integrationConfigurations.find(
    (c) => c.projectId === projectId && c.provider === provider,
  );

  if (existing) {
    existing.selectedTargetId = cleanTarget;
    existing.selectedTargetLabel = selectedTargetLabel?.trim() || cleanTarget;
    existing.includeCommits = includeCommits;
    existing.includeIssues = includeIssues;
    existing.includePullRequests = includePullRequests;
    existing.includeDocs = includeDocs;
    existing.updatedAt = now;
    return existing;
  }

  const created: IntegrationConfiguration = {
    id: `cfg-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    provider,
    selectedTargetId: cleanTarget,
    selectedTargetLabel: selectedTargetLabel?.trim() || cleanTarget,
    includeCommits,
    includeIssues,
    includePullRequests,
    includeDocs,
    updatedAt: now,
  };
  db.integrationConfigurations.unshift(created);
  return created;
}

export function saveIntegrationConfiguration(params: {
  projectId: string;
  provider: IntegrationProviderId;
  selectedTargetId: string;
  selectedTargetLabel?: string;
  includeCommits?: boolean;
  includeIssues?: boolean;
  includePullRequests?: boolean;
  includeDocs?: boolean;
  dbFilePath?: string;
}): IntegrationConfiguration {
  const { dbFilePath, ...rest } = params;
  const db = readDatabase(dbFilePath);
  const config = upsertIntegrationConfigurationInDb(db, rest);
  writeDatabase(db, dbFilePath);
  return config;
}

function upsertProjectSourceFromIntegration(params: {
  db: HandoverDatabase;
  projectId: string;
  provider: IntegrationProviderId;
  externalId: string;
  sourceType?: ExternalSourceType;
  externalUrl?: string;
  title: string;
  kind: SourceKind;
  fileName: string;
  addedBy: string;
  authorOrAssignee?: string;
  recordCount: number;
  content: string;
  metadataSummary: string;
  highlights?: string[];
  base64Data?: string;
  mimeType?: string;
  createdAt?: string;
  updatedAt?: string;
}): { source: ActivitySource; externalRecord: ExternalSourceRecord; updatedExisting: boolean } {
  const {
    db,
    projectId,
    provider,
    externalId,
    sourceType,
    externalUrl,
    title,
    kind,
    fileName,
    addedBy,
    authorOrAssignee,
    recordCount,
    content,
    metadataSummary,
    highlights,
    base64Data,
    mimeType,
    createdAt,
    updatedAt,
  } = params;

  db.externalSources = db.externalSources ?? [];
  const now = new Date().toISOString();
  const contentPreview = content.length > 2500 ? `${content.slice(0, 2500)}...` : content;

  const existingExt = db.externalSources.find(
    (e) => e.projectId === projectId && e.provider === provider && e.externalId === externalId,
  );

  if (existingExt) {
    const existingSrc = db.sources.find(
      (s) => s.id === existingExt.sourceId && s.projectId === projectId,
    );
    if (existingSrc) {
      existingSrc.title = title;
      existingSrc.kind = kind;
      existingSrc.fileName = fileName;
      existingSrc.addedBy = addedBy;
      existingSrc.addedAt = now;
      existingSrc.recordCount = recordCount;
      existingSrc.content = content;
      existingSrc.highlights = highlights;
      if (base64Data) {
        existingSrc.base64Data = base64Data;
        existingSrc.mimeType = mimeType || 'application/pdf';
      } else {
        delete existingSrc.base64Data;
        delete existingSrc.mimeType;
      }

      existingExt.internalSourceId = existingSrc.id;
      existingExt.sourceType = sourceType ?? existingExt.sourceType;
      existingExt.title = title;
      existingExt.content = contentPreview;
      existingExt.authorOrAssignee = authorOrAssignee ?? addedBy;
      existingExt.externalUrl = externalUrl;
      existingExt.createdAt = existingExt.createdAt || createdAt || now;
      existingExt.updatedAt = updatedAt || now;
      existingExt.syncedAt = now;
      existingExt.metadataSummary = metadataSummary;

      return { source: existingSrc, externalRecord: existingExt, updatedExisting: true };
    }
  }

  const sourceId = `src-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newSource: ActivitySource = {
    id: sourceId,
    projectId,
    title,
    kind,
    fileName,
    addedBy,
    addedAt: now,
    recordCount,
    content,
    ...(highlights ? { highlights } : {}),
    ...(base64Data ? { base64Data, mimeType: mimeType || 'application/pdf' } : {}),
  };
  db.sources.unshift(newSource);

  const newExt: ExternalSourceRecord = existingExt ?? {
    id: `ext-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    internalSourceId: sourceId,
    projectId,
    provider,
    externalId,
    sourceType,
    externalUrl,
    title,
    content: contentPreview,
    authorOrAssignee: authorOrAssignee ?? addedBy,
    sourceId,
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    syncedAt: now,
    metadataSummary,
  };
  newExt.internalSourceId = sourceId;
  newExt.sourceId = sourceId;
  newExt.sourceType = sourceType ?? newExt.sourceType;
  newExt.title = title;
  newExt.content = contentPreview;
  newExt.authorOrAssignee = authorOrAssignee ?? addedBy;
  newExt.externalUrl = externalUrl;
  newExt.createdAt = newExt.createdAt || createdAt || now;
  newExt.updatedAt = updatedAt || now;
  newExt.syncedAt = now;
  newExt.metadataSummary = metadataSummary;

  if (!existingExt) {
    db.externalSources.unshift(newExt);
  }

  return { source: newSource, externalRecord: newExt, updatedExisting: false };
}

function recordSyncRun(db: HandoverDatabase, run: IntegrationSyncRun): void {
  db.syncRuns = db.syncRuns ?? [];
  db.syncRuns.unshift(run);
  if (db.syncRuns.length > 100) {
    db.syncRuns = db.syncRuns.slice(0, 100);
  }
}

export function disconnectIntegration(
  provider: IntegrationProviderId,
  dbFilePath?: string,
  callbackBaseUrl = 'http://localhost:3000',
): IntegrationAccount {
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  db.integrationSecrets = db.integrationSecrets ?? {};

  delete db.integrationSecrets[provider];
  const meta = getProviderMeta(provider, callbackBaseUrl);
  const disconnected: IntegrationAccount = {
    provider,
    status: meta.oauthConfigured ? 'disconnected' : 'not_configured',
  };
  db.integrations[provider] = disconnected;
  writeDatabase(db, dbFilePath);
  return disconnected;
}

// ============================================================================
// 1. GITHUB ADAPTER
// ============================================================================

function parseGitHubRateLimit(res: Response): {
  remaining?: number;
  limit?: number;
  warning?: string;
} {
  const remHeader = res.headers.get('x-ratelimit-remaining');
  const limitHeader = res.headers.get('x-ratelimit-limit');
  const remaining = remHeader !== null ? Number(remHeader) : undefined;
  const limit = limitHeader !== null ? Number(limitHeader) : undefined;

  if (typeof remaining === 'number' && !Number.isNaN(remaining) && remaining <= 10) {
    return {
      remaining,
      limit: typeof limit === 'number' && !Number.isNaN(limit) ? limit : undefined,
      warning: `GitHub API rate limit is low (${remaining} requests remaining).`,
    };
  }
  return {
    remaining: typeof remaining === 'number' && !Number.isNaN(remaining) ? remaining : undefined,
    limit: typeof limit === 'number' && !Number.isNaN(limit) ? limit : undefined,
  };
}

function githubHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'User-Agent': 'HandoverSync-AI/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function buildGitHubOAuthUrl(callbackBaseUrl: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError(
      'GitHub OAuth is not configured on the server. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and APP_URL.',
      400,
      'not_configured',
    );
  }
  const callbackUrl = `${callbackBaseUrl.replace(/\/+$/, '')}/api/integrations/github/callback`;
  const state = createOAuthState('github', callbackUrl);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'repo read:user');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function completeGitHubOAuthCallback(params: {
  code: string;
  state: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { code, state, fetchFn = fetch, dbFilePath } = params;
  const pending = consumeOAuthState(state, 'github');
  if (!pending) {
    throw new IntegrationError('Invalid or expired GitHub OAuth state.', 400);
  }
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError('GitHub OAuth client credentials are not configured.', 500);
  }

  const tokenRes = await fetchFn('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: pending.callbackUrl,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new IntegrationError(
      tokenData.error_description || tokenData.error || 'Failed to exchange GitHub OAuth code.',
      401,
    );
  }

  return connectGitHubWithToken({
    token: tokenData.access_token,
    authMode: 'oauth',
    fetchFn,
    dbFilePath,
  });
}

export async function connectGitHubWithToken(params: {
  token: string;
  authMode?: 'oauth' | 'token';
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { token, authMode = 'token', fetchFn = fetch, dbFilePath } = params;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new IntegrationError('GitHub access token is required.', 400);
  }

  const res = await fetchFn('https://api.github.com/user', {
    headers: githubHeaders(trimmed),
  });
  const rl = parseGitHubRateLimit(res);

  if (!res.ok) {
    let detail = `GitHub authentication failed (HTTP ${res.status}).`;
    try {
      const errJson = (await res.json()) as { message?: string };
      if (errJson.message) detail = `GitHub error: ${errJson.message}`;
    } catch {
      // ignore json parse failure
    }
    const db = readDatabase(dbFilePath);
    db.integrations = db.integrations ?? {};
    db.integrationSecrets = db.integrationSecrets ?? {};
    delete db.integrationSecrets.github;
    db.integrations.github = {
      provider: 'github',
      status: 'error',
      lastError: detail,
    };
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(detail, res.status === 401 || res.status === 403 ? 401 : res.status);
  }

  const user = (await res.json()) as {
    login: string;
    name?: string | null;
    email?: string | null;
  };

  const now = new Date().toISOString();
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  db.integrationSecrets = db.integrationSecrets ?? {};

  db.integrationSecrets.github = {
    provider: 'github',
    accessToken: trimmed,
    updatedAt: now,
  };

  const previous = db.integrations.github;
  const account: IntegrationAccount = {
    provider: 'github',
    status: 'connected',
    authMode,
    accountLabel: `@${user.login}`,
    workspaceName: user.name || user.login,
    selectedTargetId: previous?.selectedTargetId,
    selectedTargetLabel: previous?.selectedTargetLabel,
    connectedAt: now,
    lastSyncAt: previous?.lastSyncAt,
    lastSyncCount: previous?.lastSyncCount,
    rateLimitRemaining: rl.remaining,
    rateLimitLimit: rl.limit,
  };
  db.integrations.github = account;
  writeDatabase(db, dbFilePath);
  return account;
}

export interface GitHubRepoItem {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string;
  htmlUrl: string;
  updatedAt: string;
  language: string | null;
}

export async function listGitHubRepos(params: {
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{
  repos: GitHubRepoItem[];
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  warning?: string;
}> {
  const { fetchFn = fetch, dbFilePath } = params;
  const db = readDatabase(dbFilePath);
  const token = db.integrationSecrets?.github?.accessToken;
  if (!token) {
    throw new IntegrationError('GitHub is not connected. Connect your GitHub account first.', 401);
  }

  const res = await fetchFn('https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator,organization_member', {
    headers: githubHeaders(token),
  });
  const rl = parseGitHubRateLimit(res);

  if (!res.ok) {
    const errBody = await res.text();
    let msg = `Failed to list GitHub repositories (HTTP ${res.status}).`;
    try {
      const parsed = JSON.parse(errBody) as { message?: string };
      if (parsed.message) msg = `GitHub API error: ${parsed.message}`;
    } catch {
      // ignore
    }
    if (res.status === 401) {
      db.integrations = db.integrations ?? {};
      db.integrations.github = {
        provider: 'github',
        status: 'error',
        lastError: msg,
      };
      delete db.integrationSecrets?.github;
      writeDatabase(db, dbFilePath);
    }
    throw new IntegrationError(msg, res.status === 403 && rl.remaining === 0 ? 429 : res.status);
  }

  const rawRepos = (await res.json()) as Array<{
    id: number;
    full_name: string;
    name: string;
    owner?: { login?: string };
    private: boolean;
    default_branch: string;
    description: string | null;
    html_url: string;
    updated_at: string;
    language: string | null;
  }>;

  if (db.integrations?.github) {
    db.integrations.github.rateLimitRemaining = rl.remaining;
    db.integrations.github.rateLimitLimit = rl.limit;
    writeDatabase(db, dbFilePath);
  }

  return {
    repos: rawRepos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner?.login || r.full_name.split('/')[0] || '',
      private: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      description: r.description || '',
      htmlUrl: r.html_url,
      updatedAt: r.updated_at,
      language: r.language,
    })),
    rateLimitRemaining: rl.remaining,
    rateLimitLimit: rl.limit,
    warning: rl.warning,
  };
}

export async function syncGitHubRepo(params: {
  projectId: string;
  repoFullName?: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{
  source: ActivitySource;
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  configuration: IntegrationConfiguration;
  warning?: string;
}> {
  const { projectId, fetchFn = fetch, dbFilePath } = params;
  const startedAt = new Date().toISOString();
  const db = readDatabase(dbFilePath);

  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new IntegrationError('Target project not found.', 404);
  }

  const token = db.integrationSecrets?.github?.accessToken;
  if (!token) {
    throw new IntegrationError('GitHub is not connected. Authorize GitHub before syncing.', 401);
  }

  const savedConfig = (db.integrationConfigurations ?? []).find(
    (c) => c.projectId === projectId && c.provider === 'github',
  );
  const rawRepoInput = params.repoFullName?.trim() || savedConfig?.selectedTargetId || '';
  const cleanRepo = rawRepoInput.replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
  const parts = cleanRepo.split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new IntegrationError('Repository must be in "owner/repo" format.', 400);
  }
  const [owner, repo] = parts;
  const repoApiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  try {
    const repoRes = await fetchFn(repoApiBase, { headers: githubHeaders(token) });
    let rateInfo = parseGitHubRateLimit(repoRes);

    if (!repoRes.ok) {
      let msg = `Failed to fetch repository ${cleanRepo} (HTTP ${repoRes.status}).`;
      try {
        const err = (await repoRes.json()) as { message?: string };
        if (err.message) msg = `GitHub error: ${err.message}`;
      } catch {
        // ignore
      }
      throw new IntegrationError(
        msg,
        repoRes.status === 403 && rateInfo.remaining === 0 ? 429 : repoRes.status,
      );
    }

    const projectConfig = (db.integrationConfigurations ?? []).find(
      (c) => c.projectId === projectId && c.provider === 'github',
    );
    const includeCommits = projectConfig?.includeCommits !== false;
    const includeIssues = projectConfig?.includeIssues !== false;
    const includePullRequests = projectConfig?.includePullRequests !== false;
    const includeDocs = projectConfig?.includeDocs !== false;

    const repoData = (await repoRes.json()) as {
      full_name: string;
      html_url: string;
      description: string | null;
      default_branch: string;
      language: string | null;
      topics?: string[];
      open_issues_count?: number;
      created_at?: string;
      updated_at?: string;
      owner?: { login?: string };
    };

    const [commitsRes, issuesRes, pullsRes, readmeRes, docsListRes] = await Promise.all([
      includeCommits
        ? fetchFn(`${repoApiBase}/commits?per_page=15`, { headers: githubHeaders(token) })
        : Promise.resolve(new Response('[]', { status: 200 })),
      includeIssues
        ? fetchFn(`${repoApiBase}/issues?state=all&per_page=30`, { headers: githubHeaders(token) })
        : Promise.resolve(new Response('[]', { status: 200 })),
      includePullRequests
        ? fetchFn(`${repoApiBase}/pulls?state=all&per_page=25`, { headers: githubHeaders(token) })
        : Promise.resolve(new Response('[]', { status: 200 })),
      includeDocs
        ? fetchFn(`${repoApiBase}/readme`, {
            headers: githubHeaders(token, 'application/vnd.github.raw+json'),
          })
        : Promise.resolve(new Response('', { status: 404 })),
      includeDocs
        ? fetchFn(`${repoApiBase}/contents/docs`, { headers: githubHeaders(token) })
        : Promise.resolve(new Response('[]', { status: 404 })),
    ]);

    for (const r of [commitsRes, issuesRes, pullsRes, readmeRes, docsListRes]) {
      const nextRate = parseGitHubRateLimit(r);
      if (nextRate.remaining !== undefined) {
        rateInfo = nextRate;
      }
      if (r.status === 429 || (r.status === 403 && nextRate.remaining === 0)) {
        throw new IntegrationError(
          'GitHub API rate limit exceeded while fetching repository records.',
          429,
        );
      }
      if (r.status >= 500) {
        throw new IntegrationError(
          `GitHub upstream API error (HTTP ${r.status}) while syncing ${cleanRepo}.`,
          502,
        );
      }
    }

    const commitsRaw = commitsRes.ok
      ? ((await commitsRes.json()) as Array<{
          sha: string;
          html_url: string;
          commit: { message: string; author?: { name?: string; date?: string } };
        }>)
      : [];

    const issuesRaw = issuesRes.ok
      ? ((await issuesRes.json()) as Array<{
          number: number;
          title: string;
          state: string;
          html_url: string;
          body: string | null;
          labels?: Array<{ name?: string }>;
          assignee?: { login?: string } | null;
          user?: { login?: string } | null;
          pull_request?: unknown;
          created_at: string;
          updated_at: string;
        }>)
      : [];

    const pullsRaw = pullsRes.ok
      ? ((await pullsRes.json()) as Array<{
          number: number;
          title: string;
          state: string;
          html_url: string;
          user?: { login?: string } | null;
          merged_at?: string | null;
          created_at?: string;
          updated_at: string;
          body?: string | null;
        }>)
      : [];

    const readmeText = readmeRes.ok
      ? sanitizeExternalText(await readmeRes.text(), 12_000)
      : '';

    const documentationFiles: Array<{ path: string; url: string; content: string }> = [];
    if (includeDocs && docsListRes.ok) {
      try {
        const docsEntries = (await docsListRes.json()) as Array<{
          type?: string;
          path?: string;
          name?: string;
          html_url?: string;
          url?: string;
        }>;
        if (Array.isArray(docsEntries)) {
          const mdFiles = docsEntries
            .filter(
              (f) =>
                f.type === 'file' &&
                f.name &&
                /\.(md|txt|rst)$/i.test(f.name) &&
                f.url,
            )
            .slice(0, 4);
          for (const docFile of mdFiles) {
            const docRes = await fetchFn(docFile.url!, {
              headers: githubHeaders(token, 'application/vnd.github.raw+json'),
            });
            if (docRes.ok) {
              documentationFiles.push({
                path: docFile.path || docFile.name || 'docs/guide.md',
                url: docFile.html_url || `${repoData.html_url}/blob/${repoData.default_branch}/${docFile.path}`,
                content: sanitizeExternalText(await docRes.text(), 6000),
              });
            }
          }
        }
      } catch {
        // ignore docs folder parse errors cleanly
      }
    }

    const pureIssues = issuesRaw
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: sanitizeExternalText(i.title, 300),
        state: i.state,
        labels: (i.labels ?? []).map((l) => l.name).filter(Boolean),
        assignee: i.assignee?.login ?? 'unassigned',
        author: i.user?.login ?? 'unknown',
        url: i.html_url,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        body: sanitizeExternalText(i.body || '', 1500),
      }));

    const pullRequests = pullsRaw.map((pr) => ({
      number: pr.number,
      title: sanitizeExternalText(pr.title, 300),
      state: pr.merged_at ? 'merged' : pr.state,
      mergedAt: pr.merged_at ?? undefined,
      author: pr.user?.login ?? 'unknown',
      url: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      summary: sanitizeExternalText(pr.body || '', 800),
    }));

    const commits = commitsRaw.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: sanitizeExternalText(c.commit.message.split('\n')[0] || '', 240),
      author: c.commit.author?.name || 'unknown',
      date: c.commit.author?.date || '',
      url: c.html_url,
    }));

    const structuredPayload = {
      repository: repoData.full_name,
      url: repoData.html_url,
      branch: repoData.default_branch,
      language: repoData.language,
      topics: repoData.topics ?? [],
      description: repoData.description ?? '',
      createdAt: repoData.created_at,
      updatedAt: repoData.updated_at,
      syncedAt: new Date().toISOString(),
      commits,
      issues: pureIssues,
      pullRequests,
      readmeExcerpt: readmeText,
      ...(documentationFiles.length > 0 ? { documentationFiles } : {}),
    };

    const recordsFetched =
      commits.length +
      pureIssues.length +
      pullRequests.length +
      (readmeText ? 1 : 0) +
      documentationFiles.length;
    const highlights: string[] = [
      `Repository: ${repoData.full_name} (${repoData.default_branch}${repoData.language ? ` · ${repoData.language}` : ''})`,
      `Issues synced: ${pureIssues.filter((i) => i.state === 'open').length} open / ${pureIssues.length} total`,
      `Pull requests synced: ${pullRequests.length} · Recent commits: ${commits.length}${
        documentationFiles.length > 0 ? ` · Docs: ${documentationFiles.length + (readmeText ? 1 : 0)}` : ''
      }`,
    ];

    const safeFileName = `github_${owner}_${repo}_activity.json`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const existingExtBefore = (db.externalSources ?? []).find(
      (e) => e.projectId === projectId && e.provider === 'github' && e.externalId === `github:${repoData.full_name}`,
    );

    const { source, updatedExisting } = upsertProjectSourceFromIntegration({
      db,
      projectId,
      provider: 'github',
      externalId: `github:${repoData.full_name}`,
      sourceType: 'github_sync',
      externalUrl: repoData.html_url,
      title: `GitHub Sync · ${repoData.full_name}`,
      kind: 'github',
      fileName: safeFileName,
      addedBy: `GitHub Integration (${db.integrations?.github?.accountLabel || 'OAuth'})`,
      authorOrAssignee: repoData.owner?.login || owner,
      recordCount: Math.max(1, recordsFetched),
      content: JSON.stringify(structuredPayload, null, 2),
      metadataSummary: `${pureIssues.length} issues, ${pullRequests.length} PRs, ${commits.length} commits`,
      highlights,
      createdAt: repoData.created_at,
      updatedAt: repoData.updated_at,
    });

    const completedAt = new Date().toISOString();
    db.integrations = db.integrations ?? {};
    const account: IntegrationAccount = {
      ...(db.integrations.github ?? { provider: 'github', status: 'connected' }),
      provider: 'github',
      status: 'connected',
      selectedTargetId: repoData.full_name,
      selectedTargetLabel: repoData.full_name,
      lastSyncAt: completedAt,
      lastSyncCount: recordsFetched,
      lastError: undefined,
      rateLimitRemaining: rateInfo.remaining,
      rateLimitLimit: rateInfo.limit,
    };
    db.integrations.github = account;

    const configuration = upsertIntegrationConfigurationInDb(db, {
      projectId,
      provider: 'github',
      selectedTargetId: repoData.full_name,
      selectedTargetLabel: repoData.full_name,
      includeCommits,
      includeIssues,
      includePullRequests,
      includeDocs,
    });

    const syncRun: IntegrationSyncRun = {
      id: `sync-github-${Date.now()}`,
      projectId,
      provider: 'github',
      targetLabel: repoData.full_name,
      startedAt,
      completedAt,
      status: 'completed',
      recordsFetched,
      recordsImported: recordsFetched,
      duplicatesSkipped: updatedExisting && existingExtBefore ? recordsFetched : 0,
      sourceId: source.id,
      warning: rateInfo.warning,
    };
    recordSyncRun(db, syncRun);
    project.updatedAt = completedAt;
    writeDatabase(db, dbFilePath);

    return { source, syncRun, account, configuration, warning: rateInfo.warning };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : 'GitHub sync failed.';
    const freshDb = readDatabase(dbFilePath);
    freshDb.integrations = freshDb.integrations ?? {};
    if (freshDb.integrations.github) {
      freshDb.integrations.github.lastError = message;
    }
    recordSyncRun(freshDb, {
      id: `sync-github-err-${Date.now()}`,
      projectId,
      provider: 'github',
      targetLabel: cleanRepo,
      startedAt,
      completedAt,
      status: 'failed',
      recordsFetched: 0,
      recordsImported: 0,
      duplicatesSkipped: 0,
      error: message,
    });
    writeDatabase(freshDb, dbFilePath);
    if (err instanceof IntegrationError) throw err;
    throw new IntegrationError(message, 502);
  }
}

// ============================================================================
// 2. GOOGLE DRIVE ADAPTER (Bearer Token from Firebase Workspace OAuth)
// ============================================================================

export async function connectGoogleDriveWithBearer(params: {
  accessToken: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { accessToken, fetchFn = fetch, dbFilePath } = params;
  const token = accessToken.trim();
  if (!token) {
    throw new IntegrationError('Google Drive OAuth access token is required.', 401);
  }

  const res = await fetchFn(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    let msg = `Google Drive verification failed (HTTP ${res.status}).`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson.error?.message) msg = `Google Drive error: ${errJson.error.message}`;
    } catch {
      // ignore
    }
    throw new IntegrationError(msg, res.status === 401 || res.status === 403 ? 401 : res.status);
  }

  const data = (await res.json()) as {
    user?: { displayName?: string; emailAddress?: string };
  };

  const now = new Date().toISOString();
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  const previous = db.integrations.drive;

  const account: IntegrationAccount = {
    provider: 'drive',
    status: 'connected',
    authMode: 'firebase_oauth',
    accountLabel: data.user?.emailAddress || data.user?.displayName || 'Google Workspace User',
    workspaceName: data.user?.displayName || 'Google Drive',
    connectedAt: now,
    lastSyncAt: previous?.lastSyncAt,
    lastSyncCount: previous?.lastSyncCount,
    selectedTargetId: previous?.selectedTargetId,
    selectedTargetLabel: previous?.selectedTargetLabel,
  };
  db.integrations.drive = account;
  writeDatabase(db, dbFilePath);
  return account;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size?: string;
  ownerName?: string;
}

export async function listGoogleDriveFiles(params: {
  accessToken: string;
  query?: string;
  fetchFn?: FetchLike;
}): Promise<DriveFileItem[]> {
  const { accessToken, query, fetchFn = fetch } = params;
  const token = accessToken.trim();
  if (!token) {
    throw new IntegrationError('Google Drive access token is missing. Please sign in with Google first.', 401);
  }

  const qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (query && query.trim()) {
    const escaped = query.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink,size,owners)');
  url.searchParams.set('pageSize', '40');
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  url.searchParams.set('q', qParts.join(' and '));

  const res = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let msg = `Failed to list Google Drive files (HTTP ${res.status}).`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson.error?.message) msg = `Google Drive error: ${errJson.error.message}`;
    } catch {
      // ignore
    }
    throw new IntegrationError(msg, res.status === 401 ? 401 : res.status);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
      size?: string;
      owners?: Array<{ displayName?: string }>;
    }>;
  };

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime || '',
    webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    size: f.size,
    ownerName: f.owners?.[0]?.displayName,
  }));
}

export async function syncGoogleDriveFiles(params: {
  projectId: string;
  accessToken: string;
  fileIds: string[];
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{
  sources: ActivitySource[];
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  warnings: string[];
}> {
  const { projectId, accessToken, fileIds, fetchFn = fetch, dbFilePath } = params;
  const startedAt = new Date().toISOString();
  const token = accessToken.trim();
  if (!token) {
    throw new IntegrationError('Google Drive access token is required.', 401);
  }
  if (!fileIds || fileIds.length === 0) {
    throw new IntegrationError('Select at least one Google Drive file to import.', 400);
  }

  const db = readDatabase(dbFilePath);
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new IntegrationError('Target project not found.', 404);
  }

  const importedSources: ActivitySource[] = [];
  const warnings: string[] = [];
  let duplicatesSkipped = 0;

  for (const fileId of fileIds) {
    const metaRes = await fetchFn(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,webViewLink,size&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      warnings.push(`Skipped file ${fileId} (metadata HTTP ${metaRes.status}).`);
      continue;
    }

    const meta = (await metaRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
    };
    const webLink = meta.webViewLink || `https://drive.google.com/file/d/${meta.id}/view`;

    let kind: SourceKind = 'docs';
    let content = '';
    let base64Data: string | undefined;
    let mimeTypeOut: string | undefined;

    if (meta.mimeType === 'application/vnd.google-apps.document') {
      const expRes = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}/export?mimeType=text%2Fplain`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!expRes.ok) {
        warnings.push(`Could not export Google Doc "${meta.name}" (HTTP ${expRes.status}).`);
        continue;
      }
      const rawText = sanitizeExternalText(await expRes.text());
      content = `Google Drive Document: ${meta.name}\nSource URL: ${webLink}\nModified: ${meta.modifiedTime || 'Unknown'}\n\n${rawText}`;
      kind = 'docs';
    } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const expRes = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}/export?mimeType=text%2Fcsv`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!expRes.ok) {
        warnings.push(`Could not export Google Sheet "${meta.name}" (HTTP ${expRes.status}).`);
        continue;
      }
      content = sanitizeExternalText(await expRes.text());
      kind = 'csv';
    } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
      const expRes = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}/export?mimeType=text%2Fplain`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!expRes.ok) {
        warnings.push(`Could not export Google Slides "${meta.name}" (HTTP ${expRes.status}).`);
        continue;
      }
      const rawText = sanitizeExternalText(await expRes.text());
      content = `Google Slides Deck: ${meta.name}\nSource URL: ${webLink}\n\n${rawText}`;
      kind = 'docs';
    } else if (meta.mimeType === 'application/pdf' || meta.name.toLowerCase().endsWith('.pdf')) {
      const dlRes = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dlRes.ok) {
        warnings.push(`Could not download PDF "${meta.name}" (HTTP ${dlRes.status}).`);
        continue;
      }
      const buf = Buffer.from(await dlRes.arrayBuffer());
      if (buf.byteLength > 8 * 1024 * 1024) {
        warnings.push(`PDF "${meta.name}" exceeds 8MB sync limit and was skipped.`);
        continue;
      }
      base64Data = buf.toString('base64');
      mimeTypeOut = 'application/pdf';
      kind = 'pdf';
      content = `Google Drive PDF Document: ${meta.name}\nSource URL: ${webLink}\nSize: ${Math.round(buf.byteLength / 1024)} KB`;
    } else {
      const dlRes = await fetchFn(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dlRes.ok) {
        warnings.push(`Could not download "${meta.name}" (HTTP ${dlRes.status}).`);
        continue;
      }
      const text = sanitizeExternalText(await dlRes.text());
      kind = meta.name.toLowerCase().endsWith('.csv') ? 'csv' : 'docs';
      content =
        kind === 'csv'
          ? text
          : `Google Drive File: ${meta.name}\nSource URL: ${webLink}\n\n${text}`;
    }

    const recordCount =
      kind === 'csv'
        ? Math.max(1, content.split(/\r?\n/).filter((l) => l.trim()).length - 1)
        : kind === 'pdf'
          ? 1
          : Math.max(1, content.split(/\n\s*\n/).filter((p) => p.trim()).length);

    const { source, updatedExisting } = upsertProjectSourceFromIntegration({
      db,
      projectId,
      provider: 'drive',
      externalId: `drive:${meta.id}`,
      externalUrl: webLink,
      title: `Google Drive · ${meta.name}`,
      kind,
      fileName: meta.name,
      addedBy: `Google Drive (${db.integrations?.drive?.accountLabel || 'OAuth'})`,
      recordCount,
      content,
      metadataSummary: `${meta.mimeType} · ${webLink}`,
      highlights: [`Google Drive URL: ${webLink}`],
      base64Data,
      mimeType: mimeTypeOut,
    });

    if (updatedExisting) duplicatesSkipped += 1;
    importedSources.push(source);
  }

  const completedAt = new Date().toISOString();
  if (importedSources.length === 0) {
    recordSyncRun(db, {
      id: `sync-drive-err-${Date.now()}`,
      projectId,
      provider: 'drive',
      targetLabel: `${fileIds.length} Drive file(s)`,
      startedAt,
      completedAt,
      status: 'failed',
      recordsFetched: 0,
      recordsImported: 0,
      duplicatesSkipped: 0,
      error: warnings.join(' ') || 'No supported Google Drive files could be imported.',
    });
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(
      warnings.join(' ') || 'No supported Google Drive files could be imported.',
      400,
    );
  }

  db.integrations = db.integrations ?? {};
  const account: IntegrationAccount = {
    ...(db.integrations.drive ?? { provider: 'drive', status: 'connected', authMode: 'firebase_oauth' }),
    provider: 'drive',
    status: 'connected',
    selectedTargetLabel: importedSources.map((s) => s.fileName).slice(0, 3).join(', '),
    lastSyncAt: completedAt,
    lastSyncCount: importedSources.length,
    lastError: undefined,
  };
  db.integrations.drive = account;

  const syncRun: IntegrationSyncRun = {
    id: `sync-drive-${Date.now()}`,
    projectId,
    provider: 'drive',
    targetLabel: `${importedSources.length} file(s)`,
    startedAt,
    completedAt,
    status: 'completed',
    recordsFetched: importedSources.length,
    recordsImported: importedSources.length,
    duplicatesSkipped,
    sourceId: importedSources[0]?.id,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
  recordSyncRun(db, syncRun);
  project.updatedAt = completedAt;
  writeDatabase(db, dbFilePath);

  return { sources: importedSources, syncRun, account, warnings };
}

// ============================================================================
// 3. JIRA ADAPTER (OAuth 2.0 or Site URL + Email + Atlassian API Token)
// ============================================================================

function normalizeJiraSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IntegrationError('Jira Site URL must be a valid https:// URL (e.g. https://your-org.atlassian.net).', 400);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new IntegrationError('Jira Site URL must use https://.', 400);
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function buildJiraAuthHeader(secret: { accessToken: string; email?: string }): string {
  if (secret.email) {
    const basic = Buffer.from(`${secret.email}:${secret.accessToken}`).toString('base64');
    return `Basic ${basic}`;
  }
  return `Bearer ${secret.accessToken}`;
}

function extractAdfText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    const parts = n.content.map((c) => extractAdfText(c)).filter(Boolean);
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') {
      return `${parts.join('')}\n`;
    }
    return parts.join(' ');
  }
  return '';
}

export function buildJiraOAuthUrl(callbackBaseUrl: string): string {
  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError(
      'Jira OAuth is not configured on the server. Set JIRA_CLIENT_ID, JIRA_CLIENT_SECRET, and APP_URL.',
      400,
      'not_configured',
    );
  }
  const callbackUrl = `${callbackBaseUrl.replace(/\/+$/, '')}/api/integrations/jira/callback`;
  const state = createOAuthState('jira', callbackUrl);
  const url = new URL('https://auth.atlassian.com/authorize');
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'read:jira-work read:jira-user offline_access');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function completeJiraOAuthCallback(params: {
  code: string;
  state: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { code, state, fetchFn = fetch, dbFilePath } = params;
  const pending = consumeOAuthState(state, 'jira');
  if (!pending) {
    throw new IntegrationError('Invalid or expired Jira OAuth state.', 400);
  }
  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError('Jira OAuth client credentials are not configured.', 500);
  }

  const tokenRes = await fetchFn('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: pending.callbackUrl,
    }),
  });
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new IntegrationError(
      tokenData.error_description || 'Failed to exchange Jira OAuth code.',
      401,
    );
  }

  const sitesRes = await fetchFn('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
  });
  const sites = (await sitesRes.json()) as Array<{ id: string; url: string; name: string }>;
  if (!sitesRes.ok || !Array.isArray(sites) || sites.length === 0) {
    throw new IntegrationError('No accessible Jira Cloud sites found for this Atlassian account.', 403);
  }
  const primarySite = sites[0];
  const apiBaseUrl = `https://api.atlassian.com/ex/jira/${primarySite.id}`;

  const meRes = await fetchFn(`${apiBaseUrl}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
  });
  if (!meRes.ok) {
    throw new IntegrationError(`Jira profile check failed (HTTP ${meRes.status}).`, 401);
  }
  const me = (await meRes.json()) as { displayName?: string; emailAddress?: string };

  const now = new Date().toISOString();
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  db.integrationSecrets = db.integrationSecrets ?? {};

  db.integrationSecrets.jira = {
    provider: 'jira',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    siteUrl: apiBaseUrl,
    updatedAt: now,
  };

  const account: IntegrationAccount = {
    provider: 'jira',
    status: 'connected',
    authMode: 'oauth',
    accountLabel: me.emailAddress || me.displayName || 'Atlassian User',
    workspaceName: primarySite.name,
    siteUrl: primarySite.url,
    connectedAt: now,
  };
  db.integrations.jira = account;
  writeDatabase(db, dbFilePath);
  return account;
}

export async function connectJiraWithToken(params: {
  siteUrl: string;
  email: string;
  apiToken: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { siteUrl, email, apiToken, fetchFn = fetch, dbFilePath } = params;
  const normalizedSite = normalizeJiraSiteUrl(siteUrl);
  const cleanEmail = email.trim();
  const cleanToken = apiToken.trim();

  if (!cleanEmail || !cleanToken) {
    throw new IntegrationError('Jira Site URL, account email, and API Token are all required.', 400);
  }

  const authHeader = buildJiraAuthHeader({ accessToken: cleanToken, email: cleanEmail });
  const res = await fetchFn(`${normalizedSite}/rest/api/3/myself`, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const detail = `Jira authentication failed (HTTP ${res.status}). Check your Site URL, email, and API Token.`;
    const db = readDatabase(dbFilePath);
    db.integrations = db.integrations ?? {};
    db.integrationSecrets = db.integrationSecrets ?? {};
    delete db.integrationSecrets.jira;
    db.integrations.jira = {
      provider: 'jira',
      status: 'error',
      siteUrl: normalizedSite,
      lastError: detail,
    };
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(detail, res.status === 401 || res.status === 403 ? 401 : res.status);
  }

  const me = (await res.json()) as {
    displayName?: string;
    emailAddress?: string;
  };

  const now = new Date().toISOString();
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  db.integrationSecrets = db.integrationSecrets ?? {};

  db.integrationSecrets.jira = {
    provider: 'jira',
    accessToken: cleanToken,
    email: cleanEmail,
    siteUrl: normalizedSite,
    updatedAt: now,
  };

  const prev = db.integrations.jira;
  const account: IntegrationAccount = {
    provider: 'jira',
    status: 'connected',
    authMode: 'token',
    accountLabel: me.emailAddress || cleanEmail,
    workspaceName: me.displayName || new URL(normalizedSite).hostname,
    siteUrl: normalizedSite,
    selectedTargetId: prev?.selectedTargetId,
    selectedTargetLabel: prev?.selectedTargetLabel,
    connectedAt: now,
    lastSyncAt: prev?.lastSyncAt,
    lastSyncCount: prev?.lastSyncCount,
  };
  db.integrations.jira = account;
  writeDatabase(db, dbFilePath);
  return account;
}

export interface JiraProjectItem {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
}

export async function listJiraProjects(params: {
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<JiraProjectItem[]> {
  const { fetchFn = fetch, dbFilePath } = params;
  const db = readDatabase(dbFilePath);
  const secret = db.integrationSecrets?.jira;
  if (!secret?.accessToken || !secret.siteUrl) {
    throw new IntegrationError('Jira is not connected. Connect Jira first.', 401);
  }

  const res = await fetchFn(`${secret.siteUrl}/rest/api/3/project/search?maxResults=50`, {
    headers: {
      Authorization: buildJiraAuthHeader(secret),
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new IntegrationError(`Failed to load Jira projects (HTTP ${res.status}).`, res.status);
  }

  const data = (await res.json()) as {
    values?: Array<{ id: string; key: string; name: string; projectTypeKey?: string }>;
  };

  return (data.values ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey,
  }));
}

export async function syncJiraProject(params: {
  projectId: string;
  jiraProjectKey: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{
  source: ActivitySource;
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
}> {
  const { projectId, jiraProjectKey, fetchFn = fetch, dbFilePath } = params;
  const startedAt = new Date().toISOString();
  const cleanKey = jiraProjectKey.trim().toUpperCase();
  if (!cleanKey) {
    throw new IntegrationError('Jira project key is required.', 400);
  }

  const db = readDatabase(dbFilePath);
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new IntegrationError('Target project not found.', 404);
  }

  const secret = db.integrationSecrets?.jira;
  if (!secret?.accessToken || !secret.siteUrl) {
    throw new IntegrationError('Jira is not connected. Connect Jira before syncing.', 401);
  }

  const jql = `project = "${cleanKey}" ORDER BY updated DESC`;
  const searchUrl = `${secret.siteUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,priority,assignee,description,updated,issuetype`;
  let res = await fetchFn(searchUrl, {
    headers: {
      Authorization: buildJiraAuthHeader(secret),
      Accept: 'application/json',
    },
  });

  if (res.status === 404 || res.status === 410) {
    const legacyUrl = `${secret.siteUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,priority,assignee,description,updated,issuetype`;
    res = await fetchFn(legacyUrl, {
      headers: {
        Authorization: buildJiraAuthHeader(secret),
        Accept: 'application/json',
      },
    });
  }

  if (!res.ok) {
    const message = `Failed to sync Jira project ${cleanKey} (HTTP ${res.status}).`;
    recordSyncRun(db, {
      id: `sync-jira-err-${Date.now()}`,
      projectId,
      provider: 'jira',
      targetLabel: cleanKey,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'failed',
      recordsFetched: 0,
      recordsImported: 0,
      duplicatesSkipped: 0,
      error: message,
    });
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(message, res.status);
  }

  const data = (await res.json()) as {
    issues?: Array<{
      id: string;
      key: string;
      fields?: {
        summary?: string;
        status?: { name?: string };
        priority?: { name?: string };
        assignee?: { displayName?: string } | null;
        issuetype?: { name?: string };
        updated?: string;
        description?: unknown;
      };
    }>;
  };

  const issues = data.issues ?? [];
  const displaySite = db.integrations?.jira?.siteUrl || secret.siteUrl;
  const formattedLines: string[] = [
    `JIRA PROJECT SYNC — ${cleanKey}`,
    `Site: ${displaySite}`,
    `Synced At: ${new Date().toISOString()}`,
    `Issues Imported: ${issues.length}`,
    '',
  ];

  for (const issue of issues) {
    const f = issue.fields ?? {};
    const status = f.status?.name || 'Unknown';
    const priority = f.priority?.name || 'Medium';
    const assignee = f.assignee?.displayName || 'Unassigned';
    const issueType = f.issuetype?.name || 'Issue';
    const desc =
      typeof f.description === 'string'
        ? f.description
        : extractAdfText(f.description).trim();
    const issueUrl = `${displaySite.replace(/\/+$/, '')}/browse/${issue.key}`;

    formattedLines.push(
      `### [${issue.key}] (${issueType}) ${sanitizeExternalText(f.summary || 'Untitled Issue', 300)}`,
      `- Status: ${status} | Priority: ${priority} | Assignee: ${assignee} | Updated: ${f.updated || 'N/A'}`,
      `- Reference: ${issueUrl}`,
      desc ? `- Description: ${sanitizeExternalText(desc, 1200)}` : `- Description: (none)`,
      '',
    );
  }

  const fileName = `jira_${cleanKey.toLowerCase()}_issues.md`;
  const { source, updatedExisting } = upsertProjectSourceFromIntegration({
    db,
    projectId,
    provider: 'jira',
    externalId: `jira:${displaySite}:${cleanKey}`,
    externalUrl: `${displaySite.replace(/\/+$/, '')}/jira/software/projects/${cleanKey}/boards`,
    title: `Jira Issues · ${cleanKey}`,
    kind: 'docs',
    fileName,
    addedBy: `Jira Integration (${db.integrations?.jira?.accountLabel || 'API'})`,
    recordCount: Math.max(1, issues.length),
    content: formattedLines.join('\n'),
    metadataSummary: `${issues.length} Jira issues from ${cleanKey}`,
    highlights: [
      `Jira Project ${cleanKey}: ${issues.length} issues synced`,
      ...issues
        .slice(0, 2)
        .map((i) => `${i.key}: ${i.fields?.summary || ''} (${i.fields?.status?.name || ''})`),
    ],
  });

  const completedAt = new Date().toISOString();
  db.integrations = db.integrations ?? {};
  const account: IntegrationAccount = {
    ...(db.integrations.jira ?? { provider: 'jira', status: 'connected' }),
    provider: 'jira',
    status: 'connected',
    selectedTargetId: cleanKey,
    selectedTargetLabel: cleanKey,
    lastSyncAt: completedAt,
    lastSyncCount: issues.length,
    lastError: undefined,
  };
  db.integrations.jira = account;

  const syncRun: IntegrationSyncRun = {
    id: `sync-jira-${Date.now()}`,
    projectId,
    provider: 'jira',
    targetLabel: cleanKey,
    startedAt,
    completedAt,
    status: 'completed',
    recordsFetched: issues.length,
    recordsImported: issues.length,
    duplicatesSkipped: updatedExisting ? issues.length : 0,
    sourceId: source.id,
  };
  recordSyncRun(db, syncRun);
  project.updatedAt = completedAt;
  writeDatabase(db, dbFilePath);

  return { source, syncRun, account };
}

// ============================================================================
// 4. SLACK ADAPTER (OAuth v2 or Bot/User Token)
// ============================================================================

export function buildSlackOAuthUrl(callbackBaseUrl: string): string {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError(
      'Slack OAuth is not configured on the server. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and APP_URL.',
      400,
      'not_configured',
    );
  }
  const callbackUrl = `${callbackBaseUrl.replace(/\/+$/, '')}/api/integrations/slack/callback`;
  const state = createOAuthState('slack', callbackUrl);
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'channels:read,channels:history,groups:read,groups:history,users:read');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function completeSlackOAuthCallback(params: {
  code: string;
  state: string;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { code, state, fetchFn = fetch, dbFilePath } = params;
  const pending = consumeOAuthState(state, 'slack');
  if (!pending) {
    throw new IntegrationError('Invalid or expired Slack OAuth state.', 400);
  }
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new IntegrationError('Slack OAuth credentials are not configured.', 500);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: pending.callbackUrl,
  });

  const tokenRes = await fetchFn('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    access_token?: string;
    error?: string;
  };
  if (!tokenData.ok || !tokenData.access_token) {
    throw new IntegrationError(
      `Slack OAuth failed: ${tokenData.error || 'token exchange failed'}`,
      401,
    );
  }

  return connectSlackWithToken({
    token: tokenData.access_token,
    authMode: 'oauth',
    fetchFn,
    dbFilePath,
  });
}

export async function connectSlackWithToken(params: {
  token: string;
  authMode?: 'oauth' | 'token';
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<IntegrationAccount> {
  const { token, authMode = 'token', fetchFn = fetch, dbFilePath } = params;
  const trimmed = token.trim();
  if (!trimmed) {
    throw new IntegrationError('Slack Bot or User token is required.', 400);
  }

  const res = await fetchFn('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${trimmed}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = (await res.json()) as {
    ok: boolean;
    team?: string;
    user?: string;
    team_id?: string;
    error?: string;
  };

  if (!res.ok || !data.ok) {
    const detail = `Slack authentication failed: ${data.error || `HTTP ${res.status}`}`;
    const db = readDatabase(dbFilePath);
    db.integrations = db.integrations ?? {};
    db.integrationSecrets = db.integrationSecrets ?? {};
    delete db.integrationSecrets.slack;
    db.integrations.slack = {
      provider: 'slack',
      status: 'error',
      lastError: detail,
    };
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(detail, 401);
  }

  const now = new Date().toISOString();
  const db = readDatabase(dbFilePath);
  db.integrations = db.integrations ?? {};
  db.integrationSecrets = db.integrationSecrets ?? {};

  db.integrationSecrets.slack = {
    provider: 'slack',
    accessToken: trimmed,
    updatedAt: now,
  };

  const prev = db.integrations.slack;
  const account: IntegrationAccount = {
    provider: 'slack',
    status: 'connected',
    authMode,
    accountLabel: data.user ? `@${data.user}` : 'Slack App',
    workspaceName: data.team || 'Slack Workspace',
    selectedTargetId: prev?.selectedTargetId,
    selectedTargetLabel: prev?.selectedTargetLabel,
    connectedAt: now,
    lastSyncAt: prev?.lastSyncAt,
    lastSyncCount: prev?.lastSyncCount,
  };
  db.integrations.slack = account;
  writeDatabase(db, dbFilePath);
  return account;
}

export interface SlackChannelItem {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  topic?: string;
}

export async function listSlackChannels(params: {
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{ channels: SlackChannelItem[]; warning?: string }> {
  const { fetchFn = fetch, dbFilePath } = params;
  const db = readDatabase(dbFilePath);
  const token = db.integrationSecrets?.slack?.accessToken;
  if (!token) {
    throw new IntegrationError('Slack is not connected. Connect Slack first.', 401);
  }

  let warning: string | undefined;
  let res = await fetchFn(
    'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  let data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channels?: Array<{
      id: string;
      name: string;
      is_private?: boolean;
      is_member?: boolean;
      topic?: { value?: string };
    }>;
  };

  if (!data.ok && data.error === 'missing_scope') {
    res = await fetchFn(
      'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=100',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    data = (await res.json()) as typeof data;
    if (data.ok) {
      warning = 'Private channels omitted (token lacks groups:read scope).';
    }
  }

  if (!res.ok || !data.ok) {
    throw new IntegrationError(
      `Failed to load Slack channels: ${data.error || `HTTP ${res.status}`}`,
      res.status === 429 || data.error === 'ratelimited' ? 429 : 400,
    );
  }

  return {
    channels: (data.channels ?? []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      isPrivate: Boolean(ch.is_private),
      isMember: Boolean(ch.is_member),
      topic: ch.topic?.value,
    })),
    warning,
  };
}

export async function syncSlackChannels(params: {
  projectId: string;
  channels: Array<{ id: string; name?: string }>;
  fetchFn?: FetchLike;
  dbFilePath?: string;
}): Promise<{
  sources: ActivitySource[];
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  warnings: string[];
}> {
  const { projectId, channels, fetchFn = fetch, dbFilePath } = params;
  const startedAt = new Date().toISOString();
  if (!channels || channels.length === 0) {
    throw new IntegrationError('Select at least one Slack channel to sync.', 400);
  }

  const db = readDatabase(dbFilePath);
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) {
    throw new IntegrationError('Target project not found.', 404);
  }

  const token = db.integrationSecrets?.slack?.accessToken;
  if (!token) {
    throw new IntegrationError('Slack is not connected. Connect Slack before syncing.', 401);
  }

  const importedSources: ActivitySource[] = [];
  const warnings: string[] = [];
  let totalMessages = 0;
  let duplicatesSkipped = 0;

  for (const ch of channels) {
    const histRes = await fetchFn(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(ch.id)}&limit=40`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const histData = (await histRes.json()) as {
      ok: boolean;
      error?: string;
      messages?: Array<{
        ts: string;
        user?: string;
        bot_id?: string;
        text?: string;
        thread_ts?: string;
      }>;
    };

    if (!histRes.ok || !histData.ok) {
      const errCode = histData.error || `HTTP ${histRes.status}`;
      if (errCode === 'not_in_channel') {
        warnings.push(`#${ch.name || ch.id}: Invite the Slack app/bot to this channel to import history.`);
      } else {
        warnings.push(`#${ch.name || ch.id}: Slack API error (${errCode}).`);
      }
      continue;
    }

    const channelLabel = (ch.name || ch.id).replace(/^#/, '');
    const msgs = (histData.messages ?? [])
      .filter((m) => m.text && m.text.trim())
      .reverse();

    const lines: string[] = [
      `SLACK CHANNEL TRANSCRIPT — #${channelLabel} (${ch.id})`,
      `Workspace: ${db.integrations?.slack?.workspaceName || 'Slack'}`,
      `Synced At: ${new Date().toISOString()}`,
      `Messages: ${msgs.length}`,
      '',
    ];

    for (const m of msgs) {
      const tsNum = Number(m.ts.split('.')[0]);
      const isoTime =
        !Number.isNaN(tsNum) && tsNum > 0
          ? new Date(tsNum * 1000).toISOString()
          : m.ts;
      const author = m.user || (m.bot_id ? `bot:${m.bot_id}` : 'system');
      lines.push(`[${isoTime}] ${author} (ts=${m.ts}): ${sanitizeExternalText(m.text || '', 2000)}`);
    }

    const safeFileName = `slack_${channelLabel.replace(/[^a-zA-Z0-9._-]/g, '_')}.txt`;
    const { source, updatedExisting } = upsertProjectSourceFromIntegration({
      db,
      projectId,
      provider: 'slack',
      externalId: `slack:${ch.id}`,
      title: `Slack · #${channelLabel}`,
      kind: 'docs',
      fileName: safeFileName,
      addedBy: `Slack Integration (${db.integrations?.slack?.workspaceName || 'Workspace'})`,
      recordCount: Math.max(1, msgs.length),
      content: lines.join('\n'),
      metadataSummary: `#${channelLabel} · ${msgs.length} messages`,
      highlights: [`#${channelLabel}: ${msgs.length} recent channel messages`],
    });

    totalMessages += msgs.length;
    if (updatedExisting) duplicatesSkipped += msgs.length;
    importedSources.push(source);
  }

  const completedAt = new Date().toISOString();
  if (importedSources.length === 0) {
    recordSyncRun(db, {
      id: `sync-slack-err-${Date.now()}`,
      projectId,
      provider: 'slack',
      targetLabel: channels.map((c) => `#${c.name || c.id}`).join(', '),
      startedAt,
      completedAt,
      status: 'failed',
      recordsFetched: 0,
      recordsImported: 0,
      duplicatesSkipped: 0,
      error: warnings.join(' ') || 'No Slack messages could be imported.',
    });
    writeDatabase(db, dbFilePath);
    throw new IntegrationError(
      warnings.join(' ') || 'No Slack messages could be imported.',
      400,
    );
  }

  db.integrations = db.integrations ?? {};
  const targetLabel = channels.map((c) => `#${c.name || c.id}`).join(', ');
  const account: IntegrationAccount = {
    ...(db.integrations.slack ?? { provider: 'slack', status: 'connected' }),
    provider: 'slack',
    status: 'connected',
    selectedTargetId: channels[0].id,
    selectedTargetLabel: targetLabel,
    lastSyncAt: completedAt,
    lastSyncCount: totalMessages,
    lastError: undefined,
  };
  db.integrations.slack = account;

  const syncRun: IntegrationSyncRun = {
    id: `sync-slack-${Date.now()}`,
    projectId,
    provider: 'slack',
    targetLabel,
    startedAt,
    completedAt,
    status: 'completed',
    recordsFetched: totalMessages,
    recordsImported: totalMessages,
    duplicatesSkipped,
    sourceId: importedSources[0]?.id,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
  recordSyncRun(db, syncRun);
  project.updatedAt = completedAt;
  writeDatabase(db, dbFilePath);

  return { sources: importedSources, syncRun, account, warnings };
}
