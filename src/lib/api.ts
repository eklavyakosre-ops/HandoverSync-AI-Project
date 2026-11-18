import type {
  ActivitySource,
  BotConversationsListResponse,
  ExternalSourceRecord,
  GapAnalysisRun,
  GapStatus,
  GapSummaryCounts,
  HandoverApprovalStatus,
  HandoverPack,
  IntegrationAccount,
  IntegrationConfiguration,
  IntegrationProviderId,
  IntegrationProviderStatusDTO,
  IntegrationSyncRun,
  KnowledgeGap,
  KnowledgeGapsResponse,
  ProjectSummaryDTO,
  QaCitation,
  QaConversation,
  QaConversationsListResponse,
  QaMessage,
  SourceKind,
} from '../types';

export interface ProjectDetailResponse {
  project: ProjectSummaryDTO;
  sources: ActivitySource[];
  handovers: HandoverPack[];
}

export interface HistoryEntry {
  handover: HandoverPack;
  projectName: string;
  projectCode: string;
  outgoingLead: string;
  incomingOwner: string;
}

async function handleJson<T>(res: Response): Promise<T> {
  const rawText = await res.text();
  let data: (T & { error?: string }) | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as T & { error?: string };
    } catch {
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      throw new Error('Server returned an unexpected non-JSON response.');
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return (data ?? {}) as T;
}

async function fetchGet(url: string, retries = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.status >= 502 && res.status <= 504 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to reach backend API.');
}

export async function fetchProjects(): Promise<ProjectSummaryDTO[]> {
  const res = await fetchGet('/api/projects');
  const data = await handleJson<{ projects: ProjectSummaryDTO[] }>(res);
  return data.projects;
}

export async function fetchProjectDetail(projectId: string): Promise<ProjectDetailResponse> {
  const res = await fetchGet(`/api/projects/${encodeURIComponent(projectId)}`);
  return handleJson<ProjectDetailResponse>(res);
}

export async function addProjectSource(
  projectId: string,
  payload: {
    title: string;
    kind: SourceKind;
    fileName: string;
    addedBy: string;
    content?: string;
    base64Data?: string;
    mimeType?: string;
  },
): Promise<ActivitySource> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ source: ActivitySource }>(res);
  return data.source;
}

export async function deleteProjectSource(projectId: string, sourceId: string): Promise<void> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE' },
  );
  await handleJson<{ deleted: boolean }>(res);
}

