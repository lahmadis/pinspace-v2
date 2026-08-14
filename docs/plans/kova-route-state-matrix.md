# Kova Route and State Matrix

This matrix freezes the visible product surface before the Kova redesign. It is the release checklist source of truth; every listed route must receive responsive, accessibility, loading, empty, error, and permission review where applicable.

## Public and account routes

| Routes | Primary states and checks |
| --- | --- |
| `/` | Signed out, signed in, session loading, responsive navigation |
| `/sign-in`, `/sign-up/[[...sign-up]]` | Empty, invalid, submitting, server error, success redirect |
| `/forgot-password`, `/reset-password` | Empty, invalid, submitting, expired/invalid link, success |
| `/onboarding` | Loading, validation, institution selection, claim success/failure |
| `/terms`, `/privacy` | Readability, headings, keyboard navigation, mobile typography |

## Core authenticated routes

| Routes | Primary states and checks |
| --- | --- |
| `/dashboard` | Loading, API failure, empty personal/shared/org scopes, populated grids, archive mode, join/create/rename/delete/leave dialogs |
| `/workspace/new` | Empty form, validation, submitting, API failure, success redirect |
| `/workspace/[id]` | Loading, not found/denied, empty rooms, populated rooms, create/reorder/delete/share workflows |
| `/workspace/[id]/settings` | Loading, denied, validation, saving, destructive settings |
| `/studio/new` | Validation, creation failure, success redirect |
| `/studio/[id]` | Loading, board failure, empty/populated room, edit mode, presence, presentation, comments, upload, share, room switching, narrow viewport |
| `/studio/[id]/view` | Loading, invalid room, empty/populated viewer, selected board |
| `/board/[id]`, `/my-boards` | Loading, empty/not found, content display, responsive media |
| `/settings` | Loading, profile and notification save states, leave organization, delete account |

## Discovery routes

| Routes | Primary states and checks |
| --- | --- |
| `/network`, `/network/wentworth`, `/network/shared` | Loading, API failure, empty/populated graph, node selection, mobile fallback |
| `/network/[workspaceId]`, `/network/shared/[workspaceId]` | Loading, not found/denied, selected workspace graph |
| `/explore`, `/explore/[department]`, `/explore/[department]/[year]` | Loading, empty/error, filters, long labels, responsive grids |
| `/gallery` | Loading, empty/error, 3D fallback, avatar modal, keyboard navigation |
| `/u/[userId]` | Loading, not found, empty/populated public profile |

## Sharing and external participation

| Routes | Primary states and checks |
| --- | --- |
| `/join/[code]` | Loading, invalid/expired code, denied, join success/failure |
| `/share/[token]`, `/crit/[token]` | Loading, invalid/expired token, empty/populated boards, comment/critique interactions |
| `/f/[slug]`, `/i/[slug]` | Loading, not found, public content and institution entry |

## Administrative and utility routes

| Routes | Primary states and checks |
| --- | --- |
| `/admin`, `/admin/institutions`, `/admin/institutions/[slug]` | Loading, denied, empty/error/populated data, create/edit actions, mobile tables |
| `/admin/users`, `/admin/instructors/[userId]` | Loading, denied, search, empty/error/populated data, role actions |
| `/demo`, `/demo/studio/[id]`, `/demo/studio/[id]/view` | Demo banner, loading/error, view/edit modes |
| `/model`, `/debug/boards` | Loading/error, unmistakable utility/debug context, authorization |
| Global and route error files | Recovery action, accessible announcement, safe navigation |

## Baseline captured on 2026-08-14

- `npm ci`: completed using the committed lockfile.
- `npm run build`: completed successfully without Supabase environment variables.
- Build logged a missing `SUPABASE_SERVICE_ROLE_KEY` while prerendering department data but did not fail.
- Existing lint output contains React hook dependency and raw `<img>` warnings; these are baseline warnings.
- Authenticated Supabase journeys are blocked until isolated test-project environment values are supplied.
