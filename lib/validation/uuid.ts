// Shared well-formed-UUID guard.
//
// Exists because several columns that hold user ids are UUID while the values
// we compare them against arrive as TEXT — workspaces.owner_id is text,
// user_profiles.user_id is uuid, and request bodies are text by definition.
// Handing Postgres a non-UUID string for a uuid column does not return zero
// rows; it raises 22P02 and fails the WHOLE statement. In a set query (.in())
// one malformed value poisons every other row's result, and in a single-row
// query it turns a should-be-404 into a 500.
//
// So: filter or reject with this BEFORE the query, never after.
//
// Pure and side-effect free so it can be unit-tested directly.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
