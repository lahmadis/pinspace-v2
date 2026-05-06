# PinSpace Context

## Stack

- **Framework:** Next.js (App Router, TypeScript) — client and server components, Route Handlers
- **Database / Auth / Storage:** Supabase (Postgres, Supabase Auth with OTP + password fallback, Supabase Storage for board images)
- **Deployment:** Vercel
- **Styling:** Tailwind CSS
- **Auth helper:** `lib/supabase/server.ts` exposes `supabaseServer()` (user-scoped) and `supabaseServiceRole()` (service role for admin routes)
- **Admin guard:** `lib/auth/isAdmin.ts` — checks `PINSPACE_ADMIN_EMAILS` env var

---

## Architectural Decisions Locked In

- **`organizations` is the canonical table.** `institutions` is an auto-updatable passthrough view (`SELECT id, name, slug, network_label, created_at, type, logo_url FROM organizations`). The view exists to avoid breaking the ~20 call sites that still reference `institutions` by name. Full rename is a separate appetite-gated decision (P4.4/P4.5 if pursued); not currently scheduled.

- **`org_domains` is the canonical source for allowed email domains.** The legacy `allowed_email_domains TEXT` column on `organizations` was dropped in P4.3. All readers (sign-up, join, admin stats, institutions list) now query `org_domains` directly. Domain membership check: query `org_domains` for the org's `id`; empty result = no restriction.

- **`org_requests` handles new-org request flow.** Rows carry `status` (pending / approved / rejected), `decided_at TIMESTAMPTZ`, and `decided_by UUID → auth.users`. Both approve RPCs and the reject route write audit fields. Rejected rows are preserved as an audit log, never deleted. Batch resolution: approving one request approves all pending requests for the same domain atomically.

- **Two approve RPCs, service-role only:** `approve_org_request_as_new_org` and `approve_org_request_as_existing`. Both use `SELECT ... FOR UPDATE` for idempotency and accept `p_decided_by UUID` for audit.

- **SQL file layout (P4.6):**
  - `migrations/` — numbered applied migrations (`001`–`007`), run in order
  - `migrations/archive/` — pre-Phase-4 ad-hoc scripts, historical reference only
  - `scripts/` — reusable dev utilities (seed data, delete-user helper, etc.)

- **Migration method:** Supabase SQL Editor paste. Not Supabase CLI (`supabase db push`). This is the project convention for production safety. MCP not configured; user prefers manual paste.

- **Admin page pattern:** Two-step inline confirm for destructive actions (delete org, reject request). `PendingRequestsPanel` mounts only when `pending_request_count > 0` (from overview response). Panel manages its own request list; calls `onRefresh` (→ `loadData`) when the last request is resolved.

---

## Phase History

| Phase | Commit | Summary |
|---|---|---|
| P4.5 | — | Rename `institution_id` → `organization_id` FK column in all Supabase query call sites (workspaces + user_profiles); old columns dropped in migration 009 |
| P4.4 | — | Rename `.from('institutions')` → `.from('organizations')` across all API call sites; completed as part of earlier route work, not a standalone commit |
| P4.6 | `a59fc2c` | SQL file consolidation into migrations/, archive/, scripts/ |
| P4.3 | `d22cae4` | Drop allowed_email_domains column, recreate institutions view, migrate 5 readers to org_domains |
| P4.2 + P4.2.5a | `6b33920` | Org request review UI with audit trail (decided_at, decided_by) |
| P4.1.5b | `105c999` | Batch org_domains query in admin overview, eliminate N+1 |
| P4.1.5a | `960e07f` | Layout fix: domain section inside edit form |
| P4.1 | `e9504de` | Domain management as org_domains rows, atomic org create via RPC, add/remove in edit modal |
| P4.0 | `65e231f` | Extract isAdmin to shared module, deprecate /admin/institutions, add delete to edit modal |
| P3.5 | `d93af41` | Sign-in flow bug fixes: institution context isolation, sign-in page institution display |
| P3 | `0ed4c8c` | Email-first sign-in flow with OTP, password fallback, org request capture |
| P2 | `c93986c` | Domain lookup and org request API routes |
| P1 | `24eb702` | Rename institutions → organizations, add org_domains and org_requests tables |

---

## Open Phases

- **Markdown consolidation** — 7+ stale guide docs at project root (`DEPLOYMENT_CHECKLIST.md`, `MIGRATION_TO_SUPABASE.md`, `PRODUCTION_READY.md`, `SETUP_INSTRUCTIONS.md`, `STORAGE_MIGRATION_GUIDE.md`, `ONBOARDING_GUIDE.md`, `SUPABASE_EMAIL_OTP_SETUP.md`) reference pre-Phase-4 SQL filenames with no path prefix. Same cleanup shape as P4.6.
- **Context doc** — this file. ✅ Created.

---

## Bug List

- **`/api/admin/overview` query count** — runs 2N queries (one workspaces + one user_profiles per org) inside `Promise.all`. Cosmetic; not a correctness issue. Could be collapsed to 2 aggregate queries total.
- **`/api/admin/institutions/[slug]/stats`** — still uses a local `isAdmin()` copy instead of importing from `lib/auth/isAdmin`. Should import the shared module (P4.0 introduced the shared one but this file wasn't updated).

---

## Working Conventions

- One step at a time, plain language. No big numbered lists in replies unless explicitly asked.
- Show diffs before committing; wait for confirmation between each.
- Phased commits with explicit boundaries. Don't push between commits in a phase — push the batch at the end after smoke test.
- Smoke test in browser before pushing any schema changes.
- For DB work: read-only inspection first (parity checks, schema dumps), then plan, then migration, then verify.
- `git mv` for file moves to preserve history.
- New sessions: check `CONTEXT.md` first, then `git log --oneline -10` to orient.
