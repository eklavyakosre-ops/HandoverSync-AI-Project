import { GoogleGenAI, Type } from '@google/genai';
import type { ActivitySource, HandoverPack, Project } from '../src/types.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const handoverResponseSchema = {
  type: Type.OBJECT,
  properties: {
    projectSummary: {
      type: Type.OBJECT,
      properties: {
        executiveOverview: {
          type: Type.STRING,
          description: 'Concise 2-3 sentence executive summary of project state and transition scope.',
        },
        architectureContext: {
          type: Type.STRING,
          description: 'Key technical architecture, services, and infrastructure context extracted from sources.',
        },
        handoverReadinessNote: {
          type: Type.STRING,
          description: 'Clear assessment of immediate readiness, main blockers, and handoff priorities.',
        },
      },
      required: ['executiveOverview', 'architectureContext', 'handoverReadinessNote'],
    },
    completedTasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          owner: { type: Type.STRING },
          completedDate: { type: Type.STRING },
          impact: { type: Type.STRING },
          sourceEvidence: {
            type: Type.STRING,
            description: 'Exact source citation such as "GitHub PR #142" or "sprint_46_payment_tasks.csv · Row PAY-401".',
          },
          sourceId: {
            type: Type.STRING,
            description: 'Must match one of the provided source IDs.',
          },
        },
        required: ['id', 'title', 'owner', 'completedDate', 'impact', 'sourceEvidence', 'sourceId'],
      },
    },
    pendingTasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          task: { type: Type.STRING },
          priority: {
            type: Type.STRING,
            description: 'One of: Critical, High, Medium, Low',
          },
          deadline: { type: Type.STRING },
          status: {
            type: Type.STRING,
            description: 'One of: Blocked, At Risk, In Progress, Not Started',
          },
          owner: { type: Type.STRING },
          context: { type: Type.STRING },
          sourceEvidence: {
            type: Type.STRING,
            description: 'Exact source citation such as "GitHub Issue #24" or "sprint_46_payment_tasks.csv · Row PAY-404".',
          },
          sourceId: {
            type: Type.STRING,
            description: 'Must match one of the provided source IDs.',
          },
        },
        required: ['id', 'task', 'priority', 'deadline', 'status', 'owner', 'context', 'sourceEvidence', 'sourceId'],
      },
    },
    deadlines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          milestone: { type: Type.STRING },
          date: { type: Type.STRING },
          owner: { type: Type.STRING },
          criticality: {
            type: Type.STRING,
            description: 'One of: Critical, High, Standard',
          },
          sourceEvidence: { type: Type.STRING },
          sourceId: { type: Type.STRING },
        },
        required: ['id', 'milestone', 'date', 'owner', 'criticality', 'sourceEvidence', 'sourceId'],
      },
    },
    importantFiles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            description: 'One of: Repository, Runbook, Spreadsheet, Pull Request, Architecture Doc, Dashboard',
          },
          locationOrUrl: { type: Type.STRING },
          purpose: { type: Type.STRING },
          owner: { type: Type.STRING },
          sourceEvidence: { type: Type.STRING },
          sourceId: { type: Type.STRING },
        },
        required: ['id', 'name', 'kind', 'locationOrUrl', 'purpose', 'owner', 'sourceEvidence', 'sourceId'],
      },
    },
    risksAndNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          severity: {
            type: Type.STRING,
            description: 'One of: Critical, High, Moderate',
          },
          mitigation: { type: Type.STRING },
          sourceEvidence: { type: Type.STRING },
          sourceId: { type: Type.STRING },
        },
        required: ['id', 'title', 'severity', 'mitigation', 'sourceEvidence', 'sourceId'],
      },
    },
  },
  required: [
    'projectSummary',
    'completedTasks',
    'pendingTasks',
    'deadlines',
    'importantFiles',
    'risksAndNotes',
  ],
};

function normalizePriority(val: string): 'Critical' | 'High' | 'Medium' | 'Low' {
  const lower = val.toLowerCase();
  if (lower.includes('crit')) return 'Critical';
  if (lower.includes('high')) return 'High';
  if (lower.includes('low')) return 'Low';
  return 'Medium';
}

