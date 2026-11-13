import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { ActivitySource, ProjectSummaryDTO } from '../types';
import { SourceKindIcon, sourceKindLabel } from './StatusPrimitives';

const EXTRACTION_STAGES = [
  {
    title: 'Reading & normalizing selected sources',
    detail: 'Parsing CSV task rows, GitHub issues/PRs, and technical runbook sections',
  },
  {
    title: 'Synthesizing project summary & architecture context',
    detail: 'Identifying system boundaries, dependencies, and readiness posture',
  },
  {
    title: 'Extracting pending work, priorities & deadlines',
    detail: 'Structuring Task | Priority | Deadline | Status table entries',
  },
  {
    title: 'Mapping key files & attaching source citations',
    detail: 'Linking every extracted item back to exact Issue #, CSV row, or Doc section',
  },
];

export function AiGenerationScreen({
  project,
  selectedSources,
  isGenerating,
  error,
  onRunGeneration,
  onBackToActivity,
}: {
  project: ProjectSummaryDTO;
  selectedSources: ActivitySource[];
  isGenerating: boolean;
  error: string | null;
  onRunGeneration: (focusInstructions: string) => Promise<void>;
  onBackToActivity: () => void;
}) {
  const [focusInstructions, setFocusInstructions] = useState(
    'Highlight 3DS2 Payment API testing blockers, Stripe webhook secret locations, and upcoming cutover deadlines with exact GitHub Issue and CSV row citations.',
  );
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    if (!isGenerating) {
      setActiveStage(0);
      return;
    }
    const timer = window.setInterval(() => {
      setActiveStage((prev) => (prev < EXTRACTION_STAGES.length - 1 ? prev + 1 : prev));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-blue-700">
            {project.code} · {project.name}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            AI Handover Pack Generation
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Run Gemini extraction over your aggregated sources to produce a structured, source-cited handover dossier.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToActivity}
          disabled={isGenerating}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Activity
        </button>
      </div>

      {/* Selected Sources Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Sources Queued for Extraction ({selectedSources.length})
          </h2>
          <span className="text-xs text-slate-500">
            All outputs require exact source citations
          </span>
        </div>

        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
          {selectedSources.map((src) => (
            <div key={src.id} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <SourceKindIcon kind={src.kind} className="w-4 h-4 text-blue-700 shrink-0" />
                <span className="font-medium text-slate-900 truncate">{src.title}</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-slate-500 truncate">{src.fileName}</span>
              </div>
              <span className="text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
                {sourceKindLabel(src.kind)} · {src.recordCount} records
              </span>
            </div>
          ))}
        </div>

        {/* Outgoing Engineer Instructions */}
        <div className="pt-2">
          <label
            htmlFor="focus-instructions"
            className="block text-xs font-medium text-slate-700 mb-1.5"
          >
            Optional Outgoing Lead Instructions
          </label>
          <textarea
            id="focus-instructions"
            rows={3}
            disabled={isGenerating}
            value={focusInstructions}
            onChange={(e) => setFocusInstructions(e.target.value)}
            placeholder="Add any specific transition focus areas for the incoming owner..."
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 disabled:bg-slate-50"
          />
        </div>

        {error && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">AI Extraction Failed</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-500">
            Generated packs enter <span className="font-medium text-slate-700">In Review</span>{' '}
            state until verified by a human reviewer.
          </p>
          <button
            type="button"
            disabled={isGenerating || selectedSources.length === 0}
            onClick={() => onRunGeneration(focusInstructions)}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing Sources...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Run AI Handover Extraction
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live AI Processing Stages */}
      {isGenerating && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              AI Extraction Pipeline Active
            </h3>
            <span className="text-xs font-mono text-blue-700">
              Step {activeStage + 1} of {EXTRACTION_STAGES.length}
            </span>
          </div>

          <div className="space-y-3">
            {EXTRACTION_STAGES.map((stage, idx) => {
              const completed = idx < activeStage;
              const current = idx === activeStage;
              return (
                <div
                  key={stage.title}
                  className={`p-3.5 rounded-lg border flex items-start gap-3 ${
                    current
                      ? 'border-blue-300 bg-blue-50/50'
                      : completed
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : 'border-slate-200 bg-slate-50/50 opacity-60'
                  }`}
                >
                  {completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : current ? (
                    <Loader2 className="w-4 h-4 text-blue-700 animate-spin shrink-0 mt-0.5" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-300 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{stage.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{stage.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
