export type UserRole = 'outgoing_lead' | 'incoming_manager' | 'engineering_director';

export type ScreenId =
  | 'landing'
  | 'dashboard'
  | 'activity'
  | 'integrations'
  | 'gaps'
  | 'qa'
  | 'generate'
  | 'pack'
  | 'pending'
  | 'files'
  | 'review'
  | 'history'
  | 'chatbot';

export type SourceKind = 'csv' | 'docs' | 'github' | 'pdf';

export interface ActivitySource {
  id: string;
  projectId: string;
  title: string;
  kind: SourceKind;
  fileName: string;
  addedBy: string;
  addedAt: string;
  recordCount: number;
  content: string;
  base64Data?: string;
  mimeType?: string;
  highlights?: string[];
}

export interface CompletedTask {
  id: string;
  title: string;
  owner: string;
  completedDate: string;
  impact: string;
  sourceEvidence: string;
  sourceId: string;
}

export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Blocked' | 'At Risk' | 'In Progress' | 'Not Started';

export interface PendingTask {
  id: string;
  task: string;
  priority: TaskPriority;
  deadline: string;
  status: TaskStatus;
  owner: string;
  context: string;
  sourceEvidence: string;
  sourceId: string;
}

export interface DeadlineItem {
  id: string;
  milestone: string;
  date: string;
  owner: string;
  criticality: 'Critical' | 'High' | 'Standard';
  sourceEvidence: string;
  sourceId: string;
}

export interface ImportantFile {
  id: string;
  name: string;
  kind: 'Repository' | 'Runbook' | 'Spreadsheet' | 'Pull Request' | 'Architecture Doc' | 'Dashboard';
  locationOrUrl: string;
  purpose: string;
  owner: string;
  sourceEvidence: string;
  sourceId: string;
}

export interface RiskNote {
  id: string;
  title: string;
  severity: 'Critical' | 'High' | 'Moderate';
  mitigation: string;
  sourceEvidence: string;
  sourceId: string;
}

export type HandoverApprovalStatus = 'in_review' | 'approved' | 'changes_requested';

export interface HandoverPack {
  id: string;
  projectId: string;
  version: number;
  generatedAt: string;
  generatedByModel: string;
  status: HandoverApprovalStatus;
  projectSummary: {
    executiveOverview: string;
    architectureContext: string;
    handoverReadinessNote: string;
  };
  completedTasks: CompletedTask[];
  pendingTasks: PendingTask[];
  deadlines: DeadlineItem[];
  importantFiles: ImportantFile[];
  risksAndNotes: RiskNote[];
  sourcesAnalyzed: {
    sourceId: string;
    fileName: string;
    kind: SourceKind;
    citationCount: number;
  }[];
  humanReview?: {
    reviewerName: string;
    reviewerRole: string;
    reviewedAt: string;
    decision: HandoverApprovalStatus;
    comments: string;
    editedFields: string[];
  };
  technologyStack?: string[];
  connectedIntegrations?: Array<{
    provider: IntegrationProviderId;
    displayName: string;
    targetLabel: string;
    syncedAt?: string;
    recordsImported?: number;
  }>;
  unresolvedIssues?: Array<{
    id: string;
    title: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    status: string;
    sourceEvidence: string;
    sourceId: string;
  }>;
  knowledgeGapsSnapshot?: Array<{
    gapId: string;
    title: string;
    category: GapCategory;
    severity: GapSeverity;
    status: GapStatus;
    assignedOwner: string | null;
  }>;
  missingDocumentation?: string[];
  importantDecisions?: Array<{
    id: string;
    decision: string;
    rationale: string;
    sourceEvidence: string;
    sourceId: string;
  }>;
  dependencies?: Array<{
    id: string;
    name: string;
    details: string;
    owner?: string;
    sourceEvidence: string;
    sourceId: string;
  }>;
  operationalInstructions?: string[];
  suggestedNextActions?: string[];
}

export interface Project {
  id: string;
  name: string;
  code: string;
  department: string;
  description: string;
  outgoingLead: {
    name: string;
    role: string;
    email: string;
    avatar: string;
  };
  incomingOwner: {
    name: string;
    role: string;
    email: string;
    avatar: string;
  };
  targetExitDate: string;
  healthState: 'Ready for Review' | 'Drafting' | 'Approved' | 'At Risk';
  updatedAt: string;
}

