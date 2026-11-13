import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, FileSpreadsheet, GitBranch, Layers, ShieldCheck } from 'lucide-react';
import type { UserRole, UserSession } from '../types';

const AVATAR_OUTGOING = '/src/assets/images/avatar_outgoing_lead_1794554951514.jpg';
const AVATAR_INCOMING = '/src/assets/images/avatar_incoming_manager_1794554951308.jpg';

const PERSONAS: Record<UserRole, UserSession> = {
  outgoing_lead: {
    name: 'Arjun Mehta',
    email: 'arjun.mehta@company.io',
    role: 'outgoing_lead',
    roleLabel: 'Outgoing Lead Engineer',
    avatar: AVATAR_OUTGOING,
  },
  incoming_manager: {
    name: 'Priya Nair',
    email: 'priya.nair@company.io',
    role: 'incoming_manager',
    roleLabel: 'Incoming Engineering Manager',
    avatar: AVATAR_INCOMING,
  },
  engineering_director: {
    name: 'Priya Nair',
    email: 'director.ops@company.io',
    role: 'engineering_director',
    roleLabel: 'VP Engineering Reviewer',
    avatar: AVATAR_INCOMING,
  },
};

export function LandingLoginScreen({
  onLogin,
}: {
  onLogin: (session: UserSession) => void;
}) {
  const [selectedRole, setSelectedRole] = useState<UserRole>('outgoing_lead');
  const [customEmail, setCustomEmail] = useState('arjun.mehta@company.io');

  const handleRoleChange = (role: UserRole) => {
    setSelectedRole(role);
    setCustomEmail(PERSONAS[role].email);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const base = PERSONAS[selectedRole];
    onLogin({
      ...base,
      email: customEmail.trim() || base.email,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 px-6 lg:px-10 py-4 flex items-center justify-between gap-8">
        <a
          href="#top"
          className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
        >
          HandoverSync AI
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a href="#workflow" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Workflow
          </a>
          <a href="#sources" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Sources
          </a>
          <a href="#traceability" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Traceability
          </a>
          <a href="#review-flow" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Human Review
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onLogin(PERSONAS[selectedRole])}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2"
          >
            Open Workspace
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Split Hero */}
      <main id="top" className="flex-1 max-w-6xl w-full mx-auto px-6 lg:px-10 py-12 lg:py-16">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          {/* Left Narrative */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-8">
            <div className="space-y-5">
              <p className="text-sm font-medium text-blue-700">
                Engineering Knowledge Transfer · Source-Verified Handovers
              </p>
              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]"
                style={{ textWrap: 'balance' }}
              >
                Turn scattered project activity into verified handover packs.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                When engineers transition off critical systems, crucial context sits fragmented across sprint CSVs, GitHub issues, and runbooks. HandoverSync AI aggregates multi-source records, drafts structured handover dossiers with line-level source citations, and routes every pack through human verification before sign-off.
              </p>
            </div>

            {/* Mechanism-to-Outcome Chain */}
            <div id="workflow" className="grid sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <Layers className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>01. Aggregate</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Combine CSV trackers, GitHub PRs/issues, and PDF or text runbooks into one project ledger.
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <GitBranch className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>02. Cite Evidence</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Every pending task, deadline, and risk links directly back to its origin (e.g., GitHub Issue #24).
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>03. Human Sign-Off</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Outgoing leads and incoming managers edit, correct, and formally approve before archiving.
                </p>
              </div>
            </div>
          </div>

          {/* Right Workspace Login Card */}
          <div className="lg:col-span-5 flex">
            <form
              onSubmit={handleSubmit}
              className="w-full bg-white border border-slate-200 rounded-xl p-6 lg:p-8 flex flex-col justify-between space-y-6"
            >
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Sign in to Workspace</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Select a handover persona to walk through the complete 9-screen demo flow.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Workspace Persona
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {(
                      [
                        {
                          id: 'outgoing_lead',
                          title: 'Outgoing Lead — Arjun Mehta',
                          desc: 'Aggregate sources, generate handover pack, and submit for review',
                        },
                        {
                          id: 'incoming_manager',
                          title: 'Incoming Manager — Priya Nair',
                          desc: 'Inspect pending work, verify source citations, edit & approve pack',
                        },
                        {
                          id: 'engineering_director',
                          title: 'Director Reviewer — Audit View',
                          desc: 'Inspect handover history, readiness compliance, and sign-offs',
                        },
                      ] as const
                    ).map((option) => {
                      const active = selectedRole === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleRoleChange(option.id)}
                          className={`text-left p-3.5 rounded-lg border transition-colors ${
                            active
                              ? 'border-blue-700 bg-blue-50/50'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {option.title}
                            </span>
                            {active && <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0" />}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{option.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="workspace-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Work Email
                  </label>
                  <input
                    id="workspace-email"
                    type="email"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:border-blue-700"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Continue to Handover Dashboard
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Bottom Feature Proof Strip */}
        <section
          id="sources"
          className="mt-12 pt-8 border-t border-slate-200 grid sm:grid-cols-3 gap-8 text-sm"
        >
          <div id="traceability" className="space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <FileSpreadsheet className="w-4 h-4 text-slate-500" />
              <span>Multi-Format Ingestion</span>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed">
              Upload CSV sprint boards, Markdown or text runbooks, GitHub JSON exports, and PDF architecture docs.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <GitBranch className="w-4 h-4 text-slate-500" />
              <span>Evidence-First Extraction</span>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed">
              Click any extracted task, risk, or deadline to inspect the exact underlying issue or CSV row in a side drawer.
            </p>
          </div>
          <div id="review-flow" className="space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-slate-500" />
              <span>Immutable Approval Ledger</span>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed">
              Human reviewers override AI drafts, record verification notes, and lock signed snapshots in Handover History.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
