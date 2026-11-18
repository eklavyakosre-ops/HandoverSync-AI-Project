import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  Send,
  Trash2,
  User,
} from 'lucide-react';
import type {
  BotConversationsListResponse,
  ProjectSummaryDTO,
  QaCitation,
  QaConversation,
  ScreenId,
  UserSession,
} from '../types';
import {
  createBotConversation,
  deleteBotConversation,
  fetchBotConversations,
  sendBotMessage,
} from '../lib/api';
import { formatDateTime, formatShortDate } from './StatusPrimitives';

function renderBotTextWithCitations(
  text: string,
  citations: QaCitation[],
  onInspectCitation: (citation: QaCitation) => void,
) {
  const byNumber = new Map(citations.map((c) => [c.citationNumber, c]));
  const parts = text.split(/(\[\d+\])/g);

  return parts.map((part, idx) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) {
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    }
    const num = Number(match[1]);
    const citation = byNumber.get(num);
    if (!citation) {
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    }
    return (
      <button
        key={idx}
        type="button"
        onClick={() => onInspectCitation(citation)}
        className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-mono font-semibold rounded border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 align-baseline transition-colors"
        title={`${citation.sourceTitle} · ${citation.locationIdentifier}`}
      >
        [{num}]
      </button>
    );
  });
}

