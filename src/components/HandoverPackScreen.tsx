import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  GitBranch,
  Layers,
  ListChecks,
  Plug,
  Sparkles,
  Terminal,
  UserCheck,
} from 'lucide-react';
import type { HandoverPack, ProjectSummaryDTO, ScreenId } from '../types';
import {
  HandoverStatusTag,
  PriorityIndicator,
  SourceCitationButton,
  TaskStatusIndicator,
  formatDateTime,
  formatShortDate,
} from './StatusPrimitives';
import { buildHandoverMarkdown, triggerFileDownload } from '../lib/api';

export function HandoverPackScreen({
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
  if (!handover) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto space-y-4">
        <Sparkles className="w-8 h-8 text-blue-700 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900">
          No Handover Pack Generated Yet for {project.name}
        </h2>
        <p className="text-sm text-slate-600">
          Inspect the aggregated project sources and run AI Handover Generation to synthesize a structured, source-cited handover dossier.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onNavigate('activity')}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Inspect Project Activity
          </button>
          <button
            type="button"
            onClick={() => onNavigate('generate')}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5"
          >
            Generate Handover Pack
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const handleExportMarkdown = () => {
    const md = buildHandoverMarkdown(handover, project.name);
    triggerFileDownload(
      `${project.code.toLowerCase()}-handover-v${handover.version}.md`,
      md,
      'text/markdown;charset=utf-8',
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono text-slate-500">
              {project.code} · Pack v{handover.version}
            </span>
            <HandoverStatusTag status={handover.status} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {project.name} — Handover Pack
          </h1>
          <p className="text-xs text-slate-500 tabular-nums">
            Generated {formatDateTime(handover.generatedAt)} · {handover.sourcesAnalyzed.length}{' '}
            sources cited · Click any source link to inspect raw evidence
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export Markdown
          </button>
          <button
            type="button"
            onClick={() => onNavigate('review')}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <UserCheck className="w-3.5 h-3.5" />
            Review & Approve
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Human Verification Notice if Approved or In Review */}
      {handover.humanReview ? (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            handover.humanReview.decision === 'approved'
              ? 'bg-emerald-50/70 border-emerald-200'
              : 'bg-red-50/70 border-red-200'
          }`}
        >
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-slate-900">
              {handover.humanReview.decision === 'approved'
                ? 'Signed Off & Approved by Human Reviewer'
                : 'Changes Requested During Human Review'}
            </p>
            <p className="text-xs text-slate-700">
              {handover.humanReview.reviewerName} ({handover.humanReview.reviewerRole}) ·{' '}
              {formatDateTime(handover.humanReview.reviewedAt)} — “{handover.humanReview.comments}”
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
          >
            View in Audit History
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs text-amber-900">
            <span className="font-semibold">Human Review Required:</span> This AI-generated handover draft must be verified, edited if needed, and formally approved before final sign-off.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('review')}
            className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-md whitespace-nowrap shrink-0"
          >
            Open Review Editor
          </button>
        </div>
      )}

      {/* 1. Project Summary */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-900">01. Project Summary</h2>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-500">Executive Overview</h3>
            <p className="text-sm text-slate-800 leading-relaxed">
              {handover.projectSummary.executiveOverview}
            </p>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-500">Architecture Context</h3>
            <p className="text-sm text-slate-800 leading-relaxed">
              {handover.projectSummary.architectureContext}
            </p>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-500">Handover Readiness Note</h3>
            <p className="text-sm text-slate-800 leading-relaxed">
              {handover.projectSummary.handoverReadinessNote}
            </p>
          </div>
        </div>
      </section>

      {/* Tech Stack & Connected Integrations (when available) */}
      {((handover.technologyStack && handover.technologyStack.length > 0) ||
        (handover.connectedIntegrations && handover.connectedIntegrations.length > 0)) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {handover.technologyStack && handover.technologyStack.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-blue-700" />
                <h2 className="text-base font-semibold text-slate-900">Technology Stack</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {handover.technologyStack.map((tech, idx) => (
                  <span
                    key={`${tech}-${idx}`}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200 rounded-md"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </section>
          )}

          {handover.connectedIntegrations && handover.connectedIntegrations.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-blue-700" />
                  <h2 className="text-base font-semibold text-slate-900">
                    Connected Integrations ({handover.connectedIntegrations.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('integrations')}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Manage Connectors →
                </button>
              </div>
              <div className="space-y-2">
                {handover.connectedIntegrations.map((ci, idx) => (
                  <div
                    key={`${ci.provider}-${idx}`}
                    className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="font-medium text-slate-900">
                      <span className="uppercase text-blue-700 mr-1.5">{ci.displayName}</span>
                      {ci.targetLabel}
                    </span>
                    {typeof ci.recordsImported === 'number' && (
                      <span className="text-slate-500 tabular-nums shrink-0">
                        {ci.recordsImported} records
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 2. Pending Tasks Snapshot (Links to Screen 6) */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              02. Pending Work ({handover.pendingTasks.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Unfinished tasks requiring incoming owner execution with verified source links
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('pending')}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
          >
            Open Full Pending Tracker →
          </button>
        </div>

        <div className="divide-y divide-slate-200">
          {handover.pendingTasks.map((item) => (
            <div
              key={item.id}
              className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityIndicator priority={item.priority} />
                  <TaskStatusIndicator status={item.status} />
                  <span className="text-sm font-semibold text-slate-900">{item.task}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{item.context}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-0.5">
                  <span>Owner: {item.owner}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Deadline: {formatShortDate(item.deadline)}
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                <SourceCitationButton
                  evidence={item.sourceEvidence}
                  sourceId={item.sourceId}
                  onInspect={onInspectSource}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Completed Tasks & 4. Deadlines Split */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h2 className="text-base font-semibold text-slate-900">
              03. Completed Tasks ({handover.completedTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {handover.completedTasks.map((ct) => (
              <div key={ct.id} className="p-5 space-y-2">
                <p className="text-sm font-semibold text-slate-900">{ct.title}</p>
                <p className="text-xs text-slate-600">{ct.impact}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-slate-500 tabular-nums">
                    {ct.owner} · {formatShortDate(ct.completedDate)}
                  </span>
                  <SourceCitationButton
                    evidence={ct.sourceEvidence}
                    sourceId={ct.sourceId}
                    onInspect={onInspectSource}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-semibold text-slate-900">
              04. Deadlines & Milestones ({handover.deadlines.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {handover.deadlines.map((dl) => (
              <div key={dl.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{dl.milestone}</p>
                  <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums shrink-0">
                    {formatShortDate(dl.date)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {dl.criticality} Criticality · Owner: {dl.owner}
                  </span>
                  <SourceCitationButton
                    evidence={dl.sourceEvidence}
                    sourceId={dl.sourceId}
                    onInspect={onInspectSource}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 5. Important Files & 6. Risks/Notes */}
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-slate-600" />
              <h2 className="text-base font-semibold text-slate-900">
                05. Important Files & Links ({handover.importantFiles.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('files')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Open Files View →
            </button>
          </div>
          <div className="divide-y divide-slate-200">
            {handover.importantFiles.map((file) => (
              <div key={file.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                  <span className="text-xs text-slate-500">{file.kind}</span>
                </div>
                <p className="text-xs font-mono text-blue-700 break-all flex items-center gap-1">
                  {file.locationOrUrl}
                  {file.locationOrUrl.startsWith('http') && (
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  )}
                </p>
                <p className="text-xs text-slate-600">{file.purpose}</p>
                <div className="pt-1">
                  <SourceCitationButton
                    evidence={file.sourceEvidence}
                    sourceId={file.sourceId}
                    onInspect={onInspectSource}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h2 className="text-base font-semibold text-slate-900">
              06. Risks, Blockers & Notes ({handover.risksAndNotes.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-200">
            {handover.risksAndNotes.map((risk) => (
              <div key={risk.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{risk.title}</p>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded border ${
                      risk.severity === 'Critical'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : risk.severity === 'High'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {risk.severity}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <span className="font-medium text-slate-800">Mitigation:</span> {risk.mitigation}
                </p>
                <div className="pt-1">
                  <SourceCitationButton
                    evidence={risk.sourceEvidence}
                    sourceId={risk.sourceId}
                    onInspect={onInspectSource}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Knowledge Gaps Snapshot, Decisions, Dependencies & Next Actions */}
      {((handover.knowledgeGapsSnapshot && handover.knowledgeGapsSnapshot.length > 0) ||
        (handover.missingDocumentation && handover.missingDocumentation.length > 0)) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-amber-600" />
              <h2 className="text-base font-semibold text-slate-900">
                07. Knowledge Gaps &amp; Missing Documentation
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('gaps')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Open Knowledge Gap Detector →
            </button>
          </div>
          <div className="p-6 space-y-4">
            {handover.knowledgeGapsSnapshot && handover.knowledgeGapsSnapshot.length > 0 && (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {handover.knowledgeGapsSnapshot.map((g) => (
                  <div key={g.gapId} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{g.title}</span>
                      <span className="text-slate-500 ml-2">({g.category})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {g.assignedOwner && (
                        <span className="text-slate-600">Owner: {g.assignedOwner}</span>
                      )}
                      <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 font-medium text-slate-700">
                        {g.severity} · {g.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {handover.missingDocumentation && handover.missingDocumentation.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-700">Missing Documentation</h3>
                <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700">
                  {handover.missingDocumentation.map((doc, idx) => (
                    <li key={idx}>{doc}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {((handover.unresolvedIssues && handover.unresolvedIssues.length > 0) ||
        (handover.importantDecisions && handover.importantDecisions.length > 0) ||
        (handover.dependencies && handover.dependencies.length > 0)) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {handover.importantDecisions && handover.importantDecisions.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-blue-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Important Technical Decisions ({handover.importantDecisions.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-200">
                {handover.importantDecisions.map((dec) => (
                  <div key={dec.id} className="p-5 space-y-2">
                    <p className="text-sm font-semibold text-slate-900">{dec.decision}</p>
                    <p className="text-xs text-slate-600 leading-relaxed">{dec.rationale}</p>
                    <SourceCitationButton
                      evidence={dec.sourceEvidence}
                      sourceId={dec.sourceId}
                      onInspect={onInspectSource}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {((handover.dependencies && handover.dependencies.length > 0) ||
            (handover.unresolvedIssues && handover.unresolvedIssues.length > 0)) && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Dependencies &amp; Unresolved Issues
                </h2>
              </div>
              <div className="divide-y divide-slate-200">
                {handover.unresolvedIssues?.map((ui) => (
                  <div key={ui.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{ui.title}</p>
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                        {ui.severity} · {ui.status}
                      </span>
                    </div>
                    <SourceCitationButton
                      evidence={ui.sourceEvidence}
                      sourceId={ui.sourceId}
                      onInspect={onInspectSource}
                    />
                  </div>
                ))}
                {handover.dependencies?.map((dep) => (
                  <div key={dep.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{dep.name}</p>
                      {dep.owner && (
                        <span className="text-xs text-slate-500">Owner: {dep.owner}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{dep.details}</p>
                    <SourceCitationButton
                      evidence={dep.sourceEvidence}
                      sourceId={dep.sourceId}
                      onInspect={onInspectSource}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {((handover.operationalInstructions && handover.operationalInstructions.length > 0) ||
        (handover.suggestedNextActions && handover.suggestedNextActions.length > 0)) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {handover.operationalInstructions && handover.operationalInstructions.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Operational Instructions
                </h2>
              </div>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-700 leading-relaxed">
                {handover.operationalInstructions.map((inst, idx) => (
                  <li key={idx}>{inst}</li>
                ))}
              </ul>
            </section>
          )}

          {handover.suggestedNextActions && handover.suggestedNextActions.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-blue-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Suggested Next Actions
                </h2>
              </div>
              <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-700 leading-relaxed">
                {handover.suggestedNextActions.map((act, idx) => (
                  <li key={idx}>{act}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