export async function generateHandover(payload: {
  projectId: string;
  selectedSourceIds: string[];
  focusInstructions?: string;
}): Promise<HandoverPack> {
  const res = await fetch('/api/generate-handover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ handover: HandoverPack }>(res);
  return data.handover;
}

export async function updateHandoverDraft(
  handoverId: string,
  updates: Partial<
    Pick<
      HandoverPack,
      | 'projectSummary'
      | 'completedTasks'
      | 'pendingTasks'
      | 'deadlines'
      | 'importantFiles'
      | 'risksAndNotes'
    >
  >,
): Promise<HandoverPack> {
  const res = await fetch(`/api/handovers/${encodeURIComponent(handoverId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const data = await handleJson<{ handover: HandoverPack }>(res);
  return data.handover;
}

export async function submitHandoverApproval(
  handoverId: string,
  payload: {
    decision: HandoverApprovalStatus;
    reviewerName: string;
    reviewerRole: string;
    comments: string;
    editedFields: string[];
  },
): Promise<HandoverPack> {
  const res = await fetch(`/api/handovers/${encodeURIComponent(handoverId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ handover: HandoverPack }>(res);
  return data.handover;
}

export async function fetchHandoverHistory(): Promise<HistoryEntry[]> {
  const res = await fetchGet('/api/history');
  const data = await handleJson<{ history: HistoryEntry[] }>(res);
  return data.history;
}

// --- Knowledge Gap Detector API Client ---

export async function fetchKnowledgeGaps(projectId: string): Promise<KnowledgeGapsResponse> {
  const res = await fetchGet(`/api/projects/${encodeURIComponent(projectId)}/knowledge-gaps`);
  return handleJson<KnowledgeGapsResponse>(res);
}

export async function runKnowledgeGapAnalysisApi(projectId: string): Promise<{
  run: GapAnalysisRun;
  gaps: KnowledgeGap[];
  summary: GapSummaryCounts;
}> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge-gaps/analyze`,
    { method: 'POST' },
  );
  return handleJson<{
    run: GapAnalysisRun;
    gaps: KnowledgeGap[];
    summary: GapSummaryCounts;
  }>(res);
}

export async function fetchKnowledgeGapHistory(projectId: string): Promise<GapAnalysisRun[]> {
  const res = await fetchGet(
    `/api/projects/${encodeURIComponent(projectId)}/knowledge-gaps/history`,
  );
  const data = await handleJson<{ runs: GapAnalysisRun[] }>(res);
  return data.runs;
}

export async function assignKnowledgeGapOwner(
  gapId: string,
  payload: { projectId: string; owner: string; actor: string },
): Promise<KnowledgeGap> {
  const res = await fetch(`/api/knowledge-gaps/${encodeURIComponent(gapId)}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ gap: KnowledgeGap }>(res);
  return data.gap;
}

export async function addKnowledgeGapNote(
  gapId: string,
  payload: { projectId: string; author: string; authorRole: string; content: string },
): Promise<KnowledgeGap> {
  const res = await fetch(`/api/knowledge-gaps/${encodeURIComponent(gapId)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ gap: KnowledgeGap }>(res);
  return data.gap;
}

export async function reviewKnowledgeGap(
  gapId: string,
  payload: {
    projectId: string;
    status: GapStatus;
    reason?: string;
    actor: string;
    confirmed?: boolean;
  },
): Promise<{ gap: KnowledgeGap; summary: GapSummaryCounts }> {
  const res = await fetch(`/api/knowledge-gaps/${encodeURIComponent(gapId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson<{ gap: KnowledgeGap; summary: GapSummaryCounts }>(res);
}

// --- Evidence-Cited Handover Q&A API Client ---

export async function fetchQaConversations(
  projectId: string,
): Promise<QaConversationsListResponse> {
  const res = await fetchGet(`/api/projects/${encodeURIComponent(projectId)}/qa/conversations`);
  return handleJson<QaConversationsListResponse>(res);
}

export async function createQaConversation(
  projectId: string,
  payload?: { title?: string; createdBy?: string },
): Promise<QaConversation> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/qa/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await handleJson<{ conversation: QaConversation }>(res);
  return data.conversation;
}

export async function fetchQaConversation(
  conversationId: string,
  projectId?: string,
): Promise<QaConversation> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await fetchGet(`/api/qa/conversations/${encodeURIComponent(conversationId)}${query}`);
  const data = await handleJson<{ conversation: QaConversation }>(res);
  return data.conversation;
}

export async function sendQaMessage(
  conversationId: string,
  payload: { projectId: string; question: string; author?: string },
): Promise<{
  conversation: QaConversation;
  userMessage: QaMessage;
  assistantMessage: QaMessage;
}> {
  const res = await fetch(
    `/api/qa/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return handleJson<{
    conversation: QaConversation;
    userMessage: QaMessage;
    assistantMessage: QaMessage;
  }>(res);
}

export async function fetchQaMessageEvidence(
  messageId: string,
  projectId?: string,
): Promise<{
  messageId: string;
  conversationId: string;
  projectId: string;
  citations: QaCitation[];
  sources: ActivitySource[];
}> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await fetchGet(`/api/qa/messages/${encodeURIComponent(messageId)}/evidence${query}`);
  return handleJson<{
    messageId: string;
    conversationId: string;
    projectId: string;
    citations: QaCitation[];
    sources: ActivitySource[];
  }>(res);
}

// --- SyncBot Project Chatbot API Client ---

export async function fetchBotConversations(
  projectId: string,
): Promise<BotConversationsListResponse> {
  const res = await fetchGet(`/api/projects/${encodeURIComponent(projectId)}/bot/conversations`);
  return handleJson<BotConversationsListResponse>(res);
}

export async function createBotConversation(
  projectId: string,
  payload?: { title?: string; createdBy?: string },
): Promise<QaConversation> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/bot/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await handleJson<{ conversation: QaConversation }>(res);
  return data.conversation;
}

export async function sendBotMessage(
  conversationId: string,
  payload: { projectId: string; message: string; author?: string },
): Promise<{
  conversation: QaConversation;
  userMessage: QaMessage;
  assistantMessage: QaMessage;
}> {
  const res = await fetch(
    `/api/bot/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return handleJson<{
    conversation: QaConversation;
    userMessage: QaMessage;
    assistantMessage: QaMessage;
  }>(res);
}

export async function deleteBotConversation(
  conversationId: string,
  projectId?: string,
): Promise<void> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await fetch(
    `/api/bot/conversations/${encodeURIComponent(conversationId)}${query}`,
    { method: 'DELETE' },
  );
  await handleJson<{ deleted: boolean }>(res);
}

// --- Real Project Integrations API Client ---

export interface IntegrationsListResponse {
  providers: IntegrationProviderStatusDTO[];
  configurations: IntegrationConfiguration[];
  syncRuns: IntegrationSyncRun[];
  externalSources: ExternalSourceRecord[];
}

export interface GitHubRepoSummary {
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

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  size?: string;
  ownerName?: string;
}

export interface JiraProjectSummary {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
}

export interface SlackChannelSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  topic?: string;
}

export async function fetchIntegrations(projectId?: string): Promise<IntegrationsListResponse> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await fetchGet(`/api/integrations${query}`);
  return handleJson<IntegrationsListResponse>(res);
}

