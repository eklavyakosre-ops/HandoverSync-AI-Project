import type {
  ActivitySource,
  HandoverApprovalStatus,
  HandoverPack,
  ProjectSummaryDTO,
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
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function fetchProjects(): Promise<ProjectSummaryDTO[]> {
  const res = await fetch('/api/projects');
  const data = await handleJson<{ projects: ProjectSummaryDTO[] }>(res);
  return data.projects;
}

export async function fetchProjectDetail(projectId: string): Promise<ProjectDetailResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
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
  const res = await fetch('/api/history');
  const data = await handleJson<{ history: HistoryEntry[] }>(res);
  return data.history;
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
  ];

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
