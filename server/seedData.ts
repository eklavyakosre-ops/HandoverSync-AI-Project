import type { HandoverDatabase } from '../src/types.ts';

const AVATAR_OUTGOING = '/src/assets/images/avatar_outgoing_lead_1794554951514.jpg';
const AVATAR_INCOMING = '/src/assets/images/avatar_incoming_manager_1794554951308.jpg';

export function createSeedDatabase(): HandoverDatabase {
  return {
    projects: [
      {
        id: 'proj-checkout-v3',
        name: 'Checkout & Payment Gateway v3',
        code: 'PAY-304',
        department: 'Core Commerce Infrastructure',
        description:
          'Migration of legacy synchronous Stripe charge pipeline to idempotent PaymentIntents with multi-currency webhook reconciliation and automated retry queues.',
        outgoingLead: {
          name: 'Arjun Mehta',
          role: 'Staff Payments Engineer',
          email: 'arjun.mehta@company.io',
          avatar: AVATAR_OUTGOING,
        },
        incomingOwner: {
          name: 'Priya Nair',
          role: 'Engineering Manager, Billing',
          email: 'priya.nair@company.io',
          avatar: AVATAR_INCOMING,
        },
        targetExitDate: '2026-11-21',
        healthState: 'Drafting',
        updatedAt: '2026-11-12T18:10:00Z',
      },
      {
        id: 'proj-sso-rbac',
        name: 'Enterprise SSO & RBAC Migration',
        code: 'IAM-219',
        department: 'Identity & Platform Security',
        description:
          'Rollout of SAML 2.0 enterprise tenant provisioning, SCIM directory sync, and fine-grained workspace role claims across customer admin portals.',
        outgoingLead: {
          name: 'Arjun Mehta',
          role: 'Staff Platform Engineer',
          email: 'arjun.mehta@company.io',
          avatar: AVATAR_OUTGOING,
        },
        incomingOwner: {
          name: 'Priya Nair',
          role: 'Engineering Manager, Security',
          email: 'priya.nair@company.io',
          avatar: AVATAR_INCOMING,
        },
        targetExitDate: '2026-11-28',
        healthState: 'Ready for Review',
        updatedAt: '2026-11-12T14:40:00Z',
      },
      {
        id: 'proj-telemetry-pipe',
        name: 'Realtime Telemetry Ingestion Pipeline',
        code: 'OBS-112',
        department: 'Observability & Data Platform',
        description:
          'Kafka consumer group rebalancing and ClickHouse batch sink optimization for sub-second event ingestion across 42 production edge regions.',
        outgoingLead: {
          name: 'Arjun Mehta',
          role: 'Principal Data Engineer',
          email: 'arjun.mehta@company.io',
          avatar: AVATAR_OUTGOING,
        },
        incomingOwner: {
          name: 'Priya Nair',
          role: 'Engineering Manager, Data',
          email: 'priya.nair@company.io',
          avatar: AVATAR_INCOMING,
        },
        targetExitDate: '2026-11-15',
        healthState: 'Approved',
        updatedAt: '2026-11-10T16:25:00Z',
      },
    ],
    sources: [
      // Project 1: Checkout & Payment Gateway v3 (3 distinct sources)
      {
        id: 'src-pay-csv',
        projectId: 'proj-checkout-v3',
        title: 'Sprint 46 Payment Migration Tracker',
        kind: 'csv',
        fileName: 'sprint_46_payment_tasks.csv',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-12T10:15:00Z',
        recordCount: 6,
        highlights: [
          'PAY-401 Completed: Idempotency key middleware deployed to staging',
          'PAY-404 Pending (Critical): Payment API testing under 3DS challenge flow',
          'PAY-406 Blocked: EU VAT invoice PDF webhook timeout fix due 2026-11-18',
        ],
        content: `task_id,title,owner,priority,status,deadline,notes
PAY-401,Implement Redis idempotency key middleware for PaymentIntents,Arjun Mehta,High,Completed,2026-11-05,Deployed to staging and verified with 500 concurrent replays
PAY-402,Migrate USD and EUR settlement ledger tables to v3 schema,Arjun Mehta,High,Completed,2026-11-08,Zero-downtime backfill completed via shadow writes
PAY-403,Configure Dead Letter Queue alerts in PagerDuty for webhook failures,Rohan Verma,Medium,Completed,2026-11-10,Alert threshold set to >5 retries in 10m
PAY-404,Payment API testing across 3DS2 challenge and partial refund flows,Arjun Mehta,Critical,In Progress,2026-11-16,Sandbox tests passing 84%; card-declined edge cases pending
PAY-405,Cutover production checkout traffic from v2 to v3 canary (10% -> 100%),Priya Nair,Critical,Not Started,2026-11-20,Requires sign-off on PAY-404 and load test report
PAY-406,Fix EU VAT invoice PDF generation timeout on webhook callback,Rohan Verma,High,Blocked,2026-11-18,Blocked on upstream tax microservice v2.4 release`,
      },
      {
        id: 'src-pay-github',
        projectId: 'proj-checkout-v3',
        title: 'GitHub Repository Activity (commerce/payment-gateway)',
        kind: 'github',
        fileName: 'github_payment_gateway_activity.json',
        addedBy: 'GitHub Sync Connector',
        addedAt: '2026-11-12T15:30:00Z',
        recordCount: 4,
        highlights: [
          'GitHub Issue #24 (Open, Critical): Payment API testing & 3DS2 fallback race condition',
          'GitHub PR #142 (Merged): Idempotent Stripe webhook consumer with exponential backoff',
          'GitHub Issue #27 (Open, High): Legacy v2 feature flag cleanup after Nov 20 cutover',
        ],
        content: JSON.stringify(
          {
            repository: 'github.com/acme-commerce/payment-gateway',
            branch: 'release/v3-payment-intents',
            issues: [
              {
                number: 24,
                title: 'Payment API testing: 3DS2 challenge callback race condition under high latency',
                state: 'open',
                priority: 'Critical',
                assignee: 'arjun-mehta',
                deadline: '2026-11-16',
                url: 'https://github.com/acme-commerce/payment-gateway/issues/24',
                body: 'When Stripe webhook payment_intent.succeeded arrives before frontend redirect completes, /api/v3/checkout/confirm returns HTTP 409. Integration test suite in tests/e2e/3ds_flow.spec.ts needs deterministic lock verification before Nov 20 production cutover.',
              },
              {
                number: 27,
                title: 'Decommission v2 synchronous charge endpoints & rotate webhook signing secret',
                state: 'open',
                priority: 'High',
                assignee: 'priya-nair',
                deadline: '2026-11-25',
                url: 'https://github.com/acme-commerce/payment-gateway/issues/27',
                body: 'Remove ENABLE_LEGACY_CHARGE_V2 flag 72 hours after 100% traffic cutover and rotate STRIPE_WEBHOOK_SECRET_V2 in Vault.',
              },
            ],
            pullRequests: [
              {
                number: 142,
                title: 'feat(webhooks): idempotent Stripe event deduplication via Redis SETNX',
                state: 'merged',
                mergedAt: '2026-11-09T14:22:00Z',
                author: 'arjun-mehta',
                url: 'https://github.com/acme-commerce/payment-gateway/pull/142',
                filesChanged: ['src/webhooks/stripeConsumer.ts', 'src/lib/idempotencyLock.ts'],
              },
              {
                number: 148,
                title: 'fix(refunds): handle partial multi-currency rounding discrepancy in EUR ledger',
                state: 'open',
                author: 'arjun-mehta',
                url: 'https://github.com/acme-commerce/payment-gateway/pull/148',
                reviewStatus: 'Changes Requested — needs QA fixture update',
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        id: 'src-pay-docs',
        projectId: 'proj-checkout-v3',
        title: 'Payment Gateway v3 Architecture & Runbook Notes',
        kind: 'docs',
        fileName: 'payment_v3_handover_runbook.txt',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-12T17:45:00Z',
        recordCount: 4,
        highlights: [
          'Vault Secret Path: secret/prod/payments/stripe-v3-keys (rotation owner: Priya Nair)',
          'Rollback Procedure: Toggle launchdarkly flag checkout-v3-canary back to 0%',
          'On-Call Escalation: Grafana Dashboard /d/pay-v3-latency & Datadog APM service payment-gateway',
        ],
        content: `PAYMENT GATEWAY V3 — OUTGOING ENGINEER HANDOVER RUNBOOK
Author: Arjun Mehta | Target Exit: 2026-11-21 | Receiving Manager: Priya Nair

1. SYSTEM OVERVIEW & KEY INFRASTRUCTURE
- Service Repo: https://github.com/acme-commerce/payment-gateway
- Production Grafana Dashboard: https://grafana.internal/d/pay-v3-latency
- LaunchDarkly Feature Flag: checkout-v3-canary (currently 0% prod, 100% staging)
- Secrets & Signing Keys: Stored in HashiCorp Vault under secret/prod/payments/stripe-v3-keys. Do NOT reuse v2 webhook secret on v3 endpoints.

2. CRITICAL UNFINISHED ITEMS & GOTCHAS
- Payment API testing (tracked in GitHub Issue #24) is the #1 blocker before production cutover. Specifically, the 3DS2 redirect + webhook race condition reproduces roughly 1 in 40 calls when simulated latency > 800ms.
- Partial EUR refunds in PR #148 have a 1-cent rounding mismatch when currency conversion uses cached ECB rates instead of Stripe settlement_rate. Needs review and merge by Nov 17.
- EU VAT Invoice generation (PAY-406) depends on the Tax team releasing v2.4 of tax-invoicing-svc. Follow up with Maya Lin (Tax Eng Lead) on Slack #proj-tax-v2.

3. ROLLBACK PLAYBOOK
- If p99 checkout latency exceeds 1200ms or webhook failure rate exceeds 0.5%, immediately revert LaunchDarkly flag checkout-v3-canary to 0%. Shadow ledger writes are safe to keep enabled during rollback.`,
      },

      // Project 2: Enterprise SSO & RBAC Migration
      {
        id: 'src-sso-csv',
        projectId: 'proj-sso-rbac',
        title: 'Enterprise Tenant SAML Rollout Sheet',
        kind: 'csv',
        fileName: 'sso_tenant_rollout.csv',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-11T09:00:00Z',
        recordCount: 4,
        highlights: [
          'IAM-101 Completed: Okta SAML metadata parser shipped',
          'IAM-104 Pending (High): SCIM group deprovisioning audit for Meridian Corp',
        ],
        content: `task_id,title,owner,priority,status,deadline,notes
IAM-101,Build multi-tenant Okta SAML 2.0 assertion verifier,Arjun Mehta,High,Completed,2026-11-02,Verified against 14 enterprise sandboxes
IAM-102,Migrate legacy role strings to RBAC policy claims,Arjun Mehta,High,Completed,2026-11-07,Backfill script ran cleanly on 120k users
IAM-103,Implement SCIM 2.0 group deprovisioning webhook audit,Arjun Mehta,High,In Progress,2026-11-19,Meridian Corp sandbox failing on nested AD groups
IAM-104,Complete SOC2 access-control evidence export for Q4 audit,Priya Nair,Critical,Not Started,2026-11-26,Export script located at scripts/soc2_rbac_dump.ts`,
      },
      {
        id: 'src-sso-github',
        projectId: 'proj-sso-rbac',
        title: 'GitHub Activity (platform/iam-service)',
        kind: 'github',
        fileName: 'github_iam_activity.json',
        addedBy: 'GitHub Sync Connector',
        addedAt: '2026-11-12T11:20:00Z',
        recordCount: 2,
        highlights: [
          'GitHub PR #118 (Open): Nested Active Directory group flattening for SCIM sync',
          'GitHub Issue #61 (Open): Enforce 15-minute token TTL for admin impersonation sessions',
        ],
        content: JSON.stringify(
          {
            repository: 'github.com/acme-platform/iam-service',
            issues: [
              {
                number: 61,
                title: 'Enforce 15-minute JWT TTL on support impersonation tokens',
                state: 'open',
                priority: 'High',
                deadline: '2026-11-22',
                url: 'https://github.com/acme-platform/iam-service/issues/61',
                body: 'Current impersonation tokens inherit standard 8h session TTL. Security compliance requires strict 15m TTL before Dec audit.',
              },
            ],
            pullRequests: [
              {
                number: 118,
                title: 'feat(scim): flatten nested AD security groups up to depth 4',
                state: 'open',
                author: 'arjun-mehta',
                url: 'https://github.com/acme-platform/iam-service/pull/118',
              },
            ],
          },
          null,
          2,
        ),
      },
      {
        id: 'src-sso-docs',
        projectId: 'proj-sso-rbac',
        title: 'IAM RBAC Migration Notes',
        kind: 'docs',
        fileName: 'iam_rbac_handover_notes.txt',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-12T12:00:00Z',
        recordCount: 2,
        highlights: [
          'Key Config: configs/rbac_policies.yaml maps 18 legacy permissions to 6 role tiers',
        ],
        content: `IAM & RBAC HANDOVER BRIEF
Repository: https://github.com/acme-platform/iam-service
Key Policy File: configs/rbac_policies.yaml
SOC2 Export Script: scripts/soc2_rbac_dump.ts

Open Risk: Meridian Corp uses 3 levels of nested Active Directory groups. PR #118 addresses this but still needs integration testing against their Azure AD test tenant before Nov 19.`,
      },

      // Project 3: Realtime Telemetry Ingestion Pipeline (already has an approved v1 handover in history)
      {
        id: 'src-obs-csv',
        projectId: 'proj-telemetry-pipe',
        title: 'Kafka & ClickHouse Sprint Tasks',
        kind: 'csv',
        fileName: 'telemetry_sprint_tasks.csv',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-08T10:00:00Z',
        recordCount: 3,
        highlights: [
          'OBS-201 Completed: Rebalanced 64 Kafka partitions across us-east & eu-central',
          'OBS-204 Pending: Archive cold S3 parquet partitions older than 90 days',
        ],
        content: `task_id,title,owner,priority,status,deadline,notes
OBS-201,Rebalance 64 Kafka telemetry partitions for cooperative sticky assignor,Arjun Mehta,High,Completed,2026-11-04,Consumer lag dropped from 45s to 1.2s
OBS-202,Tune ClickHouse Async Insert flush interval to 500ms,Arjun Mehta,Medium,Completed,2026-11-07,Reduced disk IOPS by 38%
OBS-204,Enable automated S3 Parquet cold-tier archival for >90d metrics,Priya Nair,Medium,Not Started,2026-12-01,Terraform module ready in infra/clickhouse-ttl`,
      },
      {
        id: 'src-obs-docs',
        projectId: 'proj-telemetry-pipe',
        title: 'Telemetry Pipeline Incident & Scaling Notes',
        kind: 'docs',
        fileName: 'telemetry_pipeline_runbook.txt',
        addedBy: 'Arjun Mehta',
        addedAt: '2026-11-09T15:00:00Z',
        recordCount: 2,
        highlights: [
          'Runbook: docs/runbooks/kafka-lag-recovery.md',
        ],
        content: `REALTIME TELEMETRY INGESTION RUNBOOK
Repo: https://github.com/acme-data/telemetry-ingestor
Terraform Infra: infra/clickhouse-ttl/main.tf
Lag Recovery Runbook: docs/runbooks/kafka-lag-recovery.md

Notes: Partition skew in eu-central-1 was resolved by hashing on tenant_id + region_shard. Cold-tier S3 archival (OBS-204) is scheduled for Dec 1.`,
      },
    ],
    handovers: [
      // Pre-seeded approved handover for Project 3 so History screen & Demo have immediate proof
      {
        id: 'ho-obs-v1',
        projectId: 'proj-telemetry-pipe',
        version: 1,
        generatedAt: '2026-11-09T16:00:00Z',
        generatedByModel: 'gemini-4-hydrogen',
        status: 'approved',
        projectSummary: {
          executiveOverview:
            'The Realtime Telemetry Ingestion Pipeline has stabilized consumer lag at 1.2s across 42 edge regions following cooperative sticky Kafka rebalancing and ClickHouse async insert tuning.',
          architectureContext:
            'Edge collectors stream events into 64 Kafka partitions hashed by tenant_id + region_shard, consumed by Go ingestor workers writing batched inserts into ClickHouse.',
          handoverReadinessNote:
            'Core production throughput is stable; only scheduled cold-tier S3 Parquet archival remains for December.',
        },
        completedTasks: [
          {
            id: 'ct-obs-1',
            title: 'Rebalance 64 Kafka telemetry partitions for cooperative sticky assignor',
            owner: 'Arjun Mehta',
            completedDate: '2026-11-04',
            impact: 'Reduced p95 consumer lag from 45s to 1.2s',
            sourceEvidence: 'telemetry_sprint_tasks.csv · Row OBS-201',
            sourceId: 'src-obs-csv',
          },
          {
            id: 'ct-obs-2',
            title: 'Tune ClickHouse Async Insert flush interval to 500ms',
            owner: 'Arjun Mehta',
            completedDate: '2026-11-07',
            impact: 'Cut cluster disk IOPS utilization by 38%',
            sourceEvidence: 'telemetry_sprint_tasks.csv · Row OBS-202',
            sourceId: 'src-obs-csv',
          },
        ],
        pendingTasks: [
          {
            id: 'pt-obs-1',
            task: 'Enable automated S3 Parquet cold-tier archival for >90d metrics',
            priority: 'Medium',
            deadline: '2026-12-01',
            status: 'Not Started',
            owner: 'Priya Nair',
            context: 'Terraform module is staged in infra/clickhouse-ttl and awaiting maintenance window.',
            sourceEvidence: 'telemetry_sprint_tasks.csv · Row OBS-204',
            sourceId: 'src-obs-csv',
          },
        ],
        deadlines: [
          {
            id: 'dl-obs-1',
            milestone: 'S3 Parquet Cold-Tier Archival Activation',
            date: '2026-12-01',
            owner: 'Priya Nair',
            criticality: 'Standard',
            sourceEvidence: 'telemetry_pipeline_runbook.txt · Notes',
            sourceId: 'src-obs-docs',
          },
        ],
        importantFiles: [
          {
            id: 'if-obs-1',
            name: 'Telemetry Ingestor Repository',
            kind: 'Repository',
            locationOrUrl: 'https://github.com/acme-data/telemetry-ingestor',
            purpose: 'Primary Kafka-to-ClickHouse ingestion service codebase',
            owner: 'Priya Nair',
            sourceEvidence: 'telemetry_pipeline_runbook.txt',
            sourceId: 'src-obs-docs',
          },
          {
            id: 'if-obs-2',
            name: 'Kafka Lag Recovery Runbook',
            kind: 'Runbook',
            locationOrUrl: 'docs/runbooks/kafka-lag-recovery.md',
            purpose: 'Step-by-step playbook for partition skew mitigation',
            owner: 'Priya Nair',
            sourceEvidence: 'telemetry_pipeline_runbook.txt',
            sourceId: 'src-obs-docs',
          },
        ],
        risksAndNotes: [
          {
            id: 'rk-obs-1',
            title: 'Regional partition skew monitoring required on eu-central-1 bursts',
            severity: 'Moderate',
            mitigation: 'Keep tenant_id + region_shard composite key enforced in collector config.',
            sourceEvidence: 'telemetry_pipeline_runbook.txt · Notes',
            sourceId: 'src-obs-docs',
          },
        ],
        sourcesAnalyzed: [
          {
            sourceId: 'src-obs-csv',
            fileName: 'telemetry_sprint_tasks.csv',
            kind: 'csv',
            citationCount: 3,
          },
          {
            sourceId: 'src-obs-docs',
            fileName: 'telemetry_pipeline_runbook.txt',
            kind: 'docs',
            citationCount: 4,
          },
        ],
        humanReview: {
          reviewerName: 'Priya Nair',
          reviewerRole: 'Engineering Manager, Data',
          reviewedAt: '2026-11-10T16:25:00Z',
          decision: 'approved',
          comments: 'Verified Kafka consumer lag metrics and ClickHouse TTL Terraform paths during live walkthrough.',
          editedFields: ['pendingTasks[0].owner'],
        },
      },
      // Pre-seeded v1 "in_review" handover for SSO & RBAC so judges can test Review & Approve immediately too
      {
        id: 'ho-sso-v1',
        projectId: 'proj-sso-rbac',
        version: 1,
        generatedAt: '2026-11-12T14:40:00Z',
        generatedByModel: 'gemini-4-hydrogen',
        status: 'in_review',
        projectSummary: {
          executiveOverview:
            'Okta SAML 2.0 assertion verification and RBAC policy claims migration for 120k users are complete; SCIM nested AD group flattening and strict 15-minute impersonation token TTL remain prior to Q4 SOC2 evidence export.',
          architectureContext:
            'Central IAM service maps 18 legacy permissions into 6 structured RBAC tiers in configs/rbac_policies.yaml and validates tenant SAML assertions.',
          handoverReadinessNote:
            'Ready for incoming security manager review; Meridian Corp Azure AD test verification is the primary near-term milestone.',
        },
        completedTasks: [
          {
            id: 'ct-sso-1',
            title: 'Build multi-tenant Okta SAML 2.0 assertion verifier',
            owner: 'Arjun Mehta',
            completedDate: '2026-11-02',
            impact: 'Validated across 14 enterprise sandboxes',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-101',
            sourceId: 'src-sso-csv',
          },
          {
            id: 'ct-sso-2',
            title: 'Migrate legacy role strings to RBAC policy claims',
            owner: 'Arjun Mehta',
            completedDate: '2026-11-07',
            impact: 'Backfilled 120,000 user records cleanly',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-102',
            sourceId: 'src-sso-csv',
          },
        ],
        pendingTasks: [
          {
            id: 'pt-sso-1',
            task: 'Complete SCIM 2.0 nested AD group flattening & audit for Meridian Corp',
            priority: 'High',
            deadline: '2026-11-19',
            status: 'In Progress',
            owner: 'Arjun Mehta',
            context: 'PR #118 flattens nested AD groups up to depth 4; needs Meridian Azure AD sandbox test.',
            sourceEvidence: 'GitHub PR #118 · sso_tenant_rollout.csv (IAM-103)',
            sourceId: 'src-sso-github',
          },
          {
            id: 'pt-sso-2',
            task: 'Enforce 15-minute JWT TTL on support impersonation tokens',
            priority: 'High',
            deadline: '2026-11-22',
            status: 'Not Started',
            owner: 'Priya Nair',
            context: 'Required by security compliance ahead of December audit.',
            sourceEvidence: 'GitHub Issue #61',
            sourceId: 'src-sso-github',
          },
          {
            id: 'pt-sso-3',
            task: 'Complete SOC2 access-control evidence export for Q4 audit',
            priority: 'Critical',
            deadline: '2026-11-26',
            status: 'Not Started',
            owner: 'Priya Nair',
            context: 'Run scripts/soc2_rbac_dump.ts after impersonation TTL patch lands.',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-104',
            sourceId: 'src-sso-csv',
          },
        ],
        deadlines: [
          {
            id: 'dl-sso-1',
            milestone: 'Meridian Corp SCIM Nested Group Sign-Off',
            date: '2026-11-19',
            owner: 'Arjun Mehta',
            criticality: 'High',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-103',
            sourceId: 'src-sso-csv',
          },
          {
            id: 'dl-sso-2',
            milestone: 'Q4 SOC2 RBAC Evidence Freeze',
            date: '2026-11-26',
            owner: 'Priya Nair',
            criticality: 'Critical',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-104',
            sourceId: 'src-sso-csv',
          },
        ],
        importantFiles: [
          {
            id: 'if-sso-1',
            name: 'RBAC Policy Mapping Config',
            kind: 'Architecture Doc',
            locationOrUrl: 'configs/rbac_policies.yaml',
            purpose: 'Maps 18 legacy permissions to 6 structured RBAC role tiers',
            owner: 'Priya Nair',
            sourceEvidence: 'iam_rbac_handover_notes.txt',
            sourceId: 'src-sso-docs',
          },
          {
            id: 'if-sso-2',
            name: 'SOC2 Access Evidence Export Script',
            kind: 'Repository',
            locationOrUrl: 'scripts/soc2_rbac_dump.ts',
            purpose: 'Generates signed Q4 SOC2 access-control report',
            owner: 'Priya Nair',
            sourceEvidence: 'sso_tenant_rollout.csv · Row IAM-104',
            sourceId: 'src-sso-csv',
          },
          {
            id: 'if-sso-3',
            name: 'Nested AD Group Flattening PR',
            kind: 'Pull Request',
            locationOrUrl: 'https://github.com/acme-platform/iam-service/pull/118',
            purpose: 'Resolves Meridian Corp SCIM sync depth issue',
            owner: 'Arjun Mehta',
            sourceEvidence: 'GitHub PR #118',
            sourceId: 'src-sso-github',
          },
        ],
        risksAndNotes: [
          {
            id: 'rk-sso-1',
            title: 'Meridian Corp uses 3-level nested Active Directory security groups',
            severity: 'High',
            mitigation: 'Verify PR #118 against Meridian Azure AD test tenant prior to Nov 19 rollout.',
            sourceEvidence: 'iam_rbac_handover_notes.txt · Open Risk',
            sourceId: 'src-sso-docs',
          },
        ],
        sourcesAnalyzed: [
          {
            sourceId: 'src-sso-csv',
            fileName: 'sso_tenant_rollout.csv',
            kind: 'csv',
            citationCount: 5,
          },
          {
            sourceId: 'src-sso-github',
            fileName: 'github_iam_activity.json',
            kind: 'github',
            citationCount: 3,
          },
          {
            sourceId: 'src-sso-docs',
            fileName: 'iam_rbac_handover_notes.txt',
            kind: 'docs',
            citationCount: 2,
          },
        ],
      },
    ],
  };
}
