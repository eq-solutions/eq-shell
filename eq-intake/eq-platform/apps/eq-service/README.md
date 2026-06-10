# EQ Solves Service

Multi-tenant maintenance management platform for electrical contractors — circuit breaker testing, preventative maintenance, defect tracking, and compliance reporting.

Built by EQ Solutions (CDC Solutions Pty Ltd). First commercial customer: SKS Technologies.

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript strict mode)
- **Styling**: Tailwind CSS v4 with CSS-first config
- **Database**: Supabase (PostgreSQL) with Row-Level Security
- **Auth**: Supabase Auth (email/password + TOTP MFA + bcrypt recovery codes)
- **Storage**: Supabase Storage (attachments + logos buckets)
- **Email**: Resend (custom SMTP)
- **DOCX Generation**: docx-js (ACB, NSX, and PM asset reports)
- **Hosting**: Netlify (auto-deploy from main branch)

## Key Features

- **Asset Register** — track electrical assets across multiple customer sites with job plan assignments, CSV import, grouped views, and Excel export
- **Maintenance Checks** — IBM Maximo-aligned PM workflow with two creation paths (frequency-based or manual Maximo IDs), per-asset task tracking, and full-page detail views
- **ACB Testing** — 3-step Air Circuit Breaker workflow (Asset Collection, Visual & Functional, Electrical Testing) with E1.25 auto-filter, site-level collection, and Excel batch fill
- **NSX/MCCB Testing** — Moulded Case Circuit Breaker test records with CB-specific fields
- **General Testing** — electrical test records with inline readings
- **DOCX Reports** — per-site ACB and NSX reports, per-check PM asset reports, all white-labelled
- **Defect Tracking** — severity-based defect workflow linked to checks and assets
- **Contract Scope** — per-customer, per-FY scope management integrated into check creation
- **Compliance Reports** — KPI cards, charts, overdue tracking, test pass rates
- **Analytics Dashboard** — 12-month trends, pass rates by test type, calibration status
- **Instrument Register** — calibration tracking with overdue alerts
- **Multi-Tenancy** — complete data isolation, white-label branding (colours, logo, product name)
- **Role-Based Access** — super_admin, admin, supervisor, technician, read_only
- **Audit Log** — immutable trail of all significant actions
- **Global Search** — cross-entity search (assets, sites, customers, ACB, NSX, instruments)

## Getting Started

See [LOCAL_DEV.md](LOCAL_DEV.md) for setup instructions.

```bash
git clone https://github.com/Milmlow/eq-solves-service.git
cd eq-solves-service
npm install
cp .env.example .env.local  # Fill in Supabase keys
npm run dev
```

## Documentation

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, schema, auth flow, key decisions |
| [SPEC.md](SPEC.md) | Feature spec with acceptance criteria |
| [ROADMAP.md](ROADMAP.md) | Sprint progress and migration log |
| [CHANGELOG.md](CHANGELOG.md) | Per-session change log |
| [LOCAL_DEV.md](LOCAL_DEV.md) | Local development setup and testing guide |
| [AI_STRATEGY.md](AI_STRATEGY.md) | Phased AI feature roadmap |
| [USER_MANUAL_NOTES.md](USER_MANUAL_NOTES.md) | Raw material for user manual |
| [CLAUDE.md](CLAUDE.md) | AI assistant context (patterns, conventions) |

## Useful Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint check
npx tsc --noEmit   # TypeScript check
```

## Migrations

Migrations live in `supabase/migrations/` — the directory itself is the
source of truth (numeric counts in this file used to bit-rot in days).
Early migrations cover the core schema (profiles, maintenance checks,
test records, attachments, ACB/NSX tests, audit logs, instruments,
performance indexes, notifications, job plans, Maximo alignment, report
settings, contract scope, defects, ACB asset collection, PM calendar).
Later migrations add NSX workflow status, security/perf cleanup,
idempotency, media library, signup trigger hardening, defects
auto-creation from failed items/readings, and contract-scope asset
linkage. Look at the `supabase/migrations/` directory for the current
list and any new additions.

See [ROADMAP.md](ROADMAP.md) for the full migration table (note: the table in ROADMAP.md is currently behind — source of truth is `supabase/migrations/`).
