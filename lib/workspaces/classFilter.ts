/**
 * PostgREST `.or()` filter selecting CLASS workspaces.
 *
 * `workspaces.type` is nullable TEXT with DEFAULT 'class'. Nothing writes NULL
 * today, but the column permits it, and GET /api/admin/studios already renders
 * a NULL type as 'class' (`type ?? 'class'`). A strict .eq('type','class')
 * would therefore drop a row the Studios card shows, leaving two admin surfaces
 * disagreeing about the same studio. This matches the existing semantics.
 *
 * personal and shared are excluded by either form — that part is not a
 * judgement call. Those workspaces are private and deliberately never appear in
 * any admin instructor view.
 *
 * Lives in lib/ rather than in a route file because Next.js type-checks App
 * Router route modules and rejects exports that are not handlers or recognised
 * config — sharing a const out of one fails at build, not at tsc.
 */
export const CLASS_TYPE_FILTER = 'type.eq.class,type.is.null'
