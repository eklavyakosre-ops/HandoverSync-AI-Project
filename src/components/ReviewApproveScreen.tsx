import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Save,
  Trash2,
  UserCheck,
} from 'lucide-react';
import type {
  HandoverApprovalStatus,
  HandoverPack,
  PendingTask,
  ProjectSummaryDTO,
  RiskNote,
  ScreenId,
  TaskPriority,
  TaskStatus,
  UserSession,
} from '../types';
import { HandoverStatusTag, SourceCitationButton } from './StatusPrimitives';

export function ReviewApproveScreen({
  project,
  handover,
  session,
  onSaveEdits,
  onSubmitDecision,
  onInspectSource,
  onNavigate,
}: {
  project: ProjectSummaryDTO;
  handover: HandoverPack | null;
  session: UserSession;
  onSaveEdits: (
    handoverId: string,
    updates: Pick<HandoverPack, 'projectSummary' | 'pendingTasks' | 'risksAndNotes'>,
  ) => Promise<void>;
  onSubmitDecision: (
    handoverId: string,
    payload: {
      decision: HandoverApprovalStatus;
      reviewerName: string;
      reviewerRole: string;
      comments: string;
      editedFields: string[];
    },
  ) => Promise<void>;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const [summary, setSummary] = useState(
    handover?.projectSummary ?? {
      executiveOverview: '',
      architectureContext: '',
      handoverReadinessNote: '',
    },
  );
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>(handover?.pendingTasks ?? []);
  const [risks, setRisks] = useState<RiskNote[]>(handover?.risksAndNotes ?? []);
  const [reviewerName, setReviewerName] = useState(session.name);
  const [reviewerRole, setReviewerRole] = useState(session.roleLabel);
  const [comments, setComments] = useState(
    handover?.humanReview?.comments ||
      'Verified pending Payment API tasks, deadlines, and key files against source citations.',
  );
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!handover) return;
    setSummary(handover.projectSummary);
    setPendingTasks(handover.pendingTasks);
    setRisks(handover.risksAndNotes);
    setComments(
      handover.humanReview?.comments ||
        'Verified pending tasks, deadlines, and key files against original source evidence.',
    );
    setEditedFields([]);
  }, [handover?.id]);

  if (!handover) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-2xl mx-auto space-y-4">
        <UserCheck className="w-8 h-8 text-blue-700 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900">
          No Handover Pack Available to Review
        </h2>
        <p className="text-sm text-slate-600">
          Run AI Handover Generation first. Once drafted, you can edit, correct, and formally approve the pack here.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('generate')}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
        >
          Generate Handover Pack
        </button>
      </div>
    );
  }

  const markEdited = (field: string) => {
    setEditedFields((prev) => (prev.includes(field) ? prev : [...prev, field]));
  };

  const handleTaskChange = (idx: number, patch: Partial<PendingTask>) => {
    markEdited('pendingTasks');
    setPendingTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const handleAddTask = () => {
    markEdited('pendingTasks');
    const fallbackSource = handover.sourcesAnalyzed[0];
    setPendingTasks((prev) => [
      ...prev,
      {
        id: `pt-manual-${Date.now()}`,
        task: 'Manual follow-up item added during human review',
        priority: 'High',
        deadline: project.targetExitDate,
        status: 'Not Started',
        owner: project.incomingOwner.name,
        context: 'Added by reviewer during handover verification.',
        sourceEvidence: 'Human Reviewer Addition',
        sourceId: fallbackSource?.sourceId ?? '',
      },
    ]);
  };

  const handleDeleteTask = (idx: number) => {
    markEdited('pendingTasks');
    setPendingTasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleRiskChange = (idx: number, patch: Partial<RiskNote>) => {
    markEdited('risksAndNotes');
    setRisks((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setSavedNotice(null);
    try {
      await onSaveEdits(handover.id, {
        projectSummary: summary,
        pendingTasks,
        risksAndNotes: risks,
      });
      setSavedNotice('Human edits saved to draft pack.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecision = async (decision: HandoverApprovalStatus) => {
    setSubmitting(true);
    setSavedNotice(null);
    try {
      await onSaveEdits(handover.id, {
        projectSummary: summary,
        pendingTasks,
        risksAndNotes: risks,
      });
      await onSubmitDecision(handover.id, {
        decision,
        reviewerName,
        reviewerRole,
        comments,
        editedFields,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono text-slate-500">
              {project.code} · Pack v{handover.version}
            </span>
            <HandoverStatusTag status={handover.status} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Human Review & Approval
          </h1>
          <p className="text-sm text-slate-600">
            AI generates the initial draft — outgoing leads and incoming managers hold final authority to edit, correct, and sign off.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={saving || submitting}
          className="px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap self-start lg:self-auto"
        >
          <Save className="w-3.5 h-3.5 text-slate-500" />
          {saving ? 'Saving...' : 'Save Draft Edits'}
        </button>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
          {savedNotice}
        </div>
      )}

      {/* Editable Summary */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          1. Verify & Edit Project Summary
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Executive Overview
            </label>
            <textarea
              rows={3}
              value={summary.executiveOverview}
              onChange={(e) => {
                markEdited('projectSummary.executiveOverview');
                setSummary((s) => ({ ...s, executiveOverview: e.target.value }));
              }}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Architecture Context
              </label>
              <textarea
                rows={3}
                value={summary.architectureContext}
                onChange={(e) => {
                  markEdited('projectSummary.architectureContext');
                  setSummary((s) => ({ ...s, architectureContext: e.target.value }));
                }}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Handover Readiness Note
              </label>
              <textarea
                rows={3}
                value={summary.handoverReadinessNote}
                onChange={(e) => {
                  markEdited('projectSummary.handoverReadinessNote');
                  setSummary((s) => ({ ...s, handoverReadinessNote: e.target.value }));
                }}
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Editable Pending Tasks */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">
            2. Correct Pending Tasks, Priorities & Deadlines ({pendingTasks.length})
          </h2>
          <button
            type="button"
            onClick={handleAddTask}
            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Missing Task
          </button>
        </div>

        <div className="space-y-3">
          {pendingTasks.map((t, idx) => (
            <div
              key={t.id}
              className="p-4 rounded-lg border border-slate-200 bg-slate-50/40 space-y-3"
            >
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Task Title</label>
                  <input
                    type="text"
                    value={t.task}
                    onChange={(e) => handleTaskChange(idx, { task: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 lg:w-[380px] shrink-0">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Priority</label>
                    <select
                      value={t.priority}
                      onChange={(e) =>
                        handleTaskChange(idx, { priority: e.target.value as TaskPriority })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                    <select
                      value={t.status}
                      onChange={(e) =>
                        handleTaskChange(idx, { status: e.target.value as TaskStatus })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="Blocked">Blocked</option>
                      <option value="At Risk">At Risk</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Not Started">Not Started</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Deadline</label>
                    <input
                      type="text"
                      value={t.deadline}
                      onChange={(e) => handleTaskChange(idx, { deadline: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <SourceCitationButton
                    evidence={t.sourceEvidence}
                    sourceId={t.sourceId}
                    onInspect={onInspectSource}
                  />
                  <span className="text-xs text-slate-500">Owner: {t.owner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteTask(idx)}
                  className="text-xs text-slate-500 hover:text-red-700 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Editable Risks */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">
          3. Verify Risks & Mitigations ({risks.length})
        </h2>
        <div className="space-y-3">
          {risks.map((risk, idx) => (
            <div key={risk.id} className="p-4 rounded-lg border border-slate-200 space-y-2.5">
              <div className="grid md:grid-cols-4 gap-3">
                <div className="md:col-span-3">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Risk</label>
                  <input
                    type="text"
                    value={risk.title}
                    onChange={(e) => handleRiskChange(idx, { title: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Severity</label>
                  <select
                    value={risk.severity}
                    onChange={(e) =>
                      handleRiskChange(idx, {
                        severity: e.target.value as RiskNote['severity'],
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Moderate">Moderate</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Mitigation</label>
                <input
                  type="text"
                  value={risk.mitigation}
                  onChange={(e) => handleRiskChange(idx, { mitigation: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final Human Sign-Off Box */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            4. Final Human Sign-Off
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Approving locks this verified version into the permanent Handover History ledger.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reviewer Name
            </label>
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reviewer Role
            </label>
            <input
              type="text"
              value={reviewerRole}
              onChange={(e) => setReviewerRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Approval / Review Notes
          </label>
          <textarea
            rows={2}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleDecision('changes_requested')}
            className="px-4 py-2.5 text-xs font-medium text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <AlertTriangle className="w-4 h-4" />
            Request Revisions
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleDecision('approved')}
            className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg inline-flex items-center gap-2 whitespace-nowrap"
          >
            <CheckCircle2 className="w-4 h-4" />
            {submitting ? 'Recording Approval...' : 'Approve & Sign Off Handover'}
          </button>
        </div>
      </section>
    </div>
  );
}