export async function configureIntegrationApi(
  provider: IntegrationProviderId,
  payload: {
    projectId: string;
    selectedTargetId: string;
    selectedTargetLabel?: string;
    includeCommits?: boolean;
    includeIssues?: boolean;
    includePullRequests?: boolean;
    includeDocs?: boolean;
  },
): Promise<IntegrationConfiguration> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(provider)}/configure`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await handleJson<{ configuration: IntegrationConfiguration }>(res);
  return data.configuration;
}

export async function disconnectIntegrationApi(
  provider: IntegrationProviderId,
): Promise<IntegrationAccount> {
  const res = await fetch(`/api/integrations/${encodeURIComponent(provider)}/disconnect`, {
    method: 'POST',
  });
  const data = await handleJson<{ account: IntegrationAccount }>(res);
  return data.account;
}

export async function fetchOAuthPopupUrl(
  provider: 'github' | 'jira' | 'slack',
): Promise<string> {
  const res = await fetchGet(`/api/integrations/${provider}/oauth-url`, 0);
  const data = await handleJson<{ url: string }>(res);
  return data.url;
}

export async function fetchGitHubReposApi(): Promise<{
  repos: GitHubRepoSummary[];
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
  warning?: string;
}> {
  const res = await fetchGet('/api/integrations/github/repos', 0);
  return handleJson<{
    repos: GitHubRepoSummary[];
    rateLimitRemaining?: number;
    rateLimitLimit?: number;
    warning?: string;
  }>(res);
}

export async function syncGitHubRepoApi(
  projectId: string,
  repoFullName?: string,
): Promise<{
  source: ActivitySource;
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  configuration: IntegrationConfiguration;
  warning?: string;
}> {
  const res = await fetch('/api/integrations/github/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, repoFullName }),
  });
  return handleJson(res);
}

export async function connectGoogleDriveApi(accessToken: string): Promise<IntegrationAccount> {
  const res = await fetch('/api/integrations/drive/connect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await handleJson<{ account: IntegrationAccount }>(res);
  return data.account;
}

export async function fetchGoogleDriveFilesApi(
  accessToken: string,
  query?: string,
): Promise<DriveFileSummary[]> {
  const qParam = query ? `?q=${encodeURIComponent(query)}` : '';
  const res = await fetch(`/api/integrations/drive/files${qParam}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await handleJson<{ files: DriveFileSummary[] }>(res);
  return data.files;
}

export async function syncGoogleDriveFilesApi(
  projectId: string,
  accessToken: string,
  fileIds: string[],
): Promise<{
  sources: ActivitySource[];
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  warnings: string[];
}> {
  const res = await fetch('/api/integrations/drive/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ projectId, fileIds }),
  });
  return handleJson(res);
}

export async function fetchJiraProjectsApi(): Promise<JiraProjectSummary[]> {
  const res = await fetchGet('/api/integrations/jira/projects', 0);
  const data = await handleJson<{ projects: JiraProjectSummary[] }>(res);
  return data.projects;
}

export async function syncJiraProjectApi(
  projectId: string,
  jiraProjectKey: string,
): Promise<{
  source: ActivitySource;
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
}> {
  const res = await fetch('/api/integrations/jira/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, jiraProjectKey }),
  });
  return handleJson(res);
}

export async function fetchSlackChannelsApi(): Promise<{
  channels: SlackChannelSummary[];
  warning?: string;
}> {
  const res = await fetchGet('/api/integrations/slack/channels', 0);
  return handleJson(res);
}

export async function syncSlackChannelsApi(
  projectId: string,
  channels: Array<{ id: string; name?: string }>,
): Promise<{
  sources: ActivitySource[];
  syncRun: IntegrationSyncRun;
  account: IntegrationAccount;
  warnings: string[];
}> {
  const res = await fetch('/api/integrations/slack/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, channels }),
  });
  return handleJson(res);
}

