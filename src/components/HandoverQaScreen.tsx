import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type {
  ActivitySource,
  ProjectSummaryDTO,
  QaCitation,
  QaConversation,
  QaConversationsListResponse,
  QaEvidenceOriginKind,
  QaMessage,
  ScreenId,
  UserSession,
} from '../types';
import {
  createQaConversation,
  fetchQaConversation,
  fetchQaConversations,
  fetchQaMessageEvidence,
  sendQaMessage,
} from '../lib/api';
import { formatDateTime, formatShortDate } from './StatusPrimitives';

function evidenceTypeLabel(kind: QaEvidenceOriginKind): string {
  switch (kind) {
    case 'csv':
      return 'CSV Tasks';
    case 'github':
      return 'GitHub Activity';
    case 'pdf':
      return 'PDF Document';
    case 'docs':
      return 'Docs / Runbook';
    case 'handover_pack':
      return 'Handover Pack';
    case 'knowledge_gap':
      return 'Gap Finding';
  }
}

function renderTextWithCitations(
  text: string,
  citations: QaCitation[],
  activeCitationNum: number | null,
  onSelectCitation: (num: number) => void,
) {
  const citationNumbers = new Set(citations.map((c) => c.citationNumber));
  const parts = text.split(/(\[\d+\])/g);

  return parts.map((part, idx) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) {
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    }
    const num = Number(match[1]);
    if (!citationNumbers.has(num)) {
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    }
    const isSelected = activeCitationNum === num;
    return (
      <button
        key={idx}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelectCitation(num);
        }}
        className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-mono font-semibold rounded border align-baseline transition-colors ${
          isSelected
            ? 'bg-blue-700 text-white border-blue-700'
            : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
        }`}
        title={`Inspect citation [${num}]`}
      >
        [{num}]
      </button>
    );
  });
}

export function HandoverQaScreen({
  projects,
  selectedProjectId,
  onSelectProject,
  session,
  onInspectSource,
  onNavigate,
}: {
  projects: ProjectSummaryDTO[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  session: UserSession;
  onInspectSource: (sourceId: string, evidence: string) => void;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
}) {
  const currentProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  const [listData, setListData] = useState<QaConversationsListResponse | null>(null);
  const [activeConversation, setActiveConversation] = useState<QaConversation | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedCitationNum, setSelectedCitationNum] = useState<number | null>(null);

  const [evidenceState, setEvidenceState] = useState<{
    messageId: string;
    citations: QaCitation[];
    sources: ActivitySource[];
    loading: boolean;
    error: string | null;
  }>({
    messageId: '',
    citations: [],
    sources: [],
    loading: false,
    error: null,
  });

  const [questionInput, setQuestionInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mobile pane selector so all 3 panes remain compact & navigable on narrow screens
  const [mobilePane, setMobilePane] = useState<'chat' | 'context' | 'evidence'>('chat');

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (
      (activeConversation?.messages.length ?? 0) === 0 &&
      !sending &&
      !errorMsg
    ) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeConversation?.id, activeConversation?.messages.length, sending, errorMsg, mobilePane]);

  const loadMessageEvidence = useCallback(
    async (msg: QaMessage, projectId: string) => {
      setSelectedMessageId(msg.id);
      if (msg.citations.length === 0) {
        setEvidenceState({
          messageId: msg.id,
          citations: [],
          sources: [],
          loading: false,
          error: null,
        });
        return;
      }

      setEvidenceState({
        messageId: msg.id,
        citations: msg.citations,
        sources: [],
        loading: true,
        error: null,
      });

      try {
        const res = await fetchQaMessageEvidence(msg.id, projectId);
        setEvidenceState({
          messageId: res.messageId,
          citations: res.citations,
          sources: res.sources,
          loading: false,
          error: null,
        });
      } catch (err) {
        setEvidenceState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load message evidence.',
        }));
      }
    },
    [],
  );

  const loadProjectQa = useCallback(
    async (projectId: string, preferredConvId?: string) => {
      if (!projectId) return;
      setLoadingList(true);
      setErrorMsg(null);
      try {
        const res = await fetchQaConversations(projectId);
        setListData(res);

        const targetConv =
          (preferredConvId
            ? res.conversations.find((c) => c.id === preferredConvId)
            : undefined) ??
          res.conversations[0] ??
          null;

        setActiveConversation(targetConv);
        setSelectedCitationNum(null);

        if (targetConv) {
          const lastAssistant = [...targetConv.messages]
            .reverse()
            .find((m) => m.role === 'assistant');
          if (lastAssistant) {
            await loadMessageEvidence(lastAssistant, projectId);
          } else {
            setSelectedMessageId(null);
            setEvidenceState({
              messageId: '',
              citations: [],
              sources: [],
              loading: false,
              error: null,
            });
          }
        } else {
          setSelectedMessageId(null);
          setEvidenceState({
            messageId: '',
            citations: [],
            sources: [],
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load Q&A workspace.');
      } finally {
        setLoadingList(false);
      }
    },
    [loadMessageEvidence],
  );

  useEffect(() => {
    setActiveConversation(null);
    setSelectedMessageId(null);
    setSelectedCitationNum(null);
    setQuestionInput('');
    loadProjectQa(selectedProjectId);
  }, [selectedProjectId, loadProjectQa]);

  const handleNewChat = async () => {
    if (!selectedProjectId || sending) return;
    setErrorMsg(null);
    try {
      const conv = await createQaConversation(selectedProjectId, {
        createdBy: session.name,
      });
      setListData((prev) =>
        prev
          ? {
              ...prev,
              conversations: [conv, ...prev.conversations],
            }
          : prev,
      );
      setActiveConversation(conv);
      setSelectedMessageId(null);
      setSelectedCitationNum(null);
      setEvidenceState({
        messageId: '',
        citations: [],
        sources: [],
        loading: false,
        error: null,
      });
      setMobilePane('chat');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start a new chat.');
    }
  };

  const handleSelectConversation = async (conversationId: string) => {
    if (!selectedProjectId || sending) return;
    setLoadingConversation(true);
    setErrorMsg(null);
    setSelectedCitationNum(null);
    try {
      const conv = await fetchQaConversation(conversationId, selectedProjectId);
      setActiveConversation(conv);
      const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) {
        await loadMessageEvidence(lastAssistant, selectedProjectId);
      } else {
        setSelectedMessageId(null);
        setEvidenceState({
          messageId: '',
          citations: [],
          sources: [],
          loading: false,
          error: null,
        });
      }
      setMobilePane('chat');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load conversation.');
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleSubmitQuestion = async (overrideQuestion?: string) => {
    const cleanQuestion = (overrideQuestion ?? questionInput).trim();
    if (!cleanQuestion || !selectedProjectId || sending) return;

    setSending(true);
    setErrorMsg(null);
    if (!overrideQuestion) {
      setQuestionInput('');
    }

    try {
      let targetConv = activeConversation;
      if (!targetConv || targetConv.projectId !== selectedProjectId) {
        targetConv = await createQaConversation(selectedProjectId, {
          createdBy: session.name,
        });
      }

      const result = await sendQaMessage(targetConv.id, {
        projectId: selectedProjectId,
        question: cleanQuestion,
        author: session.name,
      });

      setActiveConversation(result.conversation);
      setListData((prev) => {
        if (!prev) return prev;
        const others = prev.conversations.filter((c) => c.id !== result.conversation.id);
        return {
          ...prev,
          conversations: [result.conversation, ...others],
        };
      });

      setSelectedCitationNum(null);
      await loadMessageEvidence(result.assistantMessage, selectedProjectId);
    } catch (err) {
      if (!overrideQuestion) {
        setQuestionInput(cleanQuestion);
      }
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'AI Q&A service returned an error. No unverified answer was saved.',
      );
    } finally {
      setSending(false);
    }
  };

  const handleCitationClick = async (msg: QaMessage, citationNumber: number) => {
    setSelectedCitationNum(citationNumber);
    if (selectedMessageId !== msg.id) {
      await loadMessageEvidence(msg, selectedProjectId);
    }
    setMobilePane('evidence');
  };

  const sourceSummary = listData?.sourceSummary;
  const hasAnyEvidence =
    (sourceSummary?.totalSources ?? 0) > 0 ||
    (sourceSummary?.handoverPackCount ?? 0) > 0 ||
    (sourceSummary?.knowledgeGapCount ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 font-display">
            Evidence-Cited Handover Q&amp;A
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Ask project-scoped handover questions answered strictly from verified sources and citations.
          </p>
        </div>

        {/* Mobile View Tabs */}
        <div className="flex lg:hidden border border-slate-200 bg-white rounded-lg p-1 gap-1 self-start">
          <button
            type="button"
            onClick={() => setMobilePane('context')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              mobilePane === 'context'
                ? 'bg-blue-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Context &amp; Chats
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('chat')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              mobilePane === 'chat'
                ? 'bg-blue-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Q&amp;A Chat
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('evidence')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              mobilePane === 'evidence'
                ? 'bg-blue-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Evidence ({evidenceState.citations.length})
          </button>
        </div>
      </div>

      {/* Responsive 3-Pane Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-4 items-start">
        {/* LEFT SIDEBAR: Project Selector, Context, Source Summary, Conversations */}
        <aside
          className={`bg-white border border-slate-200 rounded-xl p-4 space-y-5 ${
            mobilePane === 'context' ? 'block' : 'hidden lg:block'
          }`}
        >
          {/* Project Selector */}
          <div>
            <label
              htmlFor="qa-project-select"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Project Scope
            </label>
            <select
              id="qa-project-select"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              disabled={sending}
              className="w-full px-2.5 py-2 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Project Context */}
          {currentProject && (
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-900">Project Context</p>
              <div className="text-xs text-slate-600 space-y-1">
                <p className="font-medium text-slate-800">{currentProject.department}</p>
                <p>
                  Outgoing:{' '}
                  <span className="text-slate-900 font-medium">
                    {currentProject.outgoingLead.name}
                  </span>
                </p>
                <p>
                  Incoming:{' '}
                  <span className="text-slate-900 font-medium">
                    {currentProject.incomingOwner.name}
                  </span>
                </p>
                <p className="font-mono tabular-nums text-slate-500">
                  Target Exit: {formatShortDate(currentProject.targetExitDate)}
                </p>
              </div>
            </div>
          )}

          {/* Available Source Summary */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-900">Available Evidence</p>
              <button
                type="button"
                onClick={() => onNavigate('activity')}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                Manage Sources
              </button>
            </div>
            {loadingList ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Indexing project evidence...
              </div>
            ) : sourceSummary ? (
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between">
                  <span className="text-slate-600">CSV</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sourceSummary.breakdown.csv}
                  </span>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between">
                  <span className="text-slate-600">GitHub</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sourceSummary.breakdown.github}
                  </span>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between">
                  <span className="text-slate-600">Docs / PDF</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sourceSummary.breakdown.docs + sourceSummary.breakdown.pdf}
                  </span>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between">
                  <span className="text-slate-600">Packs</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sourceSummary.handoverPackCount}
                  </span>
                </div>
                {sourceSummary.knowledgeGapCount > 0 && (
                  <div className="col-span-2 px-2.5 py-1.5 bg-amber-50/70 border border-amber-200 rounded-md flex items-center justify-between">
                    <span className="text-amber-900">Knowledge Gap Findings</span>
                    <span className="font-mono font-semibold text-amber-900 tabular-nums">
                      {sourceSummary.knowledgeGapCount}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* New Chat & Recent Conversations */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900">Recent Conversations</p>
              <button
                type="button"
                onClick={handleNewChat}
                disabled={sending}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>

            {listData && listData.conversations.length > 0 ? (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                {listData.conversations.map((conv) => {
                  const isActive = activeConversation?.id === conv.id;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => handleSelectConversation(conv.id)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                        isActive
                          ? 'bg-blue-50 border-blue-200 text-blue-900'
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <p className="text-xs font-medium truncate">{conv.title}</p>
                      <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-slate-500">
                        <span className="font-mono tabular-nums">
                          {conv.messages.length} msgs
                        </span>
                        <span className="truncate">{formatDateTime(conv.updatedAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-1">
                No conversations yet for this project. Ask a question to start.
              </p>
            )}
          </div>
        </aside>

        {/* MAIN CHAT AREA */}
        <section
          className={`bg-white border border-slate-200 rounded-xl flex flex-col min-h-[580px] lg:h-[calc(100vh-11.5rem)] ${
            mobilePane === 'chat' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Chat Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <MessageSquare className="w-4 h-4 text-blue-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {activeConversation ? activeConversation.title : 'Project Evidence Q&A'}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  Scoped strictly to {currentProject ? `${currentProject.code} · ${currentProject.name}` : selectedProjectId}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded whitespace-nowrap shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
              Citation Verified
            </span>
          </div>

          {/* Messages Scroll Area */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-5 space-y-4"
          >
            {/* Welcome Card */}
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-start gap-2.5">
                <BookOpen className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs text-slate-700 leading-relaxed">
                  <p className="font-semibold text-slate-900">
                    Project-Scoped Handover Q&amp;A
                  </p>
                  <p>
                    Answers are grounded exclusively in retrieved sources, handover packs, and gap findings belonging to{' '}
                    <span className="font-medium text-slate-900">
                      {currentProject?.name ?? selectedProjectId}
                    </span>
                    . If evidence is missing, HandoverSync Q&amp;A will clearly say so instead of guessing.
                  </p>
                </div>
              </div>

              {!loadingList && !hasAnyEvidence && (
                <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">No usable project sources indexed yet.</p>
                    <p className="mt-0.5 text-amber-800">
                      Upload CSV, GitHub, Docs, or PDF sources on Project Activity to receive evidence-cited answers.
                    </p>
                  </div>
                </div>
              )}

              {/* Suggested Questions (explicitly framed as suggestions, not confirmed facts) */}
              {listData && listData.suggestedQuestions.length > 0 && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    Suggested Questions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {listData.suggestedQuestions.map((sq) => (
                      <button
                        key={sq}
                        type="button"
                        disabled={sending}
                        onClick={() => handleSubmitQuestion(sq)}
                        className="text-left px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-blue-50 hover:text-blue-800 hover:border-blue-200 border border-slate-200 rounded-md transition-colors disabled:opacity-50"
                      >
                        {sq}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {loadingConversation && (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                Loading conversation history...
              </div>
            )}

            {/* Conversation Messages */}
            {!loadingConversation &&
              activeConversation?.messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] bg-blue-700 text-white rounded-xl px-4 py-3 space-y-1">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <div className="flex items-center justify-end gap-2 text-[11px] text-blue-100">
                          <span>{msg.author}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatDateTime(msg.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                const isSelectedAnswer = selectedMessageId === msg.id;
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div
                      onClick={() => {
                        setSelectedCitationNum(null);
                        loadMessageEvidence(msg, selectedProjectId);
                      }}
                      className={`w-full max-w-[94%] rounded-xl border p-4 space-y-3 cursor-pointer transition-colors ${
                        msg.insufficientEvidence
                          ? 'bg-amber-50/50 border-amber-200'
                          : isSelectedAnswer
                            ? 'bg-white border-blue-300 ring-1 ring-blue-100'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{msg.author}</span>
                          {msg.insufficientEvidence ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-900 border border-amber-200 rounded">
                              Insufficient Evidence
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              {msg.citations.length} Citation{msg.citations.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500">
                          {formatDateTime(msg.createdAt)}
                        </span>
                      </div>

                      {/* Main Answer Text with Clickable Inline Citations */}
                      <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {renderTextWithCitations(
                          msg.content,
                          msg.citations,
                          isSelectedAnswer ? selectedCitationNum : null,
                          (num) => handleCitationClick(msg, num),
                        )}
                      </div>

                      {/* Structured Breakdown: Direct Evidence vs AI Interpretation */}
                      {msg.sections && msg.sections.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          {msg.sections.map((sec, idx) => (
                            <div
                              key={idx}
                              className={`p-3 rounded-lg border text-xs leading-relaxed ${
                                sec.kind === 'insufficient_evidence'
                                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                                  : sec.kind === 'interpretation'
                                    ? 'bg-slate-50 border-slate-200 text-slate-700'
                                    : 'bg-blue-50/40 border-blue-100 text-slate-800'
                              }`}
                            >
                              <p className="font-semibold text-slate-900 mb-1 flex items-center justify-between gap-2">
                                <span>{sec.heading}</span>
                                <span className="text-[10px] uppercase tracking-wider font-mono text-slate-500">
                                  {sec.kind === 'direct_evidence'
                                    ? 'Direct Evidence'
                                    : sec.kind === 'interpretation'
                                      ? 'AI Interpretation'
                                      : 'Missing Coverage'}
                                </span>
                              </p>
                              <p>
                                {renderTextWithCitations(
                                  sec.body,
                                  msg.citations,
                                  isSelectedAnswer ? selectedCitationNum : null,
                                  (num) => handleCitationClick(msg, num),
                                )}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.insufficientEvidence && msg.missingDetails && (
                        <p className="text-xs text-amber-900 bg-amber-100/60 border border-amber-200 rounded-md px-3 py-2">
                          Missing context: {msg.missingDetails}
                        </p>
                      )}

                      {/* Quick Citation Footer */}
                      {msg.citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                          <span className="text-[11px] font-medium text-slate-500 mr-1">
                            Sources:
                          </span>
                          {msg.citations.map((cit) => (
                            <button
                              key={cit.citationNumber}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCitationClick(msg, cit.citationNumber);
                              }}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${
                                isSelectedAnswer && selectedCitationNum === cit.citationNumber
                                  ? 'bg-blue-700 text-white border-blue-700'
                                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-200'
                              }`}
                            >
                              <span>[{cit.citationNumber}]</span>
                              <span className="truncate max-w-[160px]">{cit.fileName}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

            {sending && (
              <div className="flex items-center gap-2.5 p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700">
                <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" />
                Retrieving project evidence and verifying citations...
              </div>
            )}

            {errorMsg && (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Unable to answer question</p>
                  <p className="mt-0.5 text-red-800">{errorMsg}</p>
                </div>
              </div>
            )}
          </div>

          {/* Question Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitQuestion();
            }}
            className="p-4 border-t border-slate-200 bg-slate-50/70 rounded-b-xl"
          >
            <div className="flex items-end gap-2.5">
              <textarea
                rows={2}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitQuestion();
                  }
                }}
                placeholder={
                  currentProject
                    ? `Ask an evidence-grounded question about ${currentProject.name}...`
                    : 'Ask an evidence-grounded project question...'
                }
                disabled={sending}
                className="flex-1 px-3 py-2 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 resize-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !questionInput.trim()}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {sending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Press Enter to send · Shift+Enter for a new line. Every citation is verified against this project&apos;s sources.
            </p>
          </form>
        </section>

        {/* RIGHT EVIDENCE PANEL */}
        <aside
          className={`bg-white border border-slate-200 rounded-xl p-4 space-y-4 lg:max-h-[calc(100vh-11.5rem)] lg:overflow-y-auto ${
            mobilePane === 'evidence' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Evidence &amp; Citations</h2>
              <p className="text-xs text-slate-500">
                Sources supporting the selected answer
              </p>
            </div>
            {evidenceState.citations.length > 0 && (
              <span className="px-2 py-0.5 text-xs font-mono font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded tabular-nums">
                {evidenceState.citations.length}
              </span>
            )}
          </div>

          {evidenceState.loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
              Loading verified citations...
            </div>
          ) : evidenceState.error ? (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {evidenceState.error}
            </div>
          ) : evidenceState.citations.length === 0 ? (
            <div className="py-8 px-3 text-center space-y-2">
              <FileText className="w-6 h-6 text-slate-300 mx-auto" />
              <p className="text-xs font-medium text-slate-700">
                {selectedMessageId
                  ? 'No source citations for the selected message'
                  : 'Select an AI answer or ask a question'}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                When an answer cites project evidence, click any [1], [2] marker to inspect its exact snippet and origin here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {evidenceState.citations.map((cit) => {
                const isHighlighted = selectedCitationNum === cit.citationNumber;
                const matchedSource = evidenceState.sources.find((s) => s.id === cit.sourceId);
                return (
                  <div
                    key={cit.chunkId}
                    onClick={() => setSelectedCitationNum(cit.citationNumber)}
                    className={`p-3 rounded-lg border space-y-2 transition-colors ${
                      isHighlighted
                        ? 'bg-blue-50/70 border-blue-400 ring-1 ring-blue-200'
                        : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono font-semibold bg-blue-700 text-white rounded shrink-0">
                          [{cit.citationNumber}]
                        </span>
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {cit.sourceTitle}
                        </span>
                      </div>
                      <span className="text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                        {evidenceTypeLabel(cit.sourceType)}
                      </span>
                    </div>

                    {cit.isGapFinding && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 border border-amber-200 text-[11px] font-medium text-amber-900">
                        <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        Knowledge Gap Finding (not verified documentation)
                      </div>
                    )}

                    <div className="text-[11px] font-mono text-slate-600 break-all">
                      {cit.fileName} · {cit.locationIdentifier}
                    </div>

                    <blockquote className="text-xs text-slate-800 bg-white border border-slate-200 rounded p-2.5 leading-relaxed">
                      &ldquo;{cit.snippet}&rdquo;
                    </blockquote>

                    {cit.canOpenSource ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectSource(
                            matchedSource?.id ?? cit.sourceId,
                            `${cit.fileName} · ${cit.locationIdentifier}: ${cit.snippet}`,
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded-md transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Source
                      </button>
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        Generated project artifact metadata displayed above.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