export interface ProjectSummaryDTO extends Project {
  sourceCount: number;
  sourceBreakdown: Record<SourceKind, number>;
  latestHandover: HandoverPack | null;
  historyCount: number;
}

// --- Knowledge Gap Detector Types (Promise 1) ---

export type GapCategory =
  | 'Missing Documentation'
  | 'Undocumented Technical Decisions'
  | 'Unresolved Issues'
  | 'Unclear Ownership'
  | 'Missing Technical Context'
  | 'Architecture Knowledge Gaps'
  | 'Missing Dependencies Information'
  | 'Incomplete Handover Information'
  | 'Missing Operational Knowledge'
  | 'Unverified Project Assumptions';

export type GapSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type GapConfidence = 'Confirmed' | 'Possible' | 'Requires Verification';
export type GapStatus = 'Open' | 'In Progress' | 'Resolved' | 'Not a Gap';

export interface GapEvidence {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceKind | 'handover_pack' | 'missing';
  fileName: string;
  recordId?: string;
  excerpt: string;
  locationReference?: string;
  relevanceExplanation: string;
}

export interface GapReviewNote {
  id: string;
  author: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

export interface GapActivity {
  id: string;
  action:
    | 'created'
    | 'updated_by_analysis'
    | 'assigned_owner'
    | 'note_added'
    | 'status_changed'
    | 'resolved'
    | 'dismissed';
  actor: string;
  timestamp: string;
  details: string;
  analysisRunId?: string;
}

export interface KnowledgeGap {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  category: GapCategory;
  severity: GapSeverity;
  confidence: GapConfidence;
  description: string;
  reasonForDetection: string;
  evidenceReferences: GapEvidence[];
  relevantSourceIds: string[];
  suggestedAction: string;
  assignedOwner: string | null;
  humanOwnerLocked: boolean;
  humanStatusLocked: boolean;
  reviewNotes: GapReviewNote[];
  status: GapStatus;
  resolutionReason?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  dismissalReason?: string;
  dismissedBy?: string;
  dismissedAt?: string;
  createdAt: string;
  updatedAt: string;
  analysisRunId: string;
  lastSeenRunId: string;
  activityHistory: GapActivity[];
}

export interface GapSourceInventoryItem {
  sourceId: string;
  title: string;
  kind: SourceKind | 'handover_pack';
  fileName: string;
  recordCount: number;
  addedAt: string;
  status: 'included' | 'skipped';
  skipReason?: string;
}

export interface GapAnalysisRun {
  id: string;
  projectId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  sourcesAnalyzedCount: number;
  sourceInventory: GapSourceInventoryItem[];
  findingsCreated: number;
  findingsUpdated: number;
  warnings: string[];
  error?: string;
}

export interface GapSummaryCounts {
  total: number;
  open: number;
  inProgress: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  resolved: number;
  notAGap: number;
}

export interface KnowledgeGapsResponse {
  projectId: string;
  lastAnalyzedAt: string | null;
  latestRun: GapAnalysisRun | null;
  sourceInventory: GapSourceInventoryItem[];
  summary: GapSummaryCounts;
  gaps: KnowledgeGap[];
  projectMembers: Array<{ name: string; role: string }>;
}

// --- Evidence-Cited Handover Q&A Types (Promise 2) ---

export type QaEvidenceOriginKind =
  | SourceKind
  | 'handover_pack'
  | 'knowledge_gap';

export interface QaCitation {
  citationNumber: number;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: QaEvidenceOriginKind;
  fileName: string;
  locationIdentifier: string;
  snippet: string;
  canOpenSource: boolean;
  isGapFinding: boolean;
}

export interface QaAnswerSection {
  heading: string;
  kind: 'direct_evidence' | 'interpretation' | 'insufficient_evidence';
  body: string;
}

export interface QaMessage {
  id: string;
  conversationId: string;
  projectId: string;
  role: 'user' | 'assistant';
  author: string;
  content: string;
  sections?: QaAnswerSection[];
  citations: QaCitation[];
  insufficientEvidence?: boolean;
  missingDetails?: string;
  createdAt: string;
}

export interface QaConversation {
  id: string;
  projectId: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  messages: QaMessage[];
}

export interface QaConversationsListResponse {
  projectId: string;
  sourceSummary: {
    totalSources: number;
    breakdown: Record<SourceKind, number>;
    handoverPackCount: number;
    knowledgeGapCount: number;
  };
  suggestedQuestions: string[];
  conversations: QaConversation[];
}

export interface BotConversationsListResponse {
  botName: string;
  projectId: string;
  projectContextSummary: {
    totalSources: number;
    handoverPackCount: number;
    latestPackVersion: number | null;
    latestPackStatus: HandoverApprovalStatus | null;
    openGapCount: number;
    pendingTaskCount: number;
    syncedIntegrationCount: number;
  };
  suggestedPrompts: string[];
  conversations: QaConversation[];
}

// --- Real Project Integrations Types ---

export type IntegrationProviderId = 'github' | 'drive' | 'jira' | 'slack';

export type IntegrationConnectionStatus =
  | 'not_configured'
  | 'disconnected'
  | 'connected'
  | 'error';

export type IntegrationAuthMode = 'oauth' | 'token' | 'firebase_oauth';

export interface IntegrationAccount {
  provider: IntegrationProviderId;
  status: IntegrationConnectionStatus;
  authMode?: IntegrationAuthMode;
  accountLabel?: string;
  workspaceName?: string;
  siteUrl?: string;
  selectedTargetId?: string;
  selectedTargetLabel?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncCount?: number;
  lastError?: string;
  rateLimitRemaining?: number;
  rateLimitLimit?: number;
}

export interface IntegrationProviderStatusDTO {
  provider: IntegrationProviderId;
  displayName: string;
  oauthConfigured: boolean;
  tokenAuthSupported: boolean;
  callbackUrl?: string;
  setupInstructions?: string;
  account: IntegrationAccount;
}

export interface IntegrationSyncRun {
  id: string;
  projectId: string;
  provider: IntegrationProviderId;
  targetLabel: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'failed';
  recordsFetched: number;
  recordsImported: number;
  duplicatesSkipped: number;
  sourceId?: string;
  warning?: string;
  error?: string;
}

export interface IntegrationConfiguration {
  id: string;
  projectId: string;
  provider: IntegrationProviderId;
  selectedTargetId: string;
  selectedTargetLabel: string;
  includeCommits?: boolean;
  includeIssues?: boolean;
  includePullRequests?: boolean;
  includeDocs?: boolean;
  updatedAt: string;
}

export type ExternalSourceType =
  | 'repo_overview'
  | 'commits'
  | 'issues'
  | 'pull_requests'
  | 'documentation'
  | 'github_sync'
  | 'drive_file'
  | 'jira_issues'
  | 'slack_channel';

export interface ExternalSourceRecord {
  id: string;
  internalSourceId?: string;
  projectId: string;
  provider: IntegrationProviderId;
  externalId: string;
  sourceType?: ExternalSourceType;
  externalUrl?: string;
  title: string;
  content?: string;
  authorOrAssignee?: string;
  sourceId: string;
  createdAt?: string;
  updatedAt?: string;
  syncedAt: string;
  metadataSummary: string;
}

export interface IntegrationSecretRecord {
  provider: IntegrationProviderId;
  accessToken: string;
  refreshToken?: string;
  email?: string;
  siteUrl?: string;
  expiresAt?: string;
  updatedAt: string;
}

export interface HandoverDatabase {
  projects: Project[];
  sources: ActivitySource[];
  handovers: HandoverPack[];
  knowledgeGaps: KnowledgeGap[];
  gapAnalysisRuns: GapAnalysisRun[];
  qaConversations: QaConversation[];
  botConversations?: QaConversation[];
  integrations?: Partial<Record<IntegrationProviderId, IntegrationAccount>>;
  integrationConfigurations?: IntegrationConfiguration[];
  integrationSecrets?: Partial<Record<IntegrationProviderId, IntegrationSecretRecord>>;
  syncRuns?: IntegrationSyncRun[];
  externalSources?: ExternalSourceRecord[];
}

export interface UserSession {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  avatar: string;
}
