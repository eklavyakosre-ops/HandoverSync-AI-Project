import React from 'react';
import { Download, Eye, History } from 'lucide-react';
import type { HistoryEntry } from '../lib/api';
import { buildHandoverMarkdown, triggerFileDownload } from '../lib/api';
import { HandoverStatusTag, formatDateTime } from './StatusPrimitives';

export function HandoverHistoryScreen({
  history,
  loading,
  onInspectSnapshot,
}: {
  history: HistoryEntry[];
  loading: boolean;
  onInspectSnapshot: (projectId: string, handoverId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Handover History & Audit Ledger
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Versioned archive of every AI-generated handover pack, human reviewer edits, and final approval timestamps.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <History className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-900">No handover packs recorded yet</p>
            <p className="text-xs text-slate-600">
              Generate and approve a handover pack to create an immutable audit entry.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3.5">Project</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">Version</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">Status</th>
                  <th className="px-4 py-3.5 whitespace-nowrap">Generated</th>
                  <th className="px-4 py-3.5">Human Verification</th>
                  <th className="px-5 py-3.5 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {history.map(({ handover, projectName, projectCode }) => (
                  <tr key={handover.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-5 py-4">
                      <p className="text-xs font-mono text-slate-500">{projectCode}</p>
                      <p className="font-semibold text-slate-900">{projectName}</p>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap tabular-nums">
                      v{handover.version}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <HandoverStatusTag status={handover.status} />
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                      {formatDateTime(handover.generatedAt)}
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-700 max-w-sm">
                      {handover.humanReview ? (
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900">
                            {handover.humanReview.reviewerName} ·{' '}
                            <span className="text-slate-500 font-normal">
                              {formatDateTime(handover.humanReview.reviewedAt)}
                            </span>
                          </p>
                          <p className="text-slate-600 line-clamp-2">
                            “{handover.humanReview.comments}”
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Pending reviewer sign-off</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectSnapshot(handover.projectId, handover.id)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Open Pack
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            triggerFileDownload(
                              `${projectCode.toLowerCase()}-handover-v${handover.version}.md`,
                              buildHandoverMarkdown(handover, projectName),
                              'text/markdown;charset=utf-8',
                            )
                          }
                          className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-md bg-white"
                          title="Download Markdown"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
