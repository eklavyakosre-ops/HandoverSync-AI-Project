import React, { useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import type {
  HandoverPack,
  PendingTask,
  ProjectSummaryDTO,
  ScreenId,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  PriorityIndicator,
  SourceCitationButton,
  formatShortDate,
} from './StatusPrimitives';

export function PendingWorkScreen({
  project,
  handover,
  onUpdateTaskStatus,
  onInspectSource,
  onNavigate,
}: {
  project: ProjectSummaryDTO;
  handover: HandoverPack | null;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const [priorityFilter, setPriorityFilter] = useState<'All' | TaskPriority>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | TaskStatus>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const tasks: PendingTask[] = handover?.pendingTasks ?? [];

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
      if (statusFilter !== 'All' && t.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.task.toLowerCase().includes(q) ||
          t.owner.toLowerCase().includes(q) ||
          t.sourceEvidence.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, priorityFilter, statusFilter, searchQuery]);

  if (!handover) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">No Pending Work Extracted Yet</h2>
        <p className="text-sm text-slate-600">
          Generate a Handover Pack first to populate the structured Task | Priority | Deadline | Status tracker.
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

  const handleStatusChange = async (taskId: string, nextStatus: TaskStatus) => {
    setSavingTaskId(taskId);
    try {
      await onUpdateTaskStatus(taskId, nextStatus);
    } finally {
      setSavingTaskId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-700">
            {project.code} · Pack v{handover.version}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Pending Work Tracker
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Structured open tasks with priority, target deadline, live status, and clickable source evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('files')}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
        >
          Next: Key Files & Links
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {(['All', 'Critical', 'High', 'Medium', 'Low'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriorityFilter(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  priorityFilter === p
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by task status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | TaskStatus)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
          >
            <option value="All">All Statuses</option>
            <option value="Blocked">Blocked</option>
            <option value="At Risk">At Risk</option>
            <option value="In Progress">In Progress</option>
            <option value="Not Started">Not Started</option>
          </select>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks, owners, or sources..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-700"
          />
        </div>
      </div>

      {/* High-Density Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-5 py-3.5">Task</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Priority</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Deadline</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Status</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Owner</th>
                <th className="px-5 py-3.5 whitespace-nowrap">Source / Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-xs text-slate-500">
                    No pending tasks match the active filter criteria.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-5 py-4 max-w-md">
                      <p className="font-semibold text-slate-900">{t.task}</p>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{t.context}</p>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <PriorityIndicator priority={t.priority} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap font-mono text-xs text-slate-700 tabular-nums">
                      {formatShortDate(t.deadline)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <select
                        aria-label={`Update status for ${t.task}`}
                        value={t.status}
                        disabled={savingTaskId === t.id}
                        onChange={(e) => handleStatusChange(t.id, e.target.value as TaskStatus)}
                        className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:border-blue-700"
                      >
                        <option value="Blocked">Blocked</option>
                        <option value="At Risk">At Risk</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Not Started">Not Started</option>
                      </select>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs font-medium text-slate-700">
                      {t.owner}
                    </td>
                    <td className="px-5 py-4">
                      <SourceCitationButton
                        evidence={t.sourceEvidence}
                        sourceId={t.sourceId}
                        onInspect={onInspectSource}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
