import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  FileCode2,
  FolderGit2,
  Search,
} from 'lucide-react';
import type { HandoverPack, ImportantFile, ProjectSummaryDTO, ScreenId } from '../types';
import { SourceCitationButton } from './StatusPrimitives';

export function KeyFilesScreen({
  project,
  handover,
  onInspectSource,
  onNavigate,
}: {
  project: ProjectSummaryDTO;
  handover: HandoverPack | null;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const [kindFilter, setKindFilter] = useState<'All' | ImportantFile['kind']>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const files = handover?.importantFiles ?? [];
  const kinds = useMemo(
    () => Array.from(new Set(files.map((f) => f.kind))),
    [files],
  );

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      if (kindFilter !== 'All' && f.kind !== kindFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          f.name.toLowerCase().includes(q) ||
          f.locationOrUrl.toLowerCase().includes(q) ||
          f.purpose.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [files, kindFilter, searchQuery]);

  const handleCopyPath = (id: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  if (!handover) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto space-y-4">
        <FolderGit2 className="w-8 h-8 text-blue-700 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900">No Key Files Indexed Yet</h2>
        <p className="text-sm text-slate-600">
          Generate a Handover Pack to automatically extract repositories, runbooks, dashboards, and pull requests.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('generate')}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5"
        >
          Go to AI Generation
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-700">
            {project.code} · Pack v{handover.version}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Key Files, Repositories & Links
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Critical codebase entry points, Vault secret paths, dashboards, and runbooks referenced in this handover.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('review')}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
        >
          Next: Review & Approve
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setKindFilter('All')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              kindFilter === 'All'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({files.length})
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                kindFilter === k
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search paths, links, or purpose..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      {/* Directory Grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {filteredFiles.map((file) => (
          <div
            key={file.id}
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileCode2 className="w-4 h-4 text-blue-700 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{file.name}</h3>
                </div>
                <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
                  {file.kind}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="text-xs font-mono text-slate-800 truncate">
                  {file.locationOrUrl}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyPath(file.id, file.locationOrUrl)}
                    className="p-1 text-slate-500 hover:text-slate-900 rounded"
                    title="Copy path or URL"
                  >
                    {copiedId === file.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {file.locationOrUrl.startsWith('http') && (
                    <a
                      href={file.locationOrUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-blue-700 hover:text-blue-900 rounded"
                      title="Open external link"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">{file.purpose}</p>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Owner: {file.owner}</span>
              <SourceCitationButton
                evidence={file.sourceEvidence}
                sourceId={file.sourceId}
                onInspect={onInspectSource}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