function normalizeStatus(val: string): 'Blocked' | 'At Risk' | 'In Progress' | 'Not Started' {
  const lower = val.toLowerCase();
  if (lower.includes('block')) return 'Blocked';
  if (lower.includes('risk')) return 'At Risk';
  if (lower.includes('progress')) return 'In Progress';
  return 'Not Started';
}

function normalizeCriticality(val: string): 'Critical' | 'High' | 'Standard' {
  const lower = val.toLowerCase();
  if (lower.includes('crit')) return 'Critical';
  if (lower.includes('high')) return 'High';
  return 'Standard';
}

function normalizeFileKind(
  val: string,
): 'Repository' | 'Runbook' | 'Spreadsheet' | 'Pull Request' | 'Architecture Doc' | 'Dashboard' {
  const lower = val.toLowerCase();
  if (lower.includes('repo')) return 'Repository';
  if (lower.includes('runbook')) return 'Runbook';
  if (lower.includes('sheet') || lower.includes('csv')) return 'Spreadsheet';
  if (lower.includes('pull') || lower.includes('pr')) return 'Pull Request';
  if (lower.includes('dash')) return 'Dashboard';
  return 'Architecture Doc';
}

function normalizeSeverity(val: string): 'Critical' | 'High' | 'Moderate' {
  const lower = val.toLowerCase();
  if (lower.includes('crit')) return 'Critical';
  if (lower.includes('high')) return 'High';
  return 'Moderate';
}

