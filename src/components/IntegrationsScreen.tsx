import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  HardDrive,
  Hash,
  KanbanSquare,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
} from 'lucide-react';
import type {
  ExternalSourceRecord,
  IntegrationConfiguration,
  IntegrationProviderId,
  IntegrationProviderStatusDTO,
  IntegrationSyncRun,
  ProjectSummaryDTO,
  ScreenId,
} from '../types';
import {
  configureIntegrationApi,
  connectGoogleDriveApi,
  disconnectIntegrationApi,
  fetchGitHubReposApi,
  fetchGoogleDriveFilesApi,
  fetchIntegrations,
  fetchJiraProjectsApi,
  fetchOAuthPopupUrl,
  fetchSlackChannelsApi,
  syncGitHubRepoApi,
  syncGoogleDriveFilesApi,
  syncJiraProjectApi,
  syncSlackChannelsApi,
  type DriveFileSummary,
  type GitHubRepoSummary,
  type JiraProjectSummary,
  type SlackChannelSummary,
} from '../lib/api';
import {
  getInMemoryDriveToken,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from '../lib/googleDriveAuth';
import { formatDateTime } from './StatusPrimitives';

function ProviderStatusBadge({
  status,
}: {
  status: IntegrationProviderStatusDTO['account']['status'];
}) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        Connected
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded bg-red-50 text-red-800 border border-red-200 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 text-red-600" />
        Auth Error
      </span>
    );
  }
  if (status === 'not_configured') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
        Not Configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
      Disconnected
    </span>
  );
}

function NotConfiguredNotice({
  providerName,
  envVars,
  callbackUrl,
  setupInstructions,
}: {
  providerName: string;
  envVars: string[];
  callbackUrl?: string;
  setupInstructions?: string;
}) {
  return (
    <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-amber-900">
        <Settings2 className="w-3.5 h-3.5 text-amber-700 shrink-0" />
        <span>{providerName} OAuth Not Configured on Server</span>
      </div>
      <p className="text-amber-900/80 leading-relaxed">
        {setupInstructions ||
          `Configure server-side OAuth credentials to enable ${providerName} authorization. Tokens are stored strictly on the backend and never entered in browser forms.`}
      </p>
      <div className="space-y-1 pt-0.5">
        <p className="text-[11px] font-medium text-amber-900">
          Required environment variables:{' '}
          <span className="font-mono">{envVars.join(', ')}</span>
        </p>
        {callbackUrl && (
          <p className="text-[11px] text-amber-800 break-all">
            Callback URL: <code className="font-mono bg-white/80 px-1 py-0.5 rounded">{callbackUrl}</code>
          </p>
        )}
      </div>
    </div>
  );
}