export function SyncBotScreen({
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

  const [listData, setListData] = useState<BotConversationsListResponse | null>(null);
  const [activeConversation, setActiveConversation] = useState<QaConversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<{
    messageId: string;
    citation: QaCitation;
  } | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const loadBotChats = useCallback(async (projectId: string, preferredConvId?: string) => {
    if (!projectId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchBotConversations(projectId);
      setListData(res);
      const matched =
        (preferredConvId
          ? res.conversations.find((c) => c.id === preferredConvId)
          : undefined) ??
        res.conversations[0] ??
        null;
      setActiveConversation(matched);
      setActiveCitation(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load SyncBot chats.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    setActiveConversation(null);
    setActiveCitation(null);
    void loadBotChats(selectedProjectId);
  }, [selectedProjectId, loadBotChats]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if ((activeConversation?.messages.length ?? 0) === 0 && !sending && !errorMsg) {
      return;
    }
    const frameId = requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeConversation?.id, activeConversation?.messages.length, sending, errorMsg]);

  const handleNewChat = async () => {
    if (!currentProject || sending) return;
    setErrorMsg(null);
    try {
      const created = await createBotConversation(currentProject.id, {
        createdBy: session.name,
      });
      setListData((prev) =>
        prev ? { ...prev, conversations: [created, ...prev.conversations] } : prev,
      );
      setActiveConversation(created);
      setActiveCitation(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start a new SyncBot chat.');
    }
  };

  const handleDeleteChat = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentProject || sending) return;
    setErrorMsg(null);
    try {
      await deleteBotConversation(convId, currentProject.id);
      const remaining = (listData?.conversations ?? []).filter((c) => c.id !== convId);
      setListData((prev) => (prev ? { ...prev, conversations: remaining } : prev));
      if (activeConversation?.id === convId) {
        setActiveConversation(remaining[0] ?? null);
        setActiveCitation(null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete chat.');
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? messageInput).trim();
    if (!text || !currentProject || sending) return;

    setSending(true);
    setErrorMsg(null);
    if (!overrideText) setMessageInput('');

    try {
      let targetConv = activeConversation;
      if (!targetConv) {
        targetConv = await createBotConversation(currentProject.id, {
          createdBy: session.name,
        });
      }

      const result = await sendBotMessage(targetConv.id, {
        projectId: currentProject.id,
        message: text,
        author: session.name,
      });

      setActiveConversation(result.conversation);
      setListData((prev) => {
        if (!prev) return prev;
        const without = prev.conversations.filter((c) => c.id !== result.conversation.id);
        return {
          ...prev,
          conversations: [result.conversation, ...without],
        };
      });
    } catch (err) {
      if (!overrideText) setMessageInput(text);
      setErrorMsg(
        err instanceof Error ? err.message : 'SyncBot could not complete your request.',
      );
    } finally {
      setSending(false);
    }
  };

  const handleInspectCitation = (messageId: string, citation: QaCitation) => {
    if (citation.canOpenSource) {
      onInspectSource(citation.sourceId, `${citation.sourceTitle} · ${citation.locationIdentifier}`);
    } else {
      setActiveCitation({ messageId, citation });
    }
  };

  const summary = listData?.projectContextSummary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              SyncBot — Project Chat Assistant
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              Dedicated conversational chatbot that answers anything about the selected project using its sources, handover pack, gaps, and integrations.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('activity')}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5"
        >
          <BookOpen className="w-3.5 h-3.5 text-slate-500" />
          Inspect Project Sources
        </button>
      </div>

      {/* Main Split Workspace */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Left Context & Chat History Sidebar */}
        <aside className="lg:col-span-4 space-y-4">
          {/* Active Project Context Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="syncbot-project-select"
                className="block text-xs font-medium text-slate-500"
              >
                Project Context
              </label>
              <select
                id="syncbot-project-select"
                value={selectedProjectId}
                onChange={(e) => onSelectProject(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </div>

            {currentProject && (
              <div className="space-y-2.5 pt-2 border-t border-slate-100 text-xs">
                <p className="text-slate-600 leading-relaxed">{currentProject.description}</p>
                <div className="grid grid-cols-2 gap-2 pt-1 text-slate-600">
                  <div>
                    <span className="text-slate-400 block">Outgoing Lead</span>
                    <span className="font-medium text-slate-900">{currentProject.outgoingLead.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Incoming Owner</span>
                    <span className="font-medium text-slate-900">{currentProject.incomingOwner.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Target Exit</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      {formatShortDate(currentProject.targetExitDate)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Health State</span>
                    <span className="font-medium text-slate-900">{currentProject.healthState}</span>
                  </div>
                </div>

                {summary && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 tabular-nums font-mono">
                    <span>{summary.totalSources} sources</span>
                    <span aria-hidden="true">·</span>
                    <span>{summary.pendingTaskCount} pending tasks</span>
                    <span aria-hidden="true">·</span>
                    <span>{summary.openGapCount} open gaps</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Saved SyncBot Conversations */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">SyncBot History</h2>
              <button
                type="button"
                onClick={() => void handleNewChat()}
                disabled={sending || !currentProject}
                className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>

            {loading ? (
              <div className="p-4 space-y-2">
                <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            ) : (listData?.conversations.length ?? 0) === 0 ? (
              <div className="p-5 text-xs text-slate-500 text-center">
                No chats yet for this project. Ask SyncBot a question on the right to begin.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {listData?.conversations.map((conv) => {
                  const isActive = activeConversation?.id === conv.id;
                  return (
                    <div
                      key={conv.id}
                      onClick={() => {
                        setActiveConversation(conv);
                        setActiveCitation(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveConversation(conv);
                          setActiveCitation(null);
                        }
                      }}
                      className={`px-4 py-3 flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                        isActive ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p
                          className={`text-xs font-medium truncate ${
                            isActive ? 'text-blue-900' : 'text-slate-800'
                          }`}
                        >
                          {conv.title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {conv.messages.length} msgs · {formatDateTime(conv.updatedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => void handleDeleteChat(conv.id, e)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                        title="Delete chat"
                        aria-label="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Right Dedicated SyncBot Chat Area */}
        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl flex flex-col h-[660px] overflow-hidden">
          {/* Chat Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <Bot className="w-4 h-4 text-blue-700 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 truncate">
                  SyncBot · {currentProject?.code} {currentProject?.name}
                </h2>
                <p className="text-xs text-slate-500 truncate">
                  Ask in English, Hindi, or Hinglish about tasks, architecture, risks, files, or handover status
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleNewChat()}
              disabled={sending || !currentProject}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Start Fresh
            </button>
          </div>

          {/* Messages Viewport */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/40"
          >
            {(activeConversation?.messages.length ?? 0) === 0 ? (
              <div className="h-full flex flex-col justify-center max-w-xl mx-auto space-y-5 py-6">
                <div className="space-y-2 text-center">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center mx-auto">
                    <Bot className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Hi {session.name.split(' ')[0]}, I&apos;m SyncBot!
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Ask me anything about <strong>{currentProject?.name}</strong> — pending work, deadlines, GitHub issues, runbooks, knowledge gaps, or who owns what. Every answer is grounded in your project data.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500 text-center">
                    Try asking SyncBot
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {(listData?.suggestedPrompts ?? []).map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={sending}
                        onClick={() => void handleSend(prompt)}
                        className="text-left p-3 text-xs text-slate-700 bg-white hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-lg transition-colors leading-relaxed"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              activeConversation?.messages.map((msg) => {
                const isUser = msg.role === 'user';
                if (isUser) {
                  return (
                    <div key={msg.id} className="flex justify-end gap-2.5">
                      <div className="max-w-[82%] bg-blue-700 text-white rounded-xl px-4 py-3 text-sm leading-relaxed">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-[11px] text-blue-100 mt-1.5 text-right tabular-nums">
                          {msg.author} · {formatDateTime(msg.createdAt)}
                        </p>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mt-1">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="max-w-[88%] bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-sm text-slate-800">
                      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                        <span className="font-semibold text-slate-900">SyncBot</span>
                        <span className="tabular-nums">{formatDateTime(msg.createdAt)}</span>
                      </div>

                      <div className="leading-relaxed whitespace-pre-wrap">
                        {renderBotTextWithCitations(msg.content, msg.citations, (cit) =>
                          handleInspectCitation(msg.id, cit),
                        )}
                      </div>

                      {msg.sections && msg.sections.length > 0 && (
                        <div className="space-y-2.5 pt-2 border-t border-slate-100">
                          {msg.sections.map((sec, idx) => (
                            <div
                              key={idx}
                              className={`p-3 rounded-lg border text-xs space-y-1 ${
                                sec.kind === 'insufficient_evidence'
                                  ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
                              }`}
                            >
                              <p className="font-semibold text-slate-900">{sec.heading}</p>
                              <div className="whitespace-pre-wrap leading-relaxed">
                                {renderBotTextWithCitations(sec.body, msg.citations, (cit) =>
                                  handleInspectCitation(msg.id, cit),
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.citations.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-500">
                            Referenced Project Records ({msg.citations.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.citations.map((cit) => (
                              <button
                                key={cit.citationNumber}
                                type="button"
                                onClick={() => handleInspectCitation(msg.id, cit)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono text-blue-700 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded transition-colors max-w-full"
                              >
                                <span className="font-semibold">[{cit.citationNumber}]</span>
                                <span className="truncate max-w-[220px]">
                                  {cit.locationIdentifier}
                                </span>
                                {cit.canOpenSource && <ExternalLink className="w-3 h-3 shrink-0" />}
                              </button>
                            ))}
                          </div>

                          {activeCitation?.messageId === msg.id && (
                            <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900">
                                  [{activeCitation.citation.citationNumber}]{' '}
                                  {activeCitation.citation.sourceTitle}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveCitation(null)}
                                  className="text-[11px] text-slate-500 hover:text-slate-900"
                                >
                                  Hide
                                </button>
                              </div>
                              <p className="text-slate-600 font-mono text-[11px]">
                                {activeCitation.citation.locationIdentifier}
                              </p>
                              <p className="text-slate-700 leading-relaxed">
                                &ldquo;{activeCitation.citation.snippet}&rdquo;
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {sending && (
              <div className="flex items-center gap-2.5 text-xs text-slate-600">
                <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </div>
                <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                  SyncBot is analyzing project sources...
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-900">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="p-4 border-t border-slate-200 bg-white shrink-0"
          >
            <div className="flex items-end gap-2.5">
              <textarea
                rows={2}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Ask SyncBot anything about ${currentProject?.name ?? 'this project'}... (Press Enter to send)`}
                disabled={sending || !currentProject}
                className="flex-1 px-3.5 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !messageInput.trim() || !currentProject}
                className="px-4 py-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 h-[42px]"
              >
                {sending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Ask SyncBot
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
