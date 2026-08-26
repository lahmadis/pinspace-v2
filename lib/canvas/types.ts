/**
 * Canvas types and validators shared by the API routes and the browser.
 *
 * Split out of access.ts deliberately: that file imports next/server and the
 * SERVICE-ROLE Supabase client, so a client component importing `CanvasNode`
 * from it would pull server-only code — and the service role key's module
 * graph — into the browser bundle. This module imports nothing at all, which is
 * the property that keeps that from happening by accident.
 *
 * The validators live here rather than only server-side so the client can
 * reject a bad value before it costs a round trip, using the same bounds the
 * route and the database enforce.
 */

/** Types migration 036's CHECK constraint accepts. Kept in sync by hand. */
export const CANVAS_NODE_TYPES = ['sticky', 'text', 'image', 'ink', 'shape', 'frame', 'connector'] as const
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number]

/** DB row shape for canvas_nodes, mirroring migration 036. */
export interface CanvasNodeRow {
  id: string
  canvas_id: string
  /** NULL on a personal canvas, which has no room (migration 038). */
  room_id: string | null
  type: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  z: number
  props: Record<string, unknown>
  from_node_id: string | null
  to_node_id: string | null
  author_id: string | null
  guest_token_id: string | null
  author_name: string
  updated_by: string
  created_at: string
  updated_at: string
}

/** One object on a canvas, as the client sees it. */
export interface CanvasNode {
  id: string
  canvasId: string
  type: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  z: number
  props: Record<string, unknown>
  fromNodeId: string | null
  toNodeId: string | null
  authorId: string | null
  authorName: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export function transformNode(n: CanvasNodeRow): CanvasNode {
  return {
    id: n.id,
    canvasId: n.canvas_id,
    type: n.type,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    rotation: n.rotation,
    z: n.z,
    props: n.props ?? {},
    fromNodeId: n.from_node_id,
    toNodeId: n.to_node_id,
    authorId: n.author_id,
    authorName: n.author_name,
    updatedBy: n.updated_by,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }
}

/**
 * Geometry bounds matching the CHECK constraints in migration 036.
 *
 * Validated in the app as well as the database so a bad value returns 400 with
 * a message rather than a 500 from a constraint violation. NOT redundant with
 * the DB check — that one is the guarantee, this one is the error message.
 *
 * `Number.isFinite` is what actually rejects NaN and Infinity in JS; the DB
 * relies on a bounded range instead, because Postgres treats NaN as equal to
 * itself and greater than every real number.
 */
export const CANVAS_COORD_LIMIT = 1e7

export function isValidGeometry(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < CANVAS_COORD_LIMIT
}

/**
 * `z` is an INTEGER column, so finiteness alone isn't enough — 3e9 is finite,
 * survives Math.trunc, and then fails in Postgres as "integer out of range",
 * turning a bad request into a 500. A million layers is far past any real
 * stacking need.
 */
export const CANVAS_Z_LIMIT = 1e6

export function isValidZ(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= CANVAS_Z_LIMIT
}

/** props is JSONB, which happily accepts "str", 42 and [] — none of which the
 *  client's Record<string, unknown> type can represent. */
export function isValidProps(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Body size ceiling, matching board_traces' 1 MB.
 *
 * `props` carries ink point lists, so an unbounded body is not theoretical.
 * canvas_nodes is published with REPLICA IDENTITY FULL, which means every row
 * that lands is broadcast in full to every subscriber — an oversized node is
 * amplified across the whole room rather than costing only the writer.
 */
export const MAX_CANVAS_PAYLOAD_BYTES = 1024 * 1024

/** Clamp geometry into the range the DB will accept, for client-side writes. */
export function clampCoord(v: number): number {
  if (!Number.isFinite(v)) return 0
  const limit = CANVAS_COORD_LIMIT - 1
  return Math.min(limit, Math.max(-limit, v))
}

export function clampSize(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(CANVAS_COORD_LIMIT - 1, Math.max(0, v))
}
