import React, { useCallback, useEffect, useState } from 'react';
import {
  addProjectSource,
  deleteProjectSource,
  fetchHandoverHistory,
  fetchProjectDetail,
  fetchProjects,
  generateHandover,
  submitHandoverApproval,
  updateHandoverDraft,
  type HistoryEntry,
} from './lib/api';
import type {
  ActivitySource,
  HandoverApprovalStatus,
  HandoverPack,
  ProjectSummaryDTO,
  ScreenId,
  SourceKind,
  TaskStatus,
  UserSession,
} from './types';
import { LandingLoginScreen } from './components/LandingLoginScreen';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './components/DashboardScreen';
import { ProjectActivityScreen } from './components/ProjectActivityScreen';
import { AiGenerationScreen } from './components/AiGenerationScreen';
import { HandoverPackScreen } from './components/HandoverPackScreen';
import { PendingWorkScreen } from './components/PendingWorkScreen';
import { KeyFilesScreen } from './components/KeyFilesScreen';
import { ReviewApproveScreen } from './components/ReviewApproveScreen';
import { HandoverHistoryScreen } from './components/HandoverHistoryScreen';
import { SourceEvidenceDrawer } from './components/StatusPrimitives';

export default function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenId>('landing');

  const [projects, setProjects] = useState<ProjectSummaryDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj-checkout-v3');
  const [sources, setSources] = useState<ActivitySource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [handovers, setHandovers] = useState<HandoverPack[]>([]);
  const [activeHandoverId, setActiveHandoverId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Source Evidence Inspector Drawer state
  const [inspectedEvidence, setInspectedEvidence] = useState<{
    source: ActivitySource | null;
    label: string;
  } | null>(null);

  const loadProjectsList = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const list = await fetchProjects();
      setProjects(list);
      if (list.length > 0 && !list.some((p) => p.id === selectedProjectId)) {
        setSelectedProjectId(list[0].id);
      }
    } finally {
      setLoadingProjects(false);
    }
  }, [selectedProjectId]);

  const loadProjectDetail = useCallback(async (projectId: string, preferredHandoverId?: string) => {
    if (!projectId) return;
    const detail = await fetchProjectDetail(projectId);
    setSources(detail.sources);
    setSelectedSourceIds(detail.sources.map((s) => s.id));
    setHandovers(detail.handovers);
    if (preferredHandoverId && detail.handovers.some((h) => h.id === preferredHandoverId)) {
      setActiveHandoverId(preferredHandoverId);
    } else {
      setActiveHandoverId(detail.handovers[0]?.id ?? null);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const entries = await fetchHandoverHistory();
      setHistory(entries);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    loadProjectsList();
    loadHistory();
  }, [session, loadProjectsList, loadHistory]);

  useEffect(() => {
    if (!session || !selectedProjectId) return;
    loadProjectDetail(selectedProjectId);
  }, [session, selectedProjectId, loadProjectDetail]);

  const handleLogin = (newSession: UserSession) => {
    setSession(newSession);
    setActiveScreen('dashboard');
  };

  const handleSignOut = () => {
    setSession(null);
    setActiveScreen('landing');
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setGenerationError(null);
  };

  const handleToggleSource = (sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId],
    );
  };

  const handleAddSource = async (payload: {
    title: string;
    kind: SourceKind;
    fileName: string;
    content?: string;
    base64Data?: string;
    mimeType?: string;
  }) => {
    const created = await addProjectSource(selectedProjectId, {
      ...payload,
      addedBy: session?.name ?? 'Arjun Mehta',
    });
    setSources((prev) => [created, ...prev]);
    setSelectedSourceIds((prev) => [created.id, ...prev]);
    await loadProjectsList();
  };

  const handleDeleteSource = async (sourceId: string) => {
    await deleteProjectSource(selectedProjectId, sourceId);
    setSources((prev) => prev.filter((s) => s.id !== sourceId));
    setSelectedSourceIds((prev) => prev.filter((id) => id !== sourceId));
    await loadProjectsList();
  };

  const handleRunGeneration = async (focusInstructions: string) => {
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const created = await generateHandover({
        projectId: selectedProjectId,
        selectedSourceIds,
        focusInstructions,
      });
      await loadProjectDetail(selectedProjectId, created.id);
      await loadProjectsList();
      await loadHistory();
      setActiveScreen('pack');
    } catch (err) {
      setGenerationError(
        err instanceof Error ? err.message : 'Unable to generate handover pack.',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: TaskStatus) => {
    const currentPack = handovers.find((h) => h.id === activeHandoverId) ?? handovers[0];
    if (!currentPack) return;

    const updatedPending = currentPack.pendingTasks.map((t) =>
      t.id === taskId ? { ...t, status } : t,
    );
    const updated = await updateHandoverDraft(currentPack.id, {
      pendingTasks: updatedPending,
    });
    setHandovers((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    await loadProjectsList();
    await loadHistory();
  };

  const handleSaveReviewEdits = async (
    handoverId: string,
    updates: Pick<HandoverPack, 'projectSummary' | 'pendingTasks' | 'risksAndNotes'>,
  ) => {
    const updated = await updateHandoverDraft(handoverId, updates);
    setHandovers((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    await loadProjectsList();
  };

  const handleSubmitApproval = async (
    handoverId: string,
    payload: {
      decision: HandoverApprovalStatus;
      reviewerName: string;
      reviewerRole: string;
      comments: string;
      editedFields: string[];
    },
  ) => {
    const updated = await submitHandoverApproval(handoverId, payload);
    setHandovers((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    await loadProjectsList();
    await loadHistory();
    setActiveScreen('history');
  };

  const handleInspectSource = (sourceId: string, evidence: string) => {
    const match = sources.find((s) => s.id === sourceId) ?? null;
    setInspectedEvidence({ source: match, label: evidence });
  };

  if (!session || activeScreen === 'landing') {
    return <LandingLoginScreen onLogin={handleLogin} />;
  }

  const currentProject =
    projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;
  const activeHandover =
    handovers.find((h) => h.id === activeHandoverId) ?? handovers[0] ?? null;

  const selectedSourceObjects = sources.filter((s) => selectedSourceIds.includes(s.id));

  // Contextual Next-Step CTA for Top Bar so judges can flow effortlessly
  const getPrimaryAction = (): { label: string; onClick: () => void; disabled?: boolean } | undefined => {
    if (activeScreen === 'dashboard') {
      return {
        label: 'View Project Activity',
        onClick: () => setActiveScreen('activity'),
      };
    }
    if (activeScreen === 'activity') {
      return {
        label: 'Generate Handover Pack',
        onClick: () => setActiveScreen('generate'),
        disabled: selectedSourceIds.length === 0,
      };
    }
    if (activeScreen === 'pack' && activeHandover) {
      return {
        label: 'Review & Approve',
        onClick: () => setActiveScreen('review'),
      };
    }
    if (activeScreen === 'pending' && activeHandover) {
      return {
        label: 'Key Files & Links',
        onClick: () => setActiveScreen('files'),
      };
    }
    if (activeScreen === 'files' && activeHandover) {
      return {
        label: 'Review & Approve',
        onClick: () => setActiveScreen('review'),
      };
    }
    return undefined;
  };

  return (
    <>
      <AppShell
        activeScreen={activeScreen}
        onNavigate={(screen) => setActiveScreen(screen)}
        session={session}
        onSignOut={handleSignOut}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={handleSelectProject}
        primaryAction={getPrimaryAction()}
      >
        {activeScreen === 'dashboard' && (
          <DashboardScreen
            projects={projects}
            selectedProjectId={selectedProjectId}
            loading={loadingProjects}
            onSelectAndOpenActivity={(pid) => {
              setSelectedProjectId(pid);
              setActiveScreen('activity');
            }}
            onOpenPack={(pid) => {
              setSelectedProjectId(pid);
              setActiveScreen('pack');
            }}
            onNavigate={(s) => setActiveScreen(s)}
          />
        )}

        {activeScreen === 'activity' && currentProject && (
          <ProjectActivityScreen
            project={currentProject}
            sources={sources}
            selectedSourceIds={selectedSourceIds}
            onToggleSource={handleToggleSource}
            onAddSource={handleAddSource}
            onDeleteSource={handleDeleteSource}
            onProceedToGenerate={() => setActiveScreen('generate')}
          />
        )}

        {activeScreen === 'generate' && currentProject && (
          <AiGenerationScreen
            project={currentProject}
            selectedSources={selectedSourceObjects}
            isGenerating={isGenerating}
            error={generationError}
            onRunGeneration={handleRunGeneration}
            onBackToActivity={() => setActiveScreen('activity')}
          />
        )}

        {activeScreen === 'pack' && currentProject && (
          <HandoverPackScreen
            project={currentProject}
            handover={activeHandover}
            onInspectSource={handleInspectSource}
            onNavigate={(s) => setActiveScreen(s)}
          />
        )}

        {activeScreen === 'pending' && currentProject && (
          <PendingWorkScreen
            project={currentProject}
            handover={activeHandover}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onInspectSource={handleInspectSource}
            onNavigate={(s) => setActiveScreen(s)}
          />
        )}

        {activeScreen === 'files' && currentProject && (
          <KeyFilesScreen
            project={currentProject}
            handover={activeHandover}
            onInspectSource={handleInspectSource}
            onNavigate={(s) => setActiveScreen(s)}
          />
        )}

        {activeScreen === 'review' && currentProject && (
          <ReviewApproveScreen
            project={currentProject}
            handover={activeHandover}
            session={session}
            onSaveEdits={handleSaveReviewEdits}
            onSubmitDecision={handleSubmitApproval}
            onInspectSource={handleInspectSource}
            onNavigate={(s) => setActiveScreen(s)}
          />
        )}

        {activeScreen === 'history' && (
          <HandoverHistoryScreen
            history={history}
            loading={loadingHistory}
            onInspectSnapshot={async (pid, hid) => {
              setSelectedProjectId(pid);
              await loadProjectDetail(pid, hid);
              setActiveScreen('pack');
            }}
          />
        )}
      </AppShell>

      <SourceEvidenceDrawer
        source={inspectedEvidence?.source ?? null}
        evidenceLabel={inspectedEvidence?.label ?? null}
        onClose={() => setInspectedEvidence(null)}
      />
    </>
  );
}