export function IntegrationsScreen({
  projects,
  selectedProjectId,
  onSelectProject,
  onSourcesSynced,
  onInspectSource,
  onNavigate,
}: {
  projects: ProjectSummaryDTO[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  onSourcesSynced: () => Promise<void>;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const [providers, setProviders] = useState<IntegrationProviderStatusDTO[]>([]);
  const [configurations, setConfigurations] = useState<IntegrationConfiguration[]>([]);
  const [syncRuns, setSyncRuns] = useState<IntegrationSyncRun[]>([]);
  const [externalSources, setExternalSources] = useState<ExternalSourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // GitHub state
  const [ghRepos, setGhRepos] = useState<GitHubRepoSummary[]>([]);
  const [ghSelectedRepo, setGhSelectedRepo] = useState('');
  const [ghCustomRepo, setGhCustomRepo] = useState('');
  const [ghIncludeCommits, setGhIncludeCommits] = useState(true);
  const [ghIncludeIssues, setGhIncludeIssues] = useState(true);
  const [ghIncludePullRequests, setGhIncludePullRequests] = useState(true);
  const [ghIncludeDocs, setGhIncludeDocs] = useState(true);
  const [ghBusy, setGhBusy] = useState<'repos' | 'save' | 'sync' | null>(null);
  const [ghWarning, setGhWarning] = useState<string | null>(null);

  // Google Drive state
  const [driveFiles, setDriveFiles] = useState<DriveFileSummary[]>([]);
  const [driveSelectedIds, setDriveSelectedIds] = useState<string[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [driveBusy, setDriveBusy] = useState<'connect' | 'files' | 'sync' | null>(null);
  const [driveHasMemoryToken, setDriveHasMemoryToken] = useState<boolean>(
    Boolean(getInMemoryDriveToken()),
  );

  // Jira state
  const [jiraProjects, setJiraProjects] = useState<JiraProjectSummary[]>([]);
  const [jiraSelectedKey, setJiraSelectedKey] = useState('');
  const [jiraBusy, setJiraBusy] = useState<'projects' | 'sync' | null>(null);

  // Slack state
  const [slackChannels, setSlackChannels] = useState<SlackChannelSummary[]>([]);
  const [slackSelectedIds, setSlackSelectedIds] = useState<string[]>([]);
  const [slackBusy, setSlackBusy] = useState<'channels' | 'sync' | null>(null);
  const [slackWarning, setSlackWarning] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchIntegrations(selectedProjectId);
      setProviders(res.providers);
      setConfigurations(res.configurations ?? []);
      setSyncRuns(res.syncRuns);
      setExternalSources(res.externalSources);

      const ghConfig = (res.configurations ?? []).find(
        (c) => c.projectId === selectedProjectId && c.provider === 'github',
      );
      if (ghConfig) {
        setGhSelectedRepo(ghConfig.selectedTargetId);
        setGhIncludeCommits(ghConfig.includeCommits !== false);
        setGhIncludeIssues(ghConfig.includeIssues !== false);
        setGhIncludePullRequests(ghConfig.includePullRequests !== false);
        setGhIncludeDocs(ghConfig.includeDocs !== false);
      } else {
        setGhIncludeCommits(true);
        setGhIncludeIssues(true);
        setGhIncludePullRequests(true);
        setGhIncludeDocs(true);
      }

      const jiraConfig = (res.configurations ?? []).find(
        (c) => c.projectId === selectedProjectId && c.provider === 'jira',
      );
      if (jiraConfig) {
        setJiraSelectedKey(jiraConfig.selectedTargetId);
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to load integrations.');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  // Listen for OAuth popup completion messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as
        | { type?: string; provider?: IntegrationProviderId; error?: string }
        | undefined;
      if (!payload?.type) return;
      if (payload.type === 'OAUTH_AUTH_SUCCESS') {
        setBannerError(null);
        setBannerSuccess(`${payload.provider?.toUpperCase()} connected via OAuth.`);
        void loadIntegrations();
      } else if (payload.type === 'OAUTH_AUTH_ERROR') {
        setBannerError(payload.error || 'OAuth authorization failed.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadIntegrations]);

  const getProvider = (id: IntegrationProviderId) =>
    providers.find((p) => p.provider === id);

  const getProjectConfig = (id: IntegrationProviderId) =>
    configurations.find((c) => c.projectId === selectedProjectId && c.provider === id);

  const handleOAuthPopup = async (provider: 'github' | 'jira' | 'slack') => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const url = await fetchOAuthPopupUrl(provider);
      const popup = window.open(
        url,
        `handoversync_${provider}_oauth`,
        'width=620,height=720,noopener=false',
      );
      if (!popup) {
        setBannerError(
          `Popup was blocked by your browser. Please allow popups for this site to authorize ${provider}.`,
        );
      }
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'OAuth is not configured.');
    }
  };

  const handleDisconnect = async (provider: IntegrationProviderId) => {
    setBannerError(null);
    setBannerSuccess(null);
    if (provider === 'drive') {
      await signOutGoogleDrive();
      setDriveHasMemoryToken(false);
      setDriveFiles([]);
      setDriveSelectedIds([]);
    }
    if (provider === 'github') {
      setGhRepos([]);
      setGhSelectedRepo('');
      setGhCustomRepo('');
    }
    if (provider === 'jira') {
      setJiraProjects([]);
      setJiraSelectedKey('');
    }
    if (provider === 'slack') {
      setSlackChannels([]);
      setSlackSelectedIds([]);
    }
    await disconnectIntegrationApi(provider);
    await loadIntegrations();
  };

  // --- GitHub Handlers ---
  const handleLoadGitHubRepos = async () => {
    setBannerError(null);
    setGhWarning(null);
    setGhBusy('repos');
    try {
      const res = await fetchGitHubReposApi();
      setGhRepos(res.repos);
      if (res.warning) setGhWarning(res.warning);
      if (res.repos.length > 0 && !ghSelectedRepo) {
        setGhSelectedRepo(res.repos[0].fullName);
      }
      await loadIntegrations();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to list GitHub repositories.');
    } finally {
      setGhBusy(null);
    }
  };

  const handleSaveGitHubConfig = async () => {
    const targetRepo = (ghCustomRepo.trim() || ghSelectedRepo).trim();
    if (!targetRepo) {
      setBannerError('Select or enter a GitHub repository (owner/repo) before saving configuration.');
      return;
    }
    setBannerError(null);
    setBannerSuccess(null);
    setGhBusy('save');
    try {
      await configureIntegrationApi('github', {
        projectId: selectedProjectId,
        selectedTargetId: targetRepo,
        selectedTargetLabel: targetRepo,
        includeCommits: ghIncludeCommits,
        includeIssues: ghIncludeIssues,
        includePullRequests: ghIncludePullRequests,
        includeDocs: ghIncludeDocs,
      });
      setBannerSuccess(`Saved GitHub configuration (${targetRepo}) for ${currentProject?.name}.`);
      await loadIntegrations();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to save GitHub configuration.');
    } finally {
      setGhBusy(null);
    }
  };

  const handleSyncGitHub = async () => {
    const savedTarget = getProjectConfig('github')?.selectedTargetId;
    const repoToSync = (ghCustomRepo.trim() || ghSelectedRepo || savedTarget || '').trim();
    if (!repoToSync) {
      setBannerError('Select or enter a GitHub repository (owner/repo) to sync.');
      return;
    }
    setBannerError(null);
    setBannerSuccess(null);
    setGhBusy('sync');
    try {
      await configureIntegrationApi('github', {
        projectId: selectedProjectId,
        selectedTargetId: repoToSync,
        selectedTargetLabel: repoToSync,
        includeCommits: ghIncludeCommits,
        includeIssues: ghIncludeIssues,
        includePullRequests: ghIncludePullRequests,
        includeDocs: ghIncludeDocs,
      });
      const res = await syncGitHubRepoApi(selectedProjectId, repoToSync);
      if (res.warning) setGhWarning(res.warning);
      setBannerSuccess(
        `Synced ${repoToSync} (${res.syncRun.recordsImported} items imported into Project Activity).`,
      );
      await loadIntegrations();
      await onSourcesSynced();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'GitHub sync failed.');
      await loadIntegrations();
    } finally {
      setGhBusy(null);
    }
  };

  // --- Google Drive Handlers ---
  const handleConnectDrive = async () => {
    setBannerError(null);
    setBannerSuccess(null);
    setDriveBusy('connect');
    try {
      const authRes = await signInWithGoogleDrive();
      setDriveHasMemoryToken(true);
      const account = await connectGoogleDriveApi(authRes.accessToken);
      setBannerSuccess(`Connected to Google Drive (${account.accountLabel}).`);
      await loadIntegrations();
      setDriveBusy('files');
      const files = await fetchGoogleDriveFilesApi(authRes.accessToken, driveSearch);
      setDriveFiles(files);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Google Drive authentication failed.');
    } finally {
      setDriveBusy(null);
    }
  };

  const handleLoadDriveFiles = async () => {
    const token = getInMemoryDriveToken();
    if (!token) {
      setDriveHasMemoryToken(false);
      setBannerError(
        'Google Drive session token expired or cleared on reload. Click Re-authorize Google Drive.',
      );
      return;
    }
    setBannerError(null);
    setDriveBusy('files');
    try {
      const files = await fetchGoogleDriveFilesApi(token, driveSearch);
      setDriveFiles(files);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to list Google Drive files.');
    } finally {
      setDriveBusy(null);
    }
  };

  const handleSyncDrive = async () => {
    const token = getInMemoryDriveToken();
    if (!token) {
      setDriveHasMemoryToken(false);
      setBannerError('Please authorize Google Drive for this session first.');
      return;
    }
    if (driveSelectedIds.length === 0) {
      setBannerError('Select at least one Google Drive document or sheet to import.');
      return;
    }
    setBannerError(null);
    setBannerSuccess(null);
    setDriveBusy('sync');
    try {
      const res = await syncGoogleDriveFilesApi(selectedProjectId, token, driveSelectedIds);
      const warnSuffix = res.warnings.length > 0 ? ` (${res.warnings.join(' ')})` : '';
      setBannerSuccess(
        `Imported ${res.sources.length} Google Drive file(s) into Project Activity.${warnSuffix}`,
      );
      setDriveSelectedIds([]);
      await loadIntegrations();
      await onSourcesSynced();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Google Drive sync failed.');
      await loadIntegrations();
    } finally {
      setDriveBusy(null);
    }
  };

  // --- Jira Handlers ---
  const handleLoadJiraProjects = async () => {
    setBannerError(null);
    setJiraBusy('projects');
    try {
      const list = await fetchJiraProjectsApi();
      setJiraProjects(list);
      if (list.length > 0 && !jiraSelectedKey) setJiraSelectedKey(list[0].key);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to load Jira projects.');
    } finally {
      setJiraBusy(null);
    }
  };

  const handleSyncJira = async () => {
    if (!jiraSelectedKey.trim()) {
      setBannerError('Select a Jira project key to sync.');
      return;
    }
    setBannerError(null);
    setBannerSuccess(null);
    setJiraBusy('sync');
    try {
      await configureIntegrationApi('jira', {
        projectId: selectedProjectId,
        selectedTargetId: jiraSelectedKey.trim(),
        selectedTargetLabel: jiraSelectedKey.trim(),
      });
      const res = await syncJiraProjectApi(selectedProjectId, jiraSelectedKey.trim());
      setBannerSuccess(
        `Synced Jira project ${jiraSelectedKey} (${res.syncRun.recordsImported} issues imported).`,
      );
      await loadIntegrations();
      await onSourcesSynced();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Jira sync failed.');
      await loadIntegrations();
    } finally {
      setJiraBusy(null);
    }
  };

  // --- Slack Handlers ---
  const handleLoadSlackChannels = async () => {
    setBannerError(null);
    setSlackWarning(null);
    setSlackBusy('channels');
    try {
      const res = await fetchSlackChannelsApi();
      setSlackChannels(res.channels);
      if (res.warning) setSlackWarning(res.warning);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to load Slack channels.');
    } finally {
      setSlackBusy(null);
    }
  };

  const handleSyncSlack = async () => {
    const selected = slackChannels.filter((c) => slackSelectedIds.includes(c.id));
    if (selected.length === 0) {
      setBannerError('Select at least one Slack channel to import.');
      return;
    }
    setBannerError(null);
    setBannerSuccess(null);
    setSlackBusy('sync');
    try {
      await configureIntegrationApi('slack', {
        projectId: selectedProjectId,
        selectedTargetId: selected.map((c) => c.id).join(','),
        selectedTargetLabel: selected.map((c) => `#${c.name}`).join(', '),
      });
      const res = await syncSlackChannelsApi(
        selectedProjectId,
        selected.map((c) => ({ id: c.id, name: c.name })),
      );
      if (res.warnings.length > 0) setSlackWarning(res.warnings.join(' '));
      setBannerSuccess(
        `Imported ${res.syncRun.recordsImported} Slack message(s) into Project Activity.`,
      );
      await loadIntegrations();
      await onSourcesSynced();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Slack sync failed.');
      await loadIntegrations();
    } finally {
      setSlackBusy(null);
    }
  };

  const currentProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  const gh = getProvider('github');
  const drive = getProvider('drive');
  const jira = getProvider('jira');
  const slack = getProvider('slack');
  const ghConfig = getProjectConfig('github');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-700">
            {currentProject?.code} · External Connectors
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Real Project Integrations
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Authorize live GitHub, Google Drive, Jira, and Slack workspaces via OAuth to import verified engineering evidence into{' '}
            <span className="font-medium text-slate-800">{currentProject?.name}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            aria-label="Target project for integration sync"
            value={selectedProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-blue-700"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadIntegrations()}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Pipeline Connectivity Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 space-y-0.5">
            <p className="font-semibold text-slate-900">
              Unified Evidence Pipeline &amp; Backend OAuth Isolation
            </p>
            <p>
              Synced sources feed directly into Project Activity, Knowledge Gap Detector, Evidence-Cited Q&amp;A, and the Handover Pack. OAuth secrets remain strictly on the server (or in browser memory for Google Drive).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('gaps')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <AlertOctagon className="w-3.5 h-3.5 text-blue-700" />
            Analyze Gaps
          </button>
          <button
            type="button"
            onClick={() => onNavigate('qa')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5 text-blue-700" />
            Ask Q&amp;A
          </button>
          <button
            type="button"
            onClick={() => onNavigate('generate')}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate Pack
          </button>
        </div>
      </div>

      {bannerError && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-900">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="flex-1">{bannerError}</span>
        </div>
      )}

      {bannerSuccess && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-900">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span className="flex-1">{bannerSuccess}</span>
        </div>
      )}

      {/* 4 Provider Cards Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* 1. GITHUB CARD */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <GitBranch className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">GitHub Repositories</h2>
                  <p className="text-xs text-slate-600">
                    Import repo metadata, recent commits, issues, pull requests, README, and docs.
                  </p>
                </div>
              </div>
              {gh && <ProviderStatusBadge status={gh.account.status} />}
            </div>

            {gh?.account.status === 'connected' ? (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Account: <strong className="text-slate-900">{gh.account.accountLabel}</strong>
                    {gh.account.workspaceName ? ` (${gh.account.workspaceName})` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect('github')}
                    className="text-red-700 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-slate-500">
                  <span>
                    Last Sync:{' '}
                    {gh.account.lastSyncAt ? formatDateTime(gh.account.lastSyncAt) : 'Not synced yet'}
                  </span>
                  {typeof gh.account.lastSyncCount === 'number' && (
                    <span>· {gh.account.lastSyncCount} records</span>
                  )}
                  {typeof gh.account.rateLimitRemaining === 'number' && (
                    <span>
                      · API Quota: {gh.account.rateLimitRemaining}
                      {gh.account.rateLimitLimit ? `/${gh.account.rateLimitLimit}` : ''}
                    </span>
                  )}
                </div>
                {ghConfig && (
                  <p className="text-[11px] text-slate-600">
                    Configured target for {currentProject?.code}:{' '}
                    <code className="font-mono text-slate-900">{ghConfig.selectedTargetId}</code>
                  </p>
                )}
              </div>
            ) : gh?.oauthConfigured ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleOAuthPopup('github')}
                  className="w-full px-4 py-2.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  Authorize with GitHub OAuth
                </button>
                <p className="text-[11px] text-slate-500">{gh.setupInstructions}</p>
              </div>
            ) : (
              <NotConfiguredNotice
                providerName="GitHub"
                envVars={['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'APP_URL']}
                callbackUrl={gh?.callbackUrl}
                setupInstructions={gh?.setupInstructions}
              />
            )}

            {ghWarning && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {ghWarning}
              </p>
            )}
          </div>

          {gh?.account.status === 'connected' && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800">
                  Repository &amp; Scope Configuration
                </span>
                <button
                  type="button"
                  onClick={() => void handleLoadGitHubRepos()}
                  disabled={ghBusy === 'repos'}
                  className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  {ghBusy === 'repos' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {ghRepos.length > 0 ? 'Reload Repos' : 'Load My Repositories'}
                </button>
              </div>

              {ghRepos.length > 0 && (
                <select
                  aria-label="Select GitHub repository"
                  value={ghSelectedRepo}
                  onChange={(e) => setGhSelectedRepo(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                >
                  {ghRepos.map((r) => (
                    <option key={r.id} value={r.fullName}>
                      {r.fullName} ({r.private ? 'private' : 'public'} · {r.defaultBranch})
                    </option>
                  ))}
                </select>
              )}

              <input
                type="text"
                value={ghCustomRepo}
                onChange={(e) => setGhCustomRepo(e.target.value)}
                placeholder={
                  ghSelectedRepo
                    ? `Selected: ${ghSelectedRepo} (or override owner/repo)`
                    : 'Enter owner/repo (e.g. acme/checkout-service)'
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghIncludeCommits}
                    onChange={(e) => setGhIncludeCommits(e.target.checked)}
                  />
                  Commits
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghIncludeIssues}
                    onChange={(e) => setGhIncludeIssues(e.target.checked)}
                  />
                  Issues
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghIncludePullRequests}
                    onChange={(e) => setGhIncludePullRequests(e.target.checked)}
                  />
                  Pull Requests
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghIncludeDocs}
                    onChange={(e) => setGhIncludeDocs(e.target.checked)}
                  />
                  README &amp; Docs
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={ghBusy !== null || (!ghSelectedRepo && !ghCustomRepo.trim())}
                  onClick={() => void handleSaveGitHubConfig()}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
                >
                  {ghBusy === 'save' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save Config
                </button>
                <button
                  type="button"
                  disabled={
                    ghBusy !== null || (!ghSelectedRepo && !ghCustomRepo.trim() && !ghConfig?.selectedTargetId)
                  }
                  onClick={() => void handleSyncGitHub()}
                  className="flex-1 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  {ghBusy === 'sync' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderGit2 className="w-3.5 h-3.5" />
                  )}
                  Sync Now
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 2. GOOGLE DRIVE CARD */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Google Drive</h2>
                  <p className="text-xs text-slate-600">
                    Import Docs, Sheets, PDFs, and architecture specifications via Google OAuth.
                  </p>
                </div>
              </div>
              {drive && <ProviderStatusBadge status={drive.account.status} />}
            </div>

            {drive?.account.status === 'connected' ? (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Google Account: <strong className="text-slate-900">{drive.account.accountLabel}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect('drive')}
                    className="text-red-700 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-slate-500">
                  <span>
                    Last Sync:{' '}
                    {drive.account.lastSyncAt ? formatDateTime(drive.account.lastSyncAt) : 'Not synced yet'}
                  </span>
                  {typeof drive.account.lastSyncCount === 'number' && (
                    <span>· {drive.account.lastSyncCount} file(s)</span>
                  )}
                  <span>
                    · Session Token: {driveHasMemoryToken ? 'Active (in memory)' : 'Needs re-auth'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={driveBusy === 'connect'}
                  onClick={() => void handleConnectDrive()}
                  className="w-full px-4 py-2.5 text-xs font-medium text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg inline-flex items-center justify-center gap-2 shadow-xs"
                >
                  {driveBusy === 'connect' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                  ) : (
                    <HardDrive className="w-4 h-4 text-blue-700" />
                  )}
                  Sign in with Google (Drive Read-Only)
                </button>
                <p className="text-[11px] text-slate-500">{drive?.setupInstructions}</p>
              </div>
            )}
          </div>

          {drive?.account.status === 'connected' && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              {!driveHasMemoryToken ? (
                <button
                  type="button"
                  disabled={driveBusy === 'connect'}
                  onClick={() => void handleConnectDrive()}
                  className="w-full px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg"
                >
                  Re-authorize Google Drive Session to Browse Files
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={driveSearch}
                      onChange={(e) => setDriveSearch(e.target.value)}
                      placeholder="Filter Drive files by name..."
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                    />
                    <button
                      type="button"
                      disabled={driveBusy === 'files'}
                      onClick={() => void handleLoadDriveFiles()}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap inline-flex items-center gap-1"
                    >
                      {driveBusy === 'files' && <Loader2 className="w-3 h-3 animate-spin" />}
                      Browse Files
                    </button>
                  </div>

                  {driveFiles.length > 0 && (
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg">
                      {driveFiles.map((f) => {
                        const checked = driveSelectedIds.includes(f.id);
                        return (
                          <label
                            key={f.id}
                            className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 cursor-pointer"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setDriveSelectedIds((prev) =>
                                    checked ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                                  )
                                }
                              />
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="font-medium text-slate-800 truncate">{f.name}</span>
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {f.mimeType.includes('spreadsheet')
                                ? 'Sheet'
                                : f.mimeType.includes('document')
                                  ? 'Doc'
                                  : f.mimeType.includes('pdf')
                                    ? 'PDF'
                                    : 'File'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={driveBusy === 'sync' || driveSelectedIds.length === 0}
                    onClick={() => void handleSyncDrive()}
                    className="w-full px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5"
                  >
                    {driveBusy === 'sync' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Import Selected Drive Files ({driveSelectedIds.length})
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 3. JIRA CARD */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-700 text-white flex items-center justify-center shrink-0">
                  <KanbanSquare className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Jira Cloud</h2>
                  <p className="text-xs text-slate-600">
                    Sync project issues, ticket keys, statuses, priorities, and assignees.
                  </p>
                </div>
              </div>
              {jira && <ProviderStatusBadge status={jira.account.status} />}
            </div>

            {jira?.account.status === 'connected' ? (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Workspace: <strong className="text-slate-900">{jira.account.workspaceName}</strong> (
                    {jira.account.accountLabel})
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect('jira')}
                    className="text-red-700 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-slate-500">
                  <span>{jira.account.siteUrl}</span>
                  <span>
                    · Last Sync:{' '}
                    {jira.account.lastSyncAt ? formatDateTime(jira.account.lastSyncAt) : 'Not synced yet'}
                  </span>
                </div>
              </div>
            ) : jira?.oauthConfigured ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleOAuthPopup('jira')}
                  className="w-full px-4 py-2.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg"
                >
                  Authorize with Atlassian Jira OAuth
                </button>
                <p className="text-[11px] text-slate-500">{jira.setupInstructions}</p>
              </div>
            ) : (
              <NotConfiguredNotice
                providerName="Atlassian Jira"
                envVars={['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'APP_URL']}
                callbackUrl={jira?.callbackUrl}
                setupInstructions={jira?.setupInstructions}
              />
            )}
          </div>

          {jira?.account.status === 'connected' && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Select Jira Project</span>
                <button
                  type="button"
                  onClick={() => void handleLoadJiraProjects()}
                  disabled={jiraBusy === 'projects'}
                  className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  {jiraBusy === 'projects' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {jiraProjects.length > 0 ? 'Reload Projects' : 'Load Projects'}
                </button>
              </div>
              <div className="flex gap-2">
                {jiraProjects.length > 0 ? (
                  <select
                    aria-label="Select Jira project"
                    value={jiraSelectedKey}
                    onChange={(e) => setJiraSelectedKey(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  >
                    {jiraProjects.map((jp) => (
                      <option key={jp.id} value={jp.key}>
                        {jp.key} · {jp.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={jiraSelectedKey}
                    onChange={(e) => setJiraSelectedKey(e.target.value)}
                    placeholder="Enter Jira Project Key (e.g. PAY)"
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
                  />
                )}
                <button
                  type="button"
                  disabled={jiraBusy === 'sync' || !jiraSelectedKey.trim()}
                  onClick={() => void handleSyncJira()}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {jiraBusy === 'sync' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Sync Issues
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 4. SLACK CARD */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
                  <Hash className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Slack Channels</h2>
                  <p className="text-xs text-slate-600">
                    Import engineering decisions, incident threads, and handover notes from channels.
                  </p>
                </div>
              </div>
              {slack && <ProviderStatusBadge status={slack.account.status} />}
            </div>

            {slack?.account.status === 'connected' ? (
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Workspace: <strong className="text-slate-900">{slack.account.workspaceName}</strong> (
                    {slack.account.accountLabel})
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect('slack')}
                    className="text-red-700 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    <Unplug className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-slate-500">
                  <span>
                    Last Sync:{' '}
                    {slack.account.lastSyncAt ? formatDateTime(slack.account.lastSyncAt) : 'Not synced yet'}
                  </span>
                  {typeof slack.account.lastSyncCount === 'number' && (
                    <span>· {slack.account.lastSyncCount} messages</span>
                  )}
                </div>
              </div>
            ) : slack?.oauthConfigured ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleOAuthPopup('slack')}
                  className="w-full px-4 py-2.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Authorize with Slack OAuth
                </button>
                <p className="text-[11px] text-slate-500">{slack.setupInstructions}</p>
              </div>
            ) : (
              <NotConfiguredNotice
                providerName="Slack"
                envVars={['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'APP_URL']}
                callbackUrl={slack?.callbackUrl}
                setupInstructions={slack?.setupInstructions}
              />
            )}

            {slackWarning && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {slackWarning}
              </p>
            )}
          </div>

          {slack?.account.status === 'connected' && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">Select Channels to Import</span>
                <button
                  type="button"
                  onClick={() => void handleLoadSlackChannels()}
                  disabled={slackBusy === 'channels'}
                  className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                >
                  {slackBusy === 'channels' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {slackChannels.length > 0 ? 'Reload Channels' : 'Load Channels'}
                </button>
              </div>

              {slackChannels.length > 0 && (
                <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {slackChannels.map((ch) => {
                    const checked = slackSelectedIds.includes(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSlackSelectedIds((prev) =>
                                checked ? prev.filter((id) => id !== ch.id) : [...prev, ch.id],
                              )
                            }
                          />
                          <span className="font-mono font-medium text-slate-800 truncate">
                            #{ch.name}
                          </span>
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {ch.isPrivate ? 'Private' : 'Public'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                disabled={slackBusy === 'sync' || slackSelectedIds.length === 0}
                onClick={() => void handleSyncSlack()}
                className="w-full px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5"
              >
                {slackBusy === 'sync' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Sync Selected Channels ({slackSelectedIds.length})
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Synced External Sources & Sync History */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Synced External Sources ({externalSources.length})
              </h2>
              <p className="text-xs text-slate-500">
                Live records imported into {currentProject?.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
            >
              Project Activity
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {externalSources.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No external integrations synced to this project yet. Authorize a configured provider above to import live sources.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {externalSources.map((ext) => (
                <div key={ext.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded bg-blue-50 text-blue-800 border border-blue-200">
                        {ext.provider}
                      </span>
                      {ext.sourceType && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 text-slate-600">
                          {ext.sourceType}
                        </span>
                      )}
                      <p className="text-xs font-semibold text-slate-900 truncate">{ext.title}</p>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{ext.metadataSummary}</p>
                    <p className="text-[11px] text-slate-400">
                      Synced {formatDateTime(ext.syncedAt)}
                      {ext.authorOrAssignee ? ` · ${ext.authorOrAssignee}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ext.externalUrl && (
                      <a
                        href={ext.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-500 hover:text-blue-700 rounded border border-slate-200"
                        title="Open external source"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectSource(ext.sourceId, ext.title)}
                      className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Sync Audit Ledger ({syncRuns.length})
            </h2>
            <p className="text-xs text-slate-500">
              Real API sync runs, duplicate skips, and error diagnostics
            </p>
          </div>

          {syncRuns.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No integration sync runs recorded for this project yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
              {syncRuns.map((run) => (
                <div key={run.id} className="p-4 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 uppercase">
                      {run.provider} · {run.targetLabel}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded font-medium border ${
                        run.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-red-50 text-red-800 border-red-200'
                      }`}
                    >
                      {run.status === 'completed' ? 'Synced' : 'Failed'}
                    </span>
                  </div>
                  <p className="text-slate-600 tabular-nums">
                    Fetched: {run.recordsFetched} · Imported: {run.recordsImported} · Deduplicated:{' '}
                    {run.duplicatesSkipped} · {formatDateTime(run.completedAt)}
                  </p>
                  {run.warning && <p className="text-amber-700">{run.warning}</p>}
                  {run.error && <p className="text-red-700">{run.error}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
