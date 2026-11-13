import React from 'react';
import {
  Activity,
  ArrowRight,
  CheckSquare,
  ChevronRight,
  FolderOpen,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import type { ProjectSummaryDTO, ScreenId, UserSession } from '../types';

interface NavItem {
  id: Exclude<ScreenId, 'landing'>;
  label: string;
  stepNum: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', stepNum: '01', icon: LayoutDashboard },
  { id: 'activity', label: 'Project Activity', stepNum: '02', icon: Activity },
  { id: 'generate', label: 'AI Generation', stepNum: '03', icon: Sparkles },
  { id: 'pack', label: 'Handover Pack', stepNum: '04', icon: PackageCheck },
  { id: 'pending', label: 'Pending Work', stepNum: '05', icon: CheckSquare },
  { id: 'files', label: 'Key Files', stepNum: '06', icon: FolderOpen },
  { id: 'review', label: 'Review & Approve', stepNum: '07', icon: UserCheck },
  { id: 'history', label: 'Handover History', stepNum: '08', icon: History },
];

export function AppShell({
  activeScreen,
  onNavigate,
  session,
  onSignOut,
  projects,
  selectedProjectId,
  onSelectProject,
  primaryAction,
  children,
}: {
  activeScreen: Exclude<ScreenId, 'landing'>;
  onNavigate: (screen: Exclude<ScreenId, 'landing'>) => void;
  session: UserSession;
  onSignOut: () => void;
  projects: ProjectSummaryDTO[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  children: React.ReactNode;
}) {
  const currentProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  const currentNav = NAV_ITEMS.find((n) => n.id === activeScreen);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Left Workspace Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-slate-200">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="text-base font-bold tracking-tight text-slate-900 font-display whitespace-nowrap text-left"
          >
            HandoverSync AI
          </button>
        </div>

        {/* Active Project Context Selector */}
        {projects.length > 0 && (
          <div className="px-4 py-3.5 border-b border-slate-200">
            <label
              htmlFor="sidebar-project-select"
              className="block text-xs font-medium text-slate-500 mb-1.5"
            >
              Active Handover Project
            </label>
            <select
              id="sidebar-project-select"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              className="w-full px-2.5 py-2 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700 truncate"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Workflow Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-800 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-blue-700' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${
                    isActive ? 'text-blue-600' : 'text-slate-400'
                  }`}
                >
                  {item.stepNum}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Signed-in User Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={session.avatar}
              alt={session.name}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 truncate">{session.name}</p>
              <p className="text-xs text-slate-500 truncate">{session.roleLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Switch Persona / Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Contextual Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 lg:px-8 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Projects
            </button>
            {currentProject && activeScreen !== 'dashboard' && activeScreen !== 'history' && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                <span className="font-medium text-slate-700 truncate max-w-[260px]">
                  {currentProject.name}
                </span>
              </>
            )}
            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            <span className="font-semibold text-slate-900 whitespace-nowrap shrink-0">
              {currentNav?.label}
            </span>
          </div>

          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {primaryAction.label}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </header>

        {/* Scrollable Screen Viewport */}
        <main className="flex-1 p-6 lg:p-8 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
