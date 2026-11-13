export type UserRole = 'outgoing_lead' | 'incoming_manager' | 'engineering_director';

export type ScreenId =
  | 'landing'
  | 'dashboard'
  | 'activity'
  | 'generate'
  | 'pack'
  | 'pending'
  | 'files'
  | 'review'
  | 'history';

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

export interface HandoverDatabase {
  projects: Project[];
  sources: ActivitySource[];
  handovers: HandoverPack[];
}

export interface UserSession {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  avatar: string;
}
