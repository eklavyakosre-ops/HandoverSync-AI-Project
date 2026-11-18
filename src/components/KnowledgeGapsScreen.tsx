import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSearch,
  History,
  Loader2,
  MessageSquarePlus,
  Play,
  Search,
  ShieldAlert,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  GapAnalysisRun,
  GapCategory,
  GapConfidence,
  GapSeverity,
  GapStatus,
  KnowledgeGap,
  KnowledgeGapsResponse,
  ProjectSummaryDTO,
  ScreenId,
  UserSession,
} from '../types';
import {
  addKnowledgeGapNote,
  assignKnowledgeGapOwner,
  fetchKnowledgeGapHistory,
  fetchKnowledgeGaps,
  reviewKnowledgeGap,
  runKnowledgeGapAnalysisApi,
} from '../lib/api';
import { formatDateTime } from './StatusPrimitives';

const CATEGORIES: GapCategory[] = [
  'Missing Documentation',
  'Undocumented Technical Decisions',
  'Unresolved Issues',
  'Unclear Ownership',
  'Missing Technical Context',
  'Architecture Knowledge Gaps',
  'Missing Dependencies Information',
  'Incomplete Handover Information',
  'Missing Operational Knowledge',
  'Unverified Project Assumptions',
];

const SEVERITY_RANK: Record<GapSeverity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

const ANALYSIS_STAGES = [
  'Stage 1 — Inventory: Loading project sources and excluding other projects',
  'Stage 2 — Normalization: Grouping tasks, decisions, risks, and technical refs',
  'Stage 3 — Knowledge Analysis: Running cross-source Gemini gap detection',
  'Stage 4 — Severity Classification: Validating impact and evidence citations',
  'Stage 5 — Deduplication: Merging findings while preserving human decisions',
];

function GapSeverityTag({ severity }: { severity: GapSeverity }) {
  const styles: Record<GapSeverity, string> = {
    Critical: 'bg-red-50 text-red-800 border-red-200',
    High: 'bg-orange-50 text-orange-800 border-orange-200',
    Medium: 'bg-amber-50 text-amber-800 border-amber-200',
    Low: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${styles[severity]}`}
    >
      {severity === 'Critical' && <ShieldAlert className="w-3 h-3" />}
      {severity}
    </span>
  );
}

function GapStatusTag({ status }: { status: GapStatus }) {
  const styles: Record<GapStatus, string> = {
    Open: 'bg-red-50 text-red-800 border-red-200',
    'In Progress': 'bg-blue-50 text-blue-800 border-blue-200',
    Resolved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    'Not a Gap': 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${styles[status]}`}
    >
      {status === 'Resolved' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
      {status}
    </span>
  );
}

function ConfidenceTag({ confidence }: { confidence: GapConfidence }) {
  const styles: Record<GapConfidence, string> = {
    Confirmed: 'text-slate-900 font-medium',
    Possible: 'text-slate-600',
    'Requires Verification': 'text-amber-800 font-medium',
  };
  return <span className={`text-xs whitespace-nowrap ${styles[confidence]}`}>{confidence}</span>;
}

