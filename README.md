# HandoverSync AI

> **Structured Knowledge Transfer & Human-Verified Project Handover Platform**

HandoverSync AI eliminates lost engineering context during role transitions and offboarding. It aggregates fragmented project activity—**CSV sprint trackers, GitHub issues & pull requests, and technical runbooks/PDFs**—into a structured, **source-cited Handover Pack**, then routes every AI draft through **human review, editing, and formal sign-off**.

---

## End-to-End Demo Flow

```text
Landing / Persona Login
  └──► Dashboard (Select Project)
         └──► Project Activity (CSV + GitHub + Docs/PDF Aggregation)
                └──► AI Handover Generation (Gemini Structured Extraction)
                       └──► Handover Pack (Summary, Tasks, Risks, Citations)
                              ├──► Pending Work Tracker (Task | Priority | Deadline | Status)
                              ├──► Key Files & Links Directory
                              └──► Human Review & Approve (Edit & Sign Off)
                                     └──► Handover History (Audit Ledger)
```

---

## Key Features

- **Multi-Source Activity Aggregation**: Combines CSV task exports, GitHub repository activity (issues, PRs, commits), and technical runbooks or uploaded `.csv`, `.txt`, `.md`, `.json`, and `.pdf` files in a unified project ledger.
- **Structured AI Extraction (`@google/genai`)**: Server-side Gemini agent (`gemini-4-hydrogen`) extracts:
  - Executive Project Summary & Architecture Context
  - Completed Tasks & Measurable Impact
  - Pending Work (`Task | Priority | Deadline | Status | Owner`)
  - Critical Deadlines & Milestones
  - Important Files, Repositories, Vault Paths & Links
  - Risks, Blockers & Mitigations
- **Source & Evidence Traceability**: Every extracted item includes an exact citation (e.g., `Source: GitHub Issue #24` or `sprint_46_payment_tasks.csv · Row PAY-404`). Clicking any citation opens an Evidence Inspector drawer showing the raw source snippet.
- **Human-in-the-Loop Verification**: AI never has final authority. Outgoing leads and incoming managers can edit summaries, modify/add/remove pending tasks, adjust priorities, request revisions, or formally approve and lock a handover version.
- **Audit History & Export**: Maintains a versioned archive of all generated and approved handover packs with Markdown (`.md`) export support.

---

## Project Structure

```text
handoversync-ai/
├── server.ts                      # Express API server + Vite middleware
├── server/
│   ├── aiAgent.ts                 # Server-side @google/genai structured extraction
│   ├── db.ts                      # Persistent JSON storage layer (auto-seeded)
│   └── seedData.ts                # Pre-seeded engineering handover projects & sources
├── src/
│   ├── App.tsx                    # Root state & 9-screen workflow router
│   ├── main.tsx                   # React entry point
│   ├── index.css                  # Tailwind v4 & typography tokens
│   ├── types.ts                   # Shared TypeScript interfaces
│   ├── lib/
│   │   └── api.ts                 # Typed API client & Markdown export helpers
│   ├── assets/images/             # Team persona avatars
│   └── components/
│       ├── AppShell.tsx           # Sidebar workspace layout & breadcrumb top bar
│       ├── LandingLoginScreen.tsx # Screen 1: Landing & Persona Login
│       ├── DashboardScreen.tsx    # Screen 2: Handover Overview & Project Selector
│       ├── ProjectActivityScreen.tsx # Screen 3: Multi-source aggregation & file upload
│       ├── AiGenerationScreen.tsx # Screen 4: AI processing pipeline
│       ├── HandoverPackScreen.tsx # Screen 5: Structured dossier & source citations
│       ├── PendingWorkScreen.tsx  # Screen 6: Filterable Pending Work Tracker
│       ├── KeyFilesScreen.tsx     # Screen 7: Key Files & Links directory
│       ├── ReviewApproveScreen.tsx# Screen 8: Human editing & formal sign-off
│       ├── HandoverHistoryScreen.tsx # Screen 9: Versioned audit ledger
│       └── StatusPrimitives.tsx   # Badges, citations & Source Evidence Drawer
├── .env.example                   # Environment template
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Backend**: Node.js, Express, `tsx`
- **AI Engine**: Google `@google/genai` SDK (`gemini-4-hydrogen` with JSON `responseSchema` & multimodal PDF support)
- **Persistence**: Local JSON persistence (`data/handoversync_db.json`, auto-seeded on first run; gitignored so every clone starts clean)

---

## Local Setup & Running

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Set your Gemini API key inside `.env`:
   ```env
   GEMINI_API_KEY="your_gemini_api_key_here"
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Production build & start**
   ```bash
   npm run build
   NODE_ENV=production npm start
   ```

---

## API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/projects` | List all handover projects with source & status summaries |
| `GET` | `/api/projects/:id` | Fetch project details, aggregated sources, and handover packs |
| `POST` | `/api/projects/:id/sources` | Upload/add a new CSV, TXT, MD, JSON, or PDF source |
| `DELETE` | `/api/projects/:id/sources/:sourceId` | Remove an aggregated source |
| `POST` | `/api/generate-handover` | Run Gemini AI extraction over selected project sources |
| `PATCH` | `/api/handovers/:handoverId` | Save human edits to summary, pending tasks, or risks |
| `POST` | `/api/handovers/:handoverId/approve` | Record human approval or revision request |
| `GET` | `/api/history` | Retrieve versioned handover audit history across projects |
