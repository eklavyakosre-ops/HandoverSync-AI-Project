import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Link2,
  ShieldAlert,
  X,
} from 'lucide-react';
import type {
  ActivitySource,
  HandoverApprovalStatus,
  SourceKind,
  TaskPriority,
  TaskStatus,
} from '../types';

export function formatShortDate(isoOrDate: string): string {
  if (!isoOrDate) return 'TBD';
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) return isoOrDate;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SourceKindIcon({ kind, className = 'w-4 h-4' }: { kind: SourceKind; className?: string }) {
  if (kind === 'csv') return <FileSpreadsheet className={className} />;
  if (kind === 'github') return <GitBranch className={className} />;
  return <FileText className={className} />;
}

export function sourceKindLabel(kind: SourceKind): string {
  if (kind === 'csv') return 'CSV Tasks';
  if (kind === 'github') return 'GitHub Activity';
  if (kind === 'pdf') return 'PDF Document';
  return 'Runbook / Docs';
}

export function HandoverStatusTag({ status }: { status: HandoverApprovalStatus | 'Not Generated' }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        Approved
      </span>
    );
  }
  if (status === 'changes_requested') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded bg-red-50 text-red-800 border border-red-200 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
        Changes Requested
      </span>
    );
  }
  if (status === 'in_review') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap shrink-0">
        <Clock className="w-3.5 h-3.5 text-amber-600" />
        Awaiting Human Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap shrink-0">
      <Clock className="w-3.5 h-3.5 text-slate-500" />
      Drafting Sources
    </span>
  );
}

export function PriorityIndicator({ priority }: { priority: TaskPriority }) {
  const styles: Record<TaskPriority, string> = {
    Critical: 'bg-red-50 text-red-800 border-red-200',
    High: 'bg-amber-50 text-amber-800 border-amber-200',
    Medium: 'bg-blue-50 text-blue-800 border-blue-200',
    Low: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${styles[priority]}`}
    >
      {priority === 'Critical' && <ShieldAlert className="w-3 h-3" />}
      {priority}
    </span>
  );
}

export function TaskStatusIndicator({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    Blocked: 'bg-red-50 text-red-800 border-red-200',
    'At Risk': 'bg-amber-50 text-amber-800 border-amber-200',
    'In Progress': 'bg-blue-50 text-blue-800 border-blue-200',
    'Not Started': 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export function SourceCitationButton({
  evidence,
  sourceId,
  onInspect,
}: {
  evidence: string;
  sourceId: string;
  onInspect: (sourceId: string, evidence: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(sourceId, evidence)}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-blue-700 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded transition-colors text-left max-w-full"
      title="Click to inspect raw source evidence"
    >
      <Link2 className="w-3.5 h-3.5 shrink-0 text-blue-600" />
      <span className="truncate">Source: {evidence}</span>
    </button>
  );
}

export function SourceEvidenceDrawer({
  source,
  evidenceLabel,
  onClose,
}: {
  source: ActivitySource | null;
  evidenceLabel: string | null;
  onClose: () => void;
}) {
  if (!source && !evidenceLabel) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0 pr-4">
            <p className="text-xs font-medium text-blue-700">Source Evidence Verification</p>
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {source ? source.title : 'Referenced Source'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close source inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {evidenceLabel && (
            <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs font-medium text-blue-900 mb-1">Cited Reference</p>
              <p className="text-sm font-mono text-blue-800">{evidenceLabel}</p>
            </div>
          )}

          {source ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                  <SourceKindIcon kind={source.kind} className="w-3.5 h-3.5 text-slate-500" />
                  {sourceKindLabel(source.kind)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{source.fileName}</span>
                <span aria-hidden="true">·</span>
                <span>Added by {source.addedBy}</span>
              </div>

              {source.kind === 'pdf' && source.base64Data ? (
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <p className="text-sm font-medium text-slate-900">
                    Uploaded PDF Binary ({source.fileName})
                  </p>
                  <p className="text-xs text-slate-600">
                    This PDF document was processed directly by the Gemini AI extraction pipeline.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-2">Raw Aggregated Content</p>
                  <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {source.content}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Original source record was removed or unavailable, but citation string was preserved.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