export function KnowledgeGapsScreen({
  projects,
  selectedProjectId,
  onSelectProject,
  session,
  onInspectSource,
  onNavigate,
}: {
  projects: ProjectSummaryDTO[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  session: UserSession;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const [data, setData] = useState<KnowledgeGapsResponse | null>(null);
  const [historyRuns, setHistoryRuns] = useState<GapAnalysisRun[]>([]);
  const [activeTab, setActiveTab] = useState<'findings' | 'history'>('findings');
  const [showInventory, setShowInventory] = useState(true);

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & Sorting
  const [categoryFilter, setCategoryFilter] = useState<'All' | GapCategory>('All');
  const [severityFilter, setSeverityFilter] = useState<'All' | GapSeverity>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | GapStatus>('All');
  const [ownerFilter, setOwnerFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'severity' | 'updatedAt' | 'createdAt'>('severity');

  // Detail Drawer & Modal Dialogs
  const [selectedGapId, setSelectedGapId] = useState<string | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignMode, setAssignMode] = useState<'member' | 'custom'>('member');
  const [assignSelectedMember, setAssignSelectedMember] = useState('');
  const [assignCustomName, setAssignCustomName] = useState('');

  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [reviewModal, setReviewModal] = useState<{
    targetStatus: 'Resolved' | 'Not a Gap';
    reason: string;
    confirmed: boolean;
  } | null>(null);

  const [actionBusy, setActionBusy] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [gapsRes, runsRes] = await Promise.all([
        fetchKnowledgeGaps(selectedProjectId),
        fetchKnowledgeGapHistory(selectedProjectId),
      ]);
      setData(gapsRes);
      setHistoryRuns(runsRes);
      if (gapsRes.projectMembers.length > 0) {
        setAssignSelectedMember(gapsRes.projectMembers[0].name);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load knowledge gaps.');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    setSelectedGapId(null);
    setSuccessMsg(null);
    loadData();
  }, [loadData]);

  const includedSourcesCount = useMemo(
    () => (data?.sourceInventory ?? []).filter((s) => s.status === 'included').length,
    [data],
  );

  const ownerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const g of data?.gaps ?? []) {
      if (g.assignedOwner) names.add(g.assignedOwner);
    }
    return Array.from(names).sort();
  }, [data]);

  const filteredAndSortedGaps = useMemo(() => {
    const list = (data?.gaps ?? []).filter((g) => {
      if (categoryFilter !== 'All' && g.category !== categoryFilter) return false;
      if (severityFilter !== 'All' && g.severity !== severityFilter) return false;
      if (statusFilter !== 'All' && g.status !== statusFilter) return false;
      if (ownerFilter === 'Unassigned' && g.assignedOwner !== null) return false;
      if (ownerFilter !== 'All' && ownerFilter !== 'Unassigned' && g.assignedOwner !== ownerFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchEvidence = g.evidenceReferences.some(
          (e) =>
            e.fileName.toLowerCase().includes(q) ||
            e.excerpt.toLowerCase().includes(q) ||
            (e.recordId ?? '').toLowerCase().includes(q),
        );
        return (
          g.id.toLowerCase().includes(q) ||
          g.title.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q) ||
          g.category.toLowerCase().includes(q) ||
          matchEvidence
        );
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'severity') {
        const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (diff !== 0) return diff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sortBy === 'createdAt') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [data, categoryFilter, severityFilter, statusFilter, ownerFilter, searchQuery, sortBy]);

  const selectedGap: KnowledgeGap | null = useMemo(() => {
    if (!selectedGapId || !data) return null;
    return data.gaps.find((g) => g.id === selectedGapId) ?? null;
  }, [selectedGapId, data]);

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await runKnowledgeGapAnalysisApi(selectedProjectId);
      await loadData();
      setActiveTab('findings');
      setSuccessMsg(
        `Analysis completed (${result.run.sourcesAnalyzedCount} sources analyzed): ${result.run.findingsCreated} created, ${result.run.findingsUpdated} existing updated.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Knowledge gap analysis failed.');
      // Reload history so the failed run record appears accurately
      try {
        const runs = await fetchKnowledgeGapHistory(selectedProjectId);
        setHistoryRuns(runs);
      } catch {
        // Ignore secondary history fetch errors
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGap) return;
    const owner =
      assignMode === 'member' ? assignSelectedMember.trim() : assignCustomName.trim();
    if (!owner) {
      setDrawerError('Please select or enter an owner name.');
      return;
    }

    setActionBusy(true);
    setDrawerError(null);
    try {
      await assignKnowledgeGapOwner(selectedGap.id, {
        projectId: selectedProjectId,
        owner,
        actor: session.name,
      });
      await loadData();
      setShowAssignDialog(false);
      setAssignCustomName('');
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to assign owner.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGap) return;
    if (!noteText.trim()) {
      setDrawerError('Please enter a review note.');
      return;
    }

    setActionBusy(true);
    setDrawerError(null);
    try {
      await addKnowledgeGapNote(selectedGap.id, {
        projectId: selectedProjectId,
        author: session.name,
        authorRole: session.roleLabel,
        content: noteText.trim(),
      });
      await loadData();
      setShowNoteDialog(false);
      setNoteText('');
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to add note.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkInProgress = async () => {
    if (!selectedGap) return;
    setActionBusy(true);
    setDrawerError(null);
    try {
      await reviewKnowledgeGap(selectedGap.id, {
        projectId: selectedProjectId,
        status: 'In Progress',
        actor: session.name,
      });
      await loadData();
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReviewModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGap || !reviewModal) return;

    if (reviewModal.targetStatus === 'Resolved' && !reviewModal.confirmed) {
      setDrawerError('Please check the confirmation box before resolving this gap.');
      return;
    }
    if (!reviewModal.reason.trim()) {
      setDrawerError('A human explanation is required.');
      return;
    }

    setActionBusy(true);
    setDrawerError(null);
    try {
      await reviewKnowledgeGap(selectedGap.id, {
        projectId: selectedProjectId,
        status: reviewModal.targetStatus,
        reason: reviewModal.reason.trim(),
        actor: session.name,
        confirmed: reviewModal.targetStatus === 'Resolved' ? reviewModal.confirmed : undefined,
      });
      await loadData();
      setReviewModal(null);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Failed to record review decision.');
    } finally {
      setActionBusy(false);
    }
  };

  const latestRunStatus = analyzing
    ? 'Running'
    : data?.latestRun?.status === 'completed'
      ? 'Completed'
      : data?.latestRun?.status === 'failed'
        ? 'Failed'
        : 'Not Analyzed';

  const summary = data?.summary ?? {
    total: 0,
    open: 0,
    inProgress: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    resolved: 0,
    notAGap: 0,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Knowledge Gaps</h1>
            <p className="text-sm text-slate-600 mt-1">
              Discover missing project knowledge before handover.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Select project for Knowledge Gap analysis"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              disabled={analyzing}
              className="px-3 py-2 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={analyzing || loading || includedSourcesCount === 0}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Running Analysis...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Run Analysis
                </>
              )}
            </button>
          </div>
        </div>

        {/* Metadata Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Last Analyzed:{' '}
              <span className="font-mono text-slate-800 tabular-nums">
                {data?.lastAnalyzedAt ? formatDateTime(data.lastAnalyzedAt) : 'Never'}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Analysis Status:{' '}
              <span
                className={`font-semibold ${
                  latestRunStatus === 'Completed'
                    ? 'text-emerald-700'
                    : latestRunStatus === 'Failed'
                      ? 'text-red-700'
                      : latestRunStatus === 'Running'
                        ? 'text-blue-700'
                        : 'text-slate-700'
                }`}
              >
                {latestRunStatus}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {includedSourcesCount} usable source(s) indexed
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowInventory((v) => !v)}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            {showInventory ? 'Hide Source Inventory' : 'Show Source Inventory'}
          </button>
        </div>
      </div>

      {/* Real Indeterminate Stage Indicator (no fake percentages) */}
      {analyzing && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-blue-700 animate-spin shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">
                Knowledge Gap Detection Pipeline Running (Indeterminate Server Analysis)
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Analyzing {includedSourcesCount} project source(s)
            </span>
          </div>
          <div className="grid sm:grid-cols-5 gap-2">
            {ANALYSIS_STAGES.map((stageLabel) => (
              <div
                key={stageLabel}
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700"
              >
                {stageLabel}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Analysis Error</p>
            <p className="mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="font-medium">{successMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Stage 1 Source Inventory Panel */}
      {showInventory && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Project Source Inventory ({data?.sourceInventory.length ?? 0})
              </h2>
              <p className="text-xs text-slate-500">
                Only sources belonging to this project are included in gap detection.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('activity')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Manage Sources →
            </button>
          </div>

          {!data || data.sourceInventory.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                No usable sources available for this project
              </p>
              <p className="text-xs text-slate-600">
                Upload CSV trackers, Docs, PDFs, or GitHub activity in Project Activity before running gap analysis.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Source Title</th>
                    <th className="px-4 py-2.5 font-semibold">File / Reference</th>
                    <th className="px-4 py-2.5 font-semibold">Type</th>
                    <th className="px-4 py-2.5 font-semibold">Records</th>
                    <th className="px-4 py-2.5 font-semibold">Last Synced / Added</th>
                    <th className="px-5 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.sourceInventory.map((item) => (
                    <tr key={item.sourceId} className="hover:bg-slate-50/70">
                      <td className="px-5 py-2.5 font-medium text-slate-900">{item.title}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{item.fileName}</td>
                      <td className="px-4 py-2.5 uppercase font-mono text-slate-600">{item.kind}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-700">
                        {item.recordCount}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">
                        {formatDateTime(item.addedAt)}
                      </td>
                      <td className="px-5 py-2.5">
                        {item.status === 'included' ? (
                          <span className="text-emerald-700 font-medium">Included</span>
                        ) : (
                          <span className="text-amber-700 font-medium">
                            Skipped ({item.skipReason})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 6 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Total Gaps</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums font-mono">
            {summary.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Open</p>
          <p className="text-2xl font-bold text-red-700 mt-1 tabular-nums font-mono">
            {summary.open}
          </p>
          {summary.inProgress > 0 && (
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {summary.inProgress} In Progress
            </p>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Critical</p>
          <p className="text-2xl font-bold text-red-800 mt-1 tabular-nums font-mono">
            {summary.critical}
          </p>
          {summary.high > 0 && (
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{summary.high} High</p>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Medium</p>
          <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums font-mono">
            {summary.medium}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Low</p>
          <p className="text-2xl font-bold text-slate-700 mt-1 tabular-nums font-mono">
            {summary.low}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Resolved</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums font-mono">
            {summary.resolved}
          </p>
          {summary.notAGap > 0 && (
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {summary.notAGap} Not a Gap
            </p>
          )}
        </div>
      </div>

      {/* Findings vs Analysis History Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('findings')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'findings'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Gap Findings ({data?.gaps.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            Analysis History ({historyRuns.length})
          </button>
        </div>
      </div>

      {activeTab === 'findings' ? (
        <div className="space-y-4">
          {/* Filters & Sorting Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search gap ID, title, or evidence..."
                aria-label="Search knowledge gaps"
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'All' | GapCategory)}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as 'All' | GapSeverity)}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            >
              <option value="All">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | GapStatus)}
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
            >
              <option value="All">All Statuses</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Not a Gap">Not a Gap</option>
            </select>

            <div className="flex items-center gap-2">
              <select
                aria-label="Filter by owner"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="w-1/2 px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="All">All Owners</option>
                <option value="Unassigned">Unassigned</option>
                {ownerOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>

              <select
                aria-label="Sort gaps"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as 'severity' | 'updatedAt' | 'createdAt')
                }
                className="w-1/2 px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
              >
                <option value="severity">Sort: Severity</option>
                <option value="updatedAt">Sort: Updated</option>
                <option value="createdAt">Sort: Created</option>
              </select>
            </div>
          </div>

          {/* Gap Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (data?.gaps.length ?? 0) === 0 ? (
              <div className="p-12 text-center space-y-3">
                <FileSearch className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-semibold text-slate-900">
                  {includedSourcesCount === 0
                    ? 'No Usable Sources Found for Analysis'
                    : 'No Knowledge Gap Analysis Run Yet'}
                </h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  {includedSourcesCount === 0
                    ? 'Add CSV tasks, docs, PDFs, or GitHub activity to this project first before running gap detection.'
                    : 'Click "Run Analysis" above to inspect all project sources and uncover missing documentation, unclear ownership, and unresolved blockers.'}
                </p>
              </div>
            ) : filteredAndSortedGaps.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No knowledge gaps match your current filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">Gap ID</th>
                      <th className="px-4 py-3">Gap Title</th>
                      <th className="px-4 py-3 whitespace-nowrap">Category</th>
                      <th className="px-4 py-3 whitespace-nowrap">Severity</th>
                      <th className="px-4 py-3 whitespace-nowrap">Confidence</th>
                      <th className="px-4 py-3 whitespace-nowrap">Owner</th>
                      <th className="px-4 py-3 whitespace-nowrap">Status</th>
                      <th className="px-4 py-3 whitespace-nowrap">Updated At</th>
                      <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredAndSortedGaps.map((gap) => (
                      <tr
                        key={gap.id}
                        onClick={() => {
                          setDrawerError(null);
                          setSelectedGapId(gap.id);
                        }}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-blue-700 whitespace-nowrap">
                          {gap.id}
                        </td>
                        <td className="px-4 py-3.5 max-w-sm">
                          <p className="font-semibold text-slate-900 text-sm">{gap.title}</p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {gap.evidenceReferences.length} evidence ref(s) ·{' '}
                            {gap.reviewNotes.length} note(s)
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                          {gap.category}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <GapSeverityTag severity={gap.severity} />
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <ConfidenceTag confidence={gap.confidence} />
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                          {gap.assignedOwner || (
                            <span className="text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <GapStatusTag status={gap.status} />
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                          {formatDateTime(gap.updatedAt)}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDrawerError(null);
                              setSelectedGapId(gap.id);
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md inline-flex items-center gap-1"
                          >
                            Review
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Analysis History Table */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {historyRuns.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No analysis runs recorded for this project yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Run ID</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Project</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Start Time</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Completion Time</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Sources</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Created</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Updated</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 font-semibold">Errors or Warnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {historyRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-50/70 align-top">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                        {run.id}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {projects.find((p) => p.id === run.projectId)?.name ?? run.projectId}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatDateTime(run.startedAt)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {run.completedAt ? formatDateTime(run.completedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                        {run.sourcesAnalyzedCount}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-emerald-700 font-semibold">
                        +{run.findingsCreated}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-blue-700 font-semibold">
                        {run.findingsUpdated}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {run.status === 'completed' ? (
                          <span className="text-emerald-700 font-semibold">Completed</span>
                        ) : run.status === 'failed' ? (
                          <span className="text-red-700 font-semibold">Failed</span>
                        ) : (
                          <span className="text-blue-700 font-semibold">Running</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        {run.error ? (
                          <span className="text-red-700 font-medium">{run.error}</span>
                        ) : run.warnings.length > 0 ? (
                          <span>{run.warnings.join('; ')}</span>
                        ) : (
                          <span className="text-slate-400">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Right-Side Gap Detail Drawer */}
      {selectedGap && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-[1px]"
          onClick={() => setSelectedGapId(null)}
        >
          <div
            className="w-full max-w-2xl bg-white h-full border-l border-slate-200 flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-blue-700">
                    {selectedGap.id}
                  </span>
                  <GapSeverityTag severity={selectedGap.severity} />
                  <GapStatusTag status={selectedGap.status} />
                  <ConfidenceTag confidence={selectedGap.confidence} />
                </div>
                <h2 className="text-lg font-bold text-slate-900 leading-snug">
                  {selectedGap.title}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedGap.category} · Run {selectedGap.lastSeenRunId}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedGapId(null)}
                className="p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                aria-label="Close gap detail drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Toolbar */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  setDrawerError(null);
                  setShowAssignDialog(true);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5 text-slate-500" />
                Assign Owner
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  setDrawerError(null);
                  setShowNoteDialog(true);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 text-slate-500" />
                Add Note
              </button>
              {selectedGap.status !== 'In Progress' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleMarkInProgress}
                  className="px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Mark In Progress
                </button>
              )}
              {selectedGap.status !== 'Resolved' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    setDrawerError(null);
                    setReviewModal({ targetStatus: 'Resolved', reason: '', confirmed: false });
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark Resolved
                </button>
              )}
              {selectedGap.status !== 'Not a Gap' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    setDrawerError(null);
                    setReviewModal({ targetStatus: 'Not a Gap', reason: '', confirmed: true });
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />
                  Mark Not a Gap
                </button>
              )}
            </div>

            {drawerError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {drawerError}
              </div>
            )}

            {/* 7 Required Drawer Sections */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* 1. Gap Overview */}
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-500">1. Gap Overview</h3>
                <p className="text-sm text-slate-800 leading-relaxed">{selectedGap.description}</p>
                {selectedGap.resolutionReason && (
                  <div className="mt-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                    <span className="font-semibold">
                      Resolved by {selectedGap.resolvedBy}:
                    </span>{' '}
                    {selectedGap.resolutionReason}
                  </div>
                )}
                {selectedGap.dismissalReason && (
                  <div className="mt-2 p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800">
                    <span className="font-semibold">
                      Dismissed as Not a Gap by {selectedGap.dismissedBy}:
                    </span>{' '}
                    {selectedGap.dismissalReason}
                  </div>
                )}
              </section>

              {/* 2. Why This Gap Was Detected */}
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-500">
                  2. Why This Gap Was Detected
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {selectedGap.reasonForDetection}
                </p>
              </section>

              {/* 3. Evidence and Related Sources */}
              <section className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-500">
                  3. Evidence and Related Sources ({selectedGap.evidenceReferences.length})
                </h3>
                <div className="space-y-2.5">
                  {selectedGap.evidenceReferences.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs">
                          <span className="font-semibold text-slate-900">{ev.sourceTitle}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="font-mono text-slate-600">{ev.fileName}</span>
                          {ev.recordId && (
                            <>
                              <span className="text-slate-400 mx-1.5">·</span>
                              <span className="font-mono text-blue-700">{ev.recordId}</span>
                            </>
                          )}
                          {ev.locationReference && (
                            <>
                              <span className="text-slate-400 mx-1.5">·</span>
                              <span className="text-slate-600">{ev.locationReference}</span>
                            </>
                          )}
                        </div>
                        {ev.sourceId !== 'none' && ev.sourceType !== 'handover_pack' && (
                          <button
                            type="button"
                            onClick={() =>
                              onInspectSource(ev.sourceId, `${ev.fileName}: ${ev.excerpt}`)
                            }
                            className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded transition-colors whitespace-nowrap"
                          >
                            View Evidence
                          </button>
                        )}
                      </div>

                      <blockquote className="p-2.5 rounded bg-white border border-slate-200 font-mono text-xs text-slate-800">
                        {ev.excerpt}
                      </blockquote>

                      <p className="text-xs text-slate-600">{ev.relevanceExplanation}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* 4. Suggested Action */}
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-500">4. Suggested Action</h3>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {selectedGap.suggestedAction}
                </p>
              </section>

              {/* 5. Assigned Owner */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500">5. Assigned Owner</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerError(null);
                      setShowAssignDialog(true);
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Change Owner
                  </button>
                </div>
                <p className="text-sm font-medium text-slate-900">
                  {selectedGap.assignedOwner || 'Unassigned'}
                  {selectedGap.humanOwnerLocked && (
                    <span className="text-xs font-normal text-slate-500 ml-2">
                      (Locked across re-analysis)
                    </span>
                  )}
                </p>
              </section>

              {/* 6. Human Review Notes */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500">
                    6. Human Review Notes ({selectedGap.reviewNotes.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerError(null);
                      setShowNoteDialog(true);
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    + Add Note
                  </button>
                </div>
                {selectedGap.reviewNotes.length === 0 ? (
                  <p className="text-xs text-slate-500">No human review notes added yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedGap.reviewNotes.map((note) => (
                      <div
                        key={note.id}
                        className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">
                            {note.author}{' '}
                            <span className="font-normal text-slate-500">· {note.authorRole}</span>
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {formatDateTime(note.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 7. Activity and Review History */}
              <section className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-500">
                  7. Activity and Review History ({selectedGap.activityHistory.length})
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {selectedGap.activityHistory.map((act) => (
                    <div key={act.id} className="px-3.5 py-2.5 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{act.actor}</span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {formatDateTime(act.timestamp)}
                        </span>
                      </div>
                      <p className="text-slate-600">{act.details}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Assign Owner Dialog */}
      {showAssignDialog && selectedGap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setShowAssignDialog(false)}
        >
          <form
            onSubmit={handleAssignSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Assign Owner ({selectedGap.id})
              </h3>
              <button
                type="button"
                onClick={() => setShowAssignDialog(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setAssignMode('member')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                  assignMode === 'member' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Project Member
              </button>
              <button
                type="button"
                onClick={() => setAssignMode('custom')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                  assignMode === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Enter Owner Name
              </button>
            </div>

            {assignMode === 'member' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Existing Project Contributors
                </label>
                <select
                  value={assignSelectedMember}
                  onChange={(e) => setAssignSelectedMember(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {(data?.projectMembers ?? []).map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Owner Name
                </label>
                <input
                  type="text"
                  value={assignCustomName}
                  onChange={(e) => setAssignCustomName(e.target.value)}
                  placeholder="Enter full name..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAssignDialog(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
              >
                {actionBusy ? 'Saving...' : 'Save Owner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Note Dialog */}
      {showNoteDialog && selectedGap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setShowNoteDialog(false)}
        >
          <form
            onSubmit={handleAddNoteSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Add Review Note ({selectedGap.id})
              </h3>
              <button
                type="button"
                onClick={() => setShowNoteDialog(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Note (recorded as {session.name})
              </label>
              <textarea
                rows={4}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Document context, verification status, or follow-up details..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNoteDialog(false)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
              >
                {actionBusy ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resolve / Not a Gap Confirmation Modal */}
      {reviewModal && selectedGap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setReviewModal(null)}
        >
          <form
            onSubmit={handleReviewModalSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {reviewModal.targetStatus === 'Resolved'
                  ? `Confirm Resolution (${selectedGap.id})`
                  : `Dismiss as Not a Gap (${selectedGap.id})`}
              </h3>
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {reviewModal.targetStatus === 'Resolved'
                  ? 'Resolution Explanation (Required)'
                  : 'Reason for Marking Not a Gap (Required — Record Retained for Audit)'}
              </label>
              <textarea
                rows={3}
                value={reviewModal.reason}
                onChange={(e) =>
                  setReviewModal((prev) => (prev ? { ...prev, reason: e.target.value } : null))
                }
                placeholder="Explain where this knowledge was documented or why it is not applicable..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                required
              />
            </div>

            {reviewModal.targetStatus === 'Resolved' && (
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reviewModal.confirmed}
                  onChange={(e) =>
                    setReviewModal((prev) =>
                      prev ? { ...prev, confirmed: e.target.checked } : null,
                    )
                  }
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  I confirm this knowledge gap has been human-verified and resolved for handover.
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className={`px-4 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50 ${
                  reviewModal.targetStatus === 'Resolved'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-slate-800 hover:bg-slate-900'
                }`}
              >
                {actionBusy
                  ? 'Saving...'
                  : reviewModal.targetStatus === 'Resolved'
                    ? 'Confirm & Mark Resolved'
                    : 'Confirm Not a Gap'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