export function buildHandoverMarkdown(pack: HandoverPack, projectName: string): string {
  const lines: string[] = [
    `# ${projectName} — Handover Pack (v${pack.version})`,
    `Status: ${pack.status.toUpperCase()} | Generated: ${new Date(pack.generatedAt).toLocaleString()}`,
    '',
    `## Project Summary`,
    `### Executive Overview`,
    pack.projectSummary.executiveOverview,
    '',
    `### Architecture Context`,
    pack.projectSummary.architectureContext,
    '',
    `### Handover Readiness Note`,
    pack.projectSummary.handoverReadinessNote,
  ];

  if (pack.technologyStack && pack.technologyStack.length > 0) {
    lines.push('', `## Technology Stack`, ...pack.technologyStack.map((t) => `- ${t}`));
  }

  if (pack.connectedIntegrations && pack.connectedIntegrations.length > 0) {
    lines.push(
      '',
      `## Connected Integrations`,
      ...pack.connectedIntegrations.map(
        (ci) =>
          `- **${ci.displayName}**: ${ci.targetLabel}${ci.recordsImported ? ` (${ci.recordsImported} records)` : ''}`,
      ),
    );
  }

  lines.push(
    '',
    `## Pending Work`,
    ...pack.pendingTasks.map(
      (t) =>
        `- **[${t.priority}] ${t.task}** — Status: ${t.status} | Deadline: ${t.deadline} | Owner: ${t.owner} *(Source: ${t.sourceEvidence})*`,
    ),
    '',
    `## Completed Tasks`,
    ...pack.completedTasks.map(
      (c) =>
        `- **${c.title}** (${c.completedDate}, ${c.owner}) — ${c.impact} *(Source: ${c.sourceEvidence})*`,
    ),
  );

  if (pack.unresolvedIssues && pack.unresolvedIssues.length > 0) {
    lines.push(
      '',
      `## Unresolved Issues`,
      ...pack.unresolvedIssues.map(
        (u) =>
          `- **[${u.severity}] ${u.title}** (${u.status}) *(Source: ${u.sourceEvidence})*`,
      ),
    );
  }

  if (pack.knowledgeGapsSnapshot && pack.knowledgeGapsSnapshot.length > 0) {
    lines.push(
      '',
      `## Knowledge Gaps Snapshot`,
      ...pack.knowledgeGapsSnapshot.map(
        (g) =>
          `- **[${g.severity} · ${g.status}] ${g.title}** (${g.category})${g.assignedOwner ? ` — Owner: ${g.assignedOwner}` : ''}`,
      ),
    );
  }

  if (pack.missingDocumentation && pack.missingDocumentation.length > 0) {
    lines.push(
      '',
      `## Missing Documentation`,
      ...pack.missingDocumentation.map((m) => `- ${m}`),
    );
  }

  if (pack.importantDecisions && pack.importantDecisions.length > 0) {
    lines.push(
      '',
      `## Important Technical Decisions`,
      ...pack.importantDecisions.map(
        (d) => `- **${d.decision}** — ${d.rationale} *(Source: ${d.sourceEvidence})*`,
      ),
    );
  }

  if (pack.dependencies && pack.dependencies.length > 0) {
    lines.push(
      '',
      `## Dependencies`,
      ...pack.dependencies.map(
        (dep) =>
          `- **${dep.name}**: ${dep.details}${dep.owner ? ` (Owner: ${dep.owner})` : ''} *(Source: ${dep.sourceEvidence})*`,
      ),
    );
  }

  if (pack.operationalInstructions && pack.operationalInstructions.length > 0) {
    lines.push(
      '',
      `## Operational Instructions & Runbooks`,
      ...pack.operationalInstructions.map((op) => `- ${op}`),
    );
  }

  lines.push(
    '',
    `## Deadlines & Milestones`,
    ...pack.deadlines.map(
      (d) =>
        `- **${d.date}** — ${d.milestone} [${d.criticality}] (${d.owner}) *(Source: ${d.sourceEvidence})*`,
    ),
    '',
    `## Important Files & Links`,
    ...pack.importantFiles.map(
      (f) =>
        `- **${f.name}** (${f.kind}): \`${f.locationOrUrl}\` — ${f.purpose} *(Source: ${f.sourceEvidence})*`,
    ),
    '',
    `## Risks & Notes`,
    ...pack.risksAndNotes.map(
      (r) =>
        `- **[${r.severity}] ${r.title}** — Mitigation: ${r.mitigation} *(Source: ${r.sourceEvidence})*`,
    ),
  );

  if (pack.suggestedNextActions && pack.suggestedNextActions.length > 0) {
    lines.push(
      '',
      `## Suggested Next Actions`,
      ...pack.suggestedNextActions.map((act, idx) => `${idx + 1}. ${act}`),
    );
  }

  if (pack.humanReview) {
    lines.push(
      '',
      `## Human Review & Sign-Off`,
      `- Reviewer: ${pack.humanReview.reviewerName} (${pack.humanReview.reviewerRole})`,
      `- Decision: ${pack.humanReview.decision}`,
      `- Timestamp: ${new Date(pack.humanReview.reviewedAt).toLocaleString()}`,
      `- Comments: ${pack.humanReview.comments}`,
    );
  }

  return lines.join('\n');
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
