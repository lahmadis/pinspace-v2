# PinSpace (pinspace-v2) — Rules for Claude Code
- The only branch this repo commits to is `sarah-main`. Verify with `git branch --show-current` before editing. Never create, rebase, or merge branches.
- Base is Next 16 / React 19. Never change dependency versions.

## Hard rules — never violate
- NEVER run `npm run build` locally. It hangs the Windows session. Push and let Vercel build.
- Run `npx tsc --noEmit` in foreground only as the type check.
- Do NOT spawn background bash, sub-agents (except pre-push-reviewer), monitors, or watchers. Everything synchronous in foreground.
- If any single command or step takes >2 minutes, stop and report.
- Skip `next lint` — it hangs.
- Migrations committed to migrations/ are NEVER auto-applied. They must be manually pasted into the Supabase SQL Editor by the user. If a task produces a new migrations/ file, end output with: "MIGRATION REQUIRED: apply migrations/<filename> to Supabase before testing. Phase is not shipped until migration applied."
- Never run destructive/cleanup scripts with --apply without explicit user confirmation in the same session.

## Architecture conventions
- - Stack: Next.js 16 + React 19 + TypeScript + Supabase + Three.js/React Three Fiber (@react-three/fiber 9, drei 10), deployed on Vercel. Email via Resend.
- RLS pattern: do NOT add new RLS policies. For reads that involve joined-but-not-owned workspaces, use supabaseServiceRole() and enforce access in app code (owner OR member OR org OR public). supabaseServer() silently filters those rows.
- workspaces.owner_id is text; user_profiles.user_id is uuid. Joins between them need ::text casts.
- Department lists must import from lib/constants/departments.ts — never define a local copy.
- Any migration creating a table subscribed via postgres_changes must include ALTER PUBLICATION supabase_realtime ADD TABLE for that table in the same file.
- useSearchParams in a client component requires a <Suspense> boundary up the tree — this only fails at Vercel build, not tsc.
- Sub-rooms are shipped: parent room = folder/container (no 3D space); sub-rooms inside are the actual 3D studios.

## Workflow
- Work one phase at a time. Diagnostic-only pass before any fix on state-sync or data-integrity surfaces.
- Before every commit: run the pre-push-reviewer agent on changed files and show the report.
- Then stage, commit, push.
- The project path contains spaces — always quote it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
