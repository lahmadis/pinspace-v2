# PinSpace Security Best-Practices Report

## Executive summary

The initial static review found one high-severity authorization pattern: privileged routes combine locally read session claims with a service-role Supabase client that bypasses RLS. The repository already has a safer verified-user helper, so remediation can be targeted. Production RLS and storage isolation remain unverified without an isolated Supabase project.

## High severity

### SEC-01 — Unverified session claims gate service-role administration

**Locations:**

- `app/api/admin/overview/route.ts:10-23`
- `app/api/admin/stats/route.ts:10-23`
- `app/api/admin/institutions/[slug]/stats/route.ts:16-29`
- `app/api/admin/institutions/[slug]/route.ts`
- `app/api/admin/institutions/[slug]/domains/route.ts`
- `app/api/admin/institutions/[slug]/domains/[domain]/route.ts`
- `app/api/institutions/route.ts:68-100`
- `app/api/debug/boards/route.ts`
- `app/api/debug/check-types/route.ts`

**Impact:** A forged or otherwise unverified local identity claim may cross the authorization boundary into service-role reads or writes spanning organizations and auth users.

**Root cause:** These routes call `supabase.auth.getSession()`, authorize using `session.user.email`, and then invoke a service-role client. The service-role client bypasses RLS, so the application check is the only boundary.

**Counterevidence:** The admin email must match `PINSPACE_ADMIN_EMAILS`; middleware hides admin pages from ordinary signed-out navigation. Neither control replaces server-side identity verification for the API. Newer admin routes correctly use `requireAdmin()`.

**Recommendation:** Replace the duplicated session/email gates with `requireAdmin()`. Add tests for missing, expired, forged, non-admin, and verified-admin sessions. Keep service-role creation after successful authorization.

## Important verification gaps

### SEC-02 — Active RLS and storage policies cannot be established from source alone

Migrations describe intended policies, but migrations are manually applied and no isolated project is configured. Test SELECT/INSERT/UPDATE/DELETE for two organizations, room/workspace membership, public/guest tokens, and storage read/write/delete behavior before launch.

### SEC-03 — Public organization metadata should receive a privacy decision

`GET /api/institutions` intentionally uses the service role without authentication and returns organization domains plus student/workspace counts. Confirm that domains and counts are intended public product data; otherwise reduce the response to the fields required by onboarding.

## Positive controls observed

- `getVerifiedUser()` and `requireAdmin()` provide an appropriate reusable verification path.
- Board reorder checks workspace ownership or verified superadmin status before its service-role write.
- The reorder RPC revokes execution from public, anon, and authenticated roles.
- Board deletion uses service-role reference checks and fails safe by retaining ambiguous storage objects.
- Several public/guest endpoints resolve access through room/workspace publication or scoped tokens.
- Environment documentation clearly distinguishes public Supabase values from the service-role secret.

## Scope limits

This is an initial static review, not a completed penetration test or proof of production configuration. No secrets were read, no external systems were contacted, and no destructive actions were performed.
