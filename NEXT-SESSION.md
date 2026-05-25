# EQ Shell — Next Session Prompt

## Context

Big session 2026-05-24. V9 hub is fully live at core.eq.solutions. Every Shell page
now uses the dark sidebar layout via HubLayout. Tenant branding is wired end-to-end.

Read `src/components/HubSidebar.tsx`, `src/components/HubLayout.tsx`, and
`src/pages/TenantHome.tsx` to get oriented on the V9 layout before touching anything.

---

## Priority 1 — Create tenant-logos storage bucket (5 min, blocking)

Logo upload on the Settings page will 404 until this bucket exists.

Use the Supabase MCP on project `jvknxcmbtrfnxfrwfimn` (eq-canonical):
1. Create a `tenant-logos` storage bucket with public read access
2. Add an RLS policy so authenticated users can upload to their own tenant folder:
   `(storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id')`

---

## Priority 2 — Iframe pages nav decision

FieldIframe, ServiceIframe, and CardsIframe still use the old Topbar
(`src/pages/FieldIframe.tsx`, `ServiceIframe.tsx`, `CardsIframe.tsx`).

Two options — get Royce to decide before building:
- **Option A:** Full-screen iframe (no sidebar). When inside an app you're fully inside it.
  Back to hub = browser back button or a small "← Hub" pill in the iframe header.
- **Option B:** Sidebar stays visible alongside the iframe (sidebar 260px + iframe fills rest).
  Lets the user switch apps without going back to hub. Needs iframe height CSS adjustment.

The iframe currently fills `calc(100vh - topbar-height)`. Option B replaces that with
`calc(100vh)` and the sidebar sits beside it.

---

## Priority 3 — EQ Service Delta WO import dry-run

Live SKS operational need, untouched. Run the Aug 2025 WO file on the SKS tenant.
Context in `C:\Projects\eq-context\sks\pending.md`.

---

## Priority 4 — EQ Cards Unit 3 migration check

Has actual licence data been moved from old Cards Supabase to eq-canonical?
Check via Supabase MCP on `jvknxcmbtrfnxfrwfimn` — look for licence rows tied to
the SKS tenant. If not migrated, the script is at commit `df521a9` in eq-cards.

---

## Deferred but worth knowing

- V11 AI briefing (north star hub feature) — needs `activity_log` cross-app table first
- Sidebar app counts: Service/Quotes/Cards counts are null stubs — need RPCs
- `eq-solves-assets feat/calm-capture` — 2 unpushed commits at `C:\Projects\eq-solves-assets`, risk of loss
- EntityBrowserPage row drill-down drawer
- Storage browser upload widget
