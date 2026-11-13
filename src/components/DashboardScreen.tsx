import React from 'react';
import { ArrowRight, Calendar, FileStack, GitPullRequest, ShieldCheck } from 'lucide-react';
import type { ProjectSummaryDTO, ScreenId } from '../types';
import { HandoverStatusTag, formatShortDate } from './StatusPrimitives';

const DEMO_FLOW_STEPS: { label: string; screen: Exclude<ScreenId, 'landing'> }[] = [
  { label: '1. Select Project', screen: 'dashboard' },
  { label: '2. View Activity', screen: 'activity' },
  { label: '3. AI Generation', screen: 'generate' },
  { label: '4. Handover Pack', screen: 'pack' },
  { label: '5. Pending Work', screen: 'pending' },
  { label: '6. Review & Approve', screen: 'review' },
  { label: '7. History', screen: 'history' },
];

export function DashboardScreen({
  projects,
  selectedProjectId,
  onSelectAndOpenActivity,
  onOpenPack,
  onNavigate,
  loading,
}: {
  projects: ProjectSummaryDTO[];
  selectedProjectId: string;
  onSelectAndOpenActivity: (projectId: string) => void;
  onOpenPack: (projectId: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
  loading: boolean;
}) {
  const totalSources = projects.reduce((acc, p) => acc + p.sourceCount, 0);
  const totalPendingTasks = projects.reduce(
    (acc, p) => acc + (p.latestHandover?.pendingTasks.length ?? 0),
    0,
  );
  const approvedCount = projects.filter((p) => p.latestHandover?.status === 'approved').length;

  return (
    <div className="space-y-8">
      {/* Header & Guided Judge Flow */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Handover Overview
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Select a project below to inspect aggregated activity, run AI extraction, and complete human approval.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            View Handover History
          </button>
        </div>

        {/* Interactive End-to-End Demo Stepper */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {DEMO_FLOW_STEPS.map((step, idx) => (
              <React.Fragment key={step.screen}>
                <button
                  type="button"
                  onClick={() => onNavigate(step.screen)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    step.screen === 'dashboard'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {step.label}
                </button>
                {idx < DEMO_FLOW_STEPS.length - 1 && (
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Column Tabular KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Active Handover Projects</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums font-mono">
            {projects.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Across core engineering teams</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Aggregated Data Sources</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums font-mono">
            {totalSources}
          </p>
          <p className="text-xs text-slate-500 mt-1">CSVs · Runbooks · GitHub feeds</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Tracked Pending Tasks</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums font-mono">
            {totalPendingTasks}
          </p>
          <p className="text-xs text-slate-500 mt-1">Extracted with priority & deadlines</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Human-Approved Packs</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums font-mono">
            {approvedCount}
          </p>
          <p className="text-xs text-slate-500 mt-1">Verified & locked in history</p>
        </div>
      </div>

      {/* Projects Table / Cards */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">
            Transitioning Projects
          </h2>
          <span className="text-xs text-slate-500">
            Click a project to inspect multi-source activity
          </span>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {projects.map((project) => {
              const isSelected = project.id === selectedProjectId;
              const status = project.latestHandover?.status ?? 'Not Generated';

              return (
                <div
                  key={project.id}
                  className={`p-6 transition-colors ${
                    isSelected ? 'bg-blue-50/30' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-mono font-medium text-slate-500">
                          {project.code}
                        </span>
                        <h3 className="text-base font-semibold text-slate-900">
                          {project.name}
                        </h3>
                        <HandoverStatusTag status={status} />
                      </div>

                      <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                        {project.description}
                      </p>

                      {/* Clean Unboxed Metadata */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 pt-1">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                          <img
                            src={project.outgoingLead.avatar}
                            alt={project.outgoingLead.name}
                            referrerPolicy="no-referrer"
                            className="w-4 h-4 rounded-full object-cover"
                          />
                          From: {project.outgoingLead.name}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                          <img
                            src={project.incomingOwner.avatar}
                            alt={project.incomingOwner.name}
                            referrerPolicy="no-referrer"
                            className="w-4 h-4 rounded-full object-cover"
                          />
                          To: {project.incomingOwner.name}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          Target Exit: {formatShortDate(project.targetExitDate)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                          <FileStack className="w-3.5 h-3.5 text-slate-400" />
                          {project.sourceCount} sources ({project.sourceBreakdown.csv} CSV ·{' '}
                          {project.sourceBreakdown.github} GitHub ·{' '}
                          {project.sourceBreakdown.docs + project.sourceBreakdown.pdf} Docs)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {project.latestHandover && (
                        <button
                          type="button"
                          onClick={() => onOpenPack(project.id)}
                          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                          Inspect v{project.latestHandover.version} Pack
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectAndOpenActivity(project.id)}
                        className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap inline-flex items-center gap-1.5"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        Select & View Activity
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