export async function generateHandoverWithAI(params: {
  project: Project;
  sources: ActivitySource[];
  version: number;
  focusInstructions?: string;
}): Promise<HandoverPack> {
  const { project, sources, version, focusInstructions } = params;
  const ai = getAiClient();

  const validSourceIds = new Set(sources.map((s) => s.id));
  const fallbackSourceId = sources[0]?.id ?? 'unknown';

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  const headerText = [
    `You are HandoverSync AI, an enterprise engineering knowledge-transfer extraction agent.`,
    `Analyze ALL provided project sources and synthesize a complete, strictly grounded, human-verifiable Handover Pack.`,
    ``,
    `PROJECT METADATA:`,
    `- Project Name: ${project.name} (${project.code})`,
    `- Department: ${project.department}`,
    `- Outgoing Lead: ${project.outgoingLead.name} (${project.outgoingLead.role})`,
    `- Incoming Owner: ${project.incomingOwner.name} (${project.incomingOwner.role})`,
    `- Target Exit Date: ${project.targetExitDate}`,
    focusInstructions?.trim() ? `- Outgoing Engineer Focus Notes: ${focusInstructions.trim()}` : '',
    ``,
    `CRITICAL GROUNDING RULES:`,
    `1. Every single completed task, pending task, deadline, important file, and risk MUST include a specific 'sourceEvidence' string naming the exact origin (e.g., "GitHub Issue #24", "sprint_46_payment_tasks.csv · Row PAY-404", "payment_v3_handover_runbook.txt · Section 2").`,
    `2. Every item's 'sourceId' MUST exactly match one of the source IDs listed below.`,
    `3. Do NOT fabricate tasks, dates, or URLs that are not present in the provided sources.`,
    `4. Ensure pendingTasks accurately captures priority, deadline, status, and owner.`,
    ``,
    `AVAILABLE SOURCE IDS AND CONTENTS:`,
  ]
    .filter(Boolean)
    .join('\n');

  parts.push({ text: headerText });

  for (const src of sources) {
    if (src.kind === 'pdf' && src.base64Data) {
      parts.push({
        text: `\n--- SOURCE [id="${src.id}"] | File: "${src.fileName}" | Type: PDF Document | Title: "${src.title}" ---\n(Attached PDF binary follows below; extract tasks, risks, deadlines, files, and cite "${src.fileName}" with page/section reference.)`,
      });
      parts.push({
        inlineData: {
          mimeType: src.mimeType || 'application/pdf',
          data: src.base64Data,
        },
      });
    } else {
      parts.push({
        text: `\n--- SOURCE [id="${src.id}"] | File: "${src.fileName}" | Type: ${src.kind.toUpperCase()} | Title: "${src.title}" ---\n${src.content}\n--- END SOURCE [id="${src.id}"] ---`,
      });
    }
  }

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'Extract strictly grounded, structured project handover JSON. Every output item must cite exact source evidence and valid sourceId.',
      responseMimeType: 'application/json',
      responseSchema: handoverResponseSchema,
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    projectSummary?: HandoverPack['projectSummary'];
    completedTasks?: HandoverPack['completedTasks'];
    pendingTasks?: Array<Omit<HandoverPack['pendingTasks'][number], 'priority' | 'status'> & { priority: string; status: string }>;
    deadlines?: Array<Omit<HandoverPack['deadlines'][number], 'criticality'> & { criticality: string }>;
    importantFiles?: Array<Omit<HandoverPack['importantFiles'][number], 'kind'> & { kind: string }>;
    risksAndNotes?: Array<Omit<HandoverPack['risksAndNotes'][number], 'severity'> & { severity: string }>;
  };

  const resolveSourceId = (id: string) => (validSourceIds.has(id) ? id : fallbackSourceId);

  const completedTasks = (parsed.completedTasks ?? []).map((item, idx) => ({
    ...item,
    id: item.id || `ct-${Date.now()}-${idx}`,
    sourceId: resolveSourceId(item.sourceId),
  }));

  const pendingTasks = (parsed.pendingTasks ?? []).map((item, idx) => ({
    ...item,
    id: item.id || `pt-${Date.now()}-${idx}`,
    priority: normalizePriority(item.priority || 'Medium'),
    status: normalizeStatus(item.status || 'Not Started'),
    sourceId: resolveSourceId(item.sourceId),
  }));

  const deadlines = (parsed.deadlines ?? []).map((item, idx) => ({
    ...item,
    id: item.id || `dl-${Date.now()}-${idx}`,
    criticality: normalizeCriticality(item.criticality || 'Standard'),
    sourceId: resolveSourceId(item.sourceId),
  }));

  const importantFiles = (parsed.importantFiles ?? []).map((item, idx) => ({
    ...item,
    id: item.id || `if-${Date.now()}-${idx}`,
    kind: normalizeFileKind(item.kind || 'Architecture Doc'),
    sourceId: resolveSourceId(item.sourceId),
  }));

  const risksAndNotes = (parsed.risksAndNotes ?? []).map((item, idx) => ({
    ...item,
    id: item.id || `rk-${Date.now()}-${idx}`,
    severity: normalizeSeverity(item.severity || 'Moderate'),
    sourceId: resolveSourceId(item.sourceId),
  }));

  // Count citations per source
  const citationMap = new Map<string, number>();
  for (const s of sources) citationMap.set(s.id, 0);
  for (const list of [completedTasks, pendingTasks, deadlines, importantFiles, risksAndNotes]) {
    for (const item of list) {
      citationMap.set(item.sourceId, (citationMap.get(item.sourceId) ?? 0) + 1);
    }
  }

  const handoverPack: HandoverPack = {
    id: `ho-${project.id}-v${version}-${Date.now()}`,
    projectId: project.id,
    version,
    generatedAt: new Date().toISOString(),
    generatedByModel: 'gemini-4-hydrogen',
    status: 'in_review',
    projectSummary: parsed.projectSummary ?? {
      executiveOverview: `Handover pack generated for ${project.name}.`,
      architectureContext: 'Extracted from attached project repositories and operational docs.',
      handoverReadinessNote: 'Pending human review and approval.',
    },
    completedTasks,
    pendingTasks,
    deadlines,
    importantFiles,
    risksAndNotes,
    sourcesAnalyzed: sources.map((s) => ({
      sourceId: s.id,
      fileName: s.fileName,
      kind: s.kind,
      citationCount: citationMap.get(s.id) ?? 0,
    })),
  };

  return handoverPack;
}
