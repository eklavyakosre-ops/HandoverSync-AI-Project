import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  FilePlus2,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ActivitySource, ProjectSummaryDTO, SourceKind } from '../types';
import {
  SourceKindIcon,
  formatDateTime,
  sourceKindLabel,
} from './StatusPrimitives';

function CsvPreviewTable({ content }: { content: string }) {
  const rows = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));

  if (rows.length === 0) return null;
  const headers = rows[0];
  const body = rows.slice(1);

  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {body.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-slate-50">
              {headers.map((_, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-slate-700 align-top">
                  {row[cIdx] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GithubPreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content) as {
      repository?: string;
      branch?: string;
      issues?: Array<{ number: number; title: string; state: string; priority?: string; deadline?: string; body?: string }>;
      pullRequests?: Array<{ number: number; title: string; state: string; reviewStatus?: string }>;
    };
    return (
      <div className="space-y-3 text-xs">
        {parsed.repository && (
          <p className="font-mono text-slate-600">
            Repo: <span className="text-slate-900 font-medium">{parsed.repository}</span>
            {parsed.branch ? ` · Branch: ${parsed.branch}` : ''}
          </p>
        )}
        {parsed.issues && parsed.issues.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold text-slate-800">Issues</p>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
              {parsed.issues.map((issue) => (
                <div key={issue.number} className="p-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-blue-700">
                      Issue #{issue.number}
                    </span>
                    <span className="font-medium text-slate-900">{issue.title}</span>
                    <span className="text-slate-500">
                      · {issue.state} {issue.priority ? `· ${issue.priority}` : ''}{' '}
                      {issue.deadline ? `· Due ${issue.deadline}` : ''}
                    </span>
                  </div>
                  {issue.body && <p className="text-slate-600 leading-relaxed">{issue.body}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
        {parsed.pullRequests && parsed.pullRequests.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold text-slate-800">Pull Requests</p>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
              {parsed.pullRequests.map((pr) => (
                <div key={pr.number} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold text-slate-700 mr-2">
                      PR #{pr.number}
                    </span>
                    <span className="font-medium text-slate-900">{pr.title}</span>
                  </div>
                  <span className="text-slate-500">
                    {pr.state} {pr.reviewStatus ? `· ${pr.reviewStatus}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  } catch {
    return (
      <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap">
        {content}
      </pre>
    );
  }
}

export function ProjectActivityScreen({
  project,
  sources,
  selectedSourceIds,
  onToggleSource,
  onAddSource,
  onDeleteSource,
  onProceedToGenerate,
}: {
  project: ProjectSummaryDTO;
  sources: ActivitySource[];
  selectedSourceIds: string[];
  onToggleSource: (sourceId: string) => void;
  onAddSource: (payload: {
    title: string;
    kind: SourceKind;
    fileName: string;
    content?: string;
    base64Data?: string;
    mimeType?: string;
  }) => Promise<void>;
  onDeleteSource: (sourceId: string) => Promise<void>;
  onProceedToGenerate: () => void;
}) {
  const [filterKind, setFilterKind] = useState<'all' | SourceKind>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(sources[0]?.id ?? null);
  const [showAddPanel, setShowAddPanel] = useState(false);

  // Add source form state
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<SourceKind>('docs');
  const [newFileName, setNewFileName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newBase64, setNewBase64] = useState<string | undefined>(undefined);
  const [newMimeType, setNewMimeType] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredSources = useMemo(() => {
    return sources.filter((src) => {
      if (filterKind !== 'all' && src.kind !== filterKind) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          src.title.toLowerCase().includes(q) ||
          src.fileName.toLowerCase().includes(q) ||
          src.content.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sources, filterKind, searchQuery]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setNewFileName(file.name);
    if (!newTitle.trim()) {
      setNewTitle(file.name.replace(/\.[^.]+$/, ''));
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf' || file.type === 'application/pdf') {
      setNewKind('pdf');
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        setNewBase64(base64);
        setNewMimeType('application/pdf');
        setNewContent(`Uploaded PDF Document: ${file.name} (${Math.round(file.size / 1024)} KB)`);
      };
      reader.readAsDataURL(file);
      return;
    }

    if (ext === 'csv') setNewKind('csv');
    else if (ext === 'json') setNewKind('github');
    else setNewKind('docs');

    const reader = new FileReader();
    reader.onload = () => {
      setNewBase64(undefined);
      setNewMimeType(undefined);
      setNewContent(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onAddSource({
        title: newTitle.trim() || newFileName.trim() || 'Additional Handover Note',
        kind: newKind,
        fileName:
          newFileName.trim() ||
          (newKind === 'csv'
            ? 'custom_tasks.csv'
            : newKind === 'github'
              ? 'github_export.json'
              : 'handover_note.txt'),
        content: newContent,
        base64Data: newBase64,
        mimeType: newMimeType,
      });
      setNewTitle('');
      setNewFileName('');
      setNewContent('');
      setNewBase64(undefined);
      setNewMimeType(undefined);
      setShowAddPanel(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add source.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-700">
            {project.code} · {project.department}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Project Activity & Multi-Source Aggregation
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Inspect aggregated CSV trackers, GitHub activity, and runbook docs, or upload PDF/CSV/TXT files before running AI extraction.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowAddPanel((v) => !v)}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FilePlus2 className="w-4 h-4 text-slate-500" />
            {showAddPanel ? 'Close Upload Panel' : 'Add / Upload Source'}
          </button>
          <button
            type="button"
            onClick={onProceedToGenerate}
            disabled={selectedSourceIds.length === 0}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate Handover ({selectedSourceIds.length})
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Add / Upload Source Form */}
      {showAddPanel && (
        <form
          onSubmit={handleAddSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Ingest Additional Project Source
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Upload a local CSV, TXT, Markdown, JSON, or PDF file, or paste activity records directly.
              </p>
            </div>
            <label className="px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap self-start">
              <Upload className="w-3.5 h-3.5" />
              Choose File (PDF / CSV / TXT / JSON)
              <input
                type="file"
                accept=".csv,.txt,.md,.json,.pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Source Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g., Incident Postmortem Notes"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Source Type</label>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as SourceKind)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-blue-700"
              >
                <option value="csv">CSV Tasks</option>
                <option value="docs">Runbook / Docs / Notes</option>
                <option value="github">GitHub Activity JSON</option>
                <option value="pdf">PDF Document</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Filename</label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="e.g., release_checklist.txt"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {newKind === 'pdf' ? 'PDF Status' : 'Source Content'}
            </label>
            <textarea
              rows={5}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              readOnly={newKind === 'pdf' && Boolean(newBase64)}
              placeholder="Paste CSV rows, GitHub issue details, or engineering handover notes..."
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddPanel(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg"
            >
              {submitting ? 'Saving Source...' : 'Save to Project Ledger'}
            </button>
          </div>
        </form>
      )}

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {(
            [
              { id: 'all', label: `All Sources (${sources.length})` },
              {
                id: 'csv',
                label: `CSV (${sources.filter((s) => s.kind === 'csv').length})`,
              },
              {
                id: 'github',
                label: `GitHub (${sources.filter((s) => s.kind === 'github').length})`,
              },
              {
                id: 'docs',
                label: `Docs / PDF (${sources.filter((s) => s.kind === 'docs' || s.kind === 'pdf').length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterKind(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filterKind === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter activity sources..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      {/* Aggregated Source Feed */}
      <div className="space-y-4">
        {filteredSources.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">No matching activity sources</p>
            <p className="text-xs text-slate-600">
              Try clearing your filter or upload a new CSV, TXT, or PDF source above.
            </p>
          </div>
        ) : (
          filteredSources.map((src) => {
            const isSelected = selectedSourceIds.includes(src.id);
            const isExpanded = expandedId === src.id;

            return (
              <div
                key={src.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => onToggleSource(src.id)}
                      className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-blue-700 border-blue-700 text-white'
                          : 'bg-white border-slate-300 hover:border-slate-400'
                      }`}
                      aria-label={`Include ${src.title} in AI generation`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </button>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SourceKindIcon kind={src.kind} className="w-4 h-4 text-blue-700 shrink-0" />
                        <h3 className="text-sm font-semibold text-slate-900">{src.title}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{sourceKindLabel(src.kind)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-700">{src.fileName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{src.recordCount} records</span>
                        <span aria-hidden="true">·</span>
                        <span>Added by {src.addedBy}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatDateTime(src.addedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : src.id)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
                    >
                      {isExpanded ? 'Hide Contents' : 'Inspect Data'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSource(src.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors"
                      title="Remove source"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 pt-3 border-t border-slate-100 bg-slate-50/50">
                    {src.kind === 'csv' ? (
                      <CsvPreviewTable content={src.content} />
                    ) : src.kind === 'github' ? (
                      <GithubPreview content={src.content} />
                    ) : (
                      <pre className="p-4 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                        {src.content}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
