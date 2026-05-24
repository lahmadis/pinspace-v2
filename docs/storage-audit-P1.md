# Storage Upload Audit — Phase 1 Diagnostic

Generated: 2026-05-22. Diagnostic only — no code was modified.

---

## 1. Upload code paths

### 1a. Board image upload — `hooks/useBoardUpload.ts` + `app/api/upload/route.ts`

**Entry point (client):** `hooks/useBoardUpload.ts:641-644`
```ts
const input = document.createElement('input')
input.type = 'file'
input.accept = '.jpg,.jpeg,.png,.pdf'
input.multiple = true
```
- **FormData construction:** `hooks/useBoardUpload.ts:117-159` — appends `image` (file), `studioId`, `workspaceId`, `roomId`, title, dimensions, position, owner fields.
- **Bucket(s):** `board-images`
- **File types accepted (client):** `.jpg`, `.jpeg`, `.png`, `.pdf` (MIME check: `image/jpeg`, `image/jpg`, `image/png`, `application/pdf`)
- **Size cap (client):** 50 MB — `hooks/useBoardUpload.ts:647` (`const MAX_FILE_SIZE = 50 * 1024 * 1024`)
- **Size cap (server):** 50 MB — `app/api/upload/route.ts:99-101`
- **Routes through:** Vercel `/api/upload` (POST, multipart/form-data)
- **Direct to Supabase:** No — always proxied through the Next.js route handler

**Second entry point (client — WallCanvasEditor PDF re-upload path):** `components/WallCanvasEditor.tsx:173-189` and `components/WallCanvasEditor.tsx:272-288`
- Builds FormData with `image`, `studioId`, `title`, dimensions. No explicit client-side size guard in this code path.
- Same `/api/upload` route — server-side 50 MB cap still applies.

**Server handler:** `app/api/upload/route.ts:6` (POST)
- Validates MIME type (line 105–108): `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf`
- Validates size 50 MB (line 99–101)
- Runs `sharp` compression for non-PDF images (lines 123–142): full at 2400 px / q85 mozjpeg, thumb at 800 px / q75 mozjpeg
- Storage paths: `{userId}/{timestamp}-{random}.jpg` (full), `{userId}/{timestamp}-{random}-thumb.jpg`

---

### 1b. 3D model upload — `components/3d/FloorEditorOverlay.tsx` + `app/api/upload-model/route.ts`

**Entry point (client):** `components/3d/FloorEditorOverlay.tsx:923`
```tsx
accept=".glb,.gltf,.3dm"
```
- `handleTableFileChange` at `FloorEditorOverlay.tsx:221-249`
- **Size cap (client):** 10 MB — `FloorEditorOverlay.tsx:229` (`if (file.size > MAX_MODEL_SIZE_BYTES)`) using `lib/uploadLimits.ts`
- **FormData:** `FloorEditorOverlay.tsx:232-234` — appends `model` (file), `studioId`
- **Routes through:** Vercel `/api/upload-model` (POST, multipart/form-data)
- **Bucket(s):** `board-images`
- **File types accepted (client):** `.glb`, `.gltf`, `.3dm` (note: `.stl` excluded here even though `SUPPORTED_MODEL_EXTENSIONS` includes it)
- **Size cap (server):** 10 MB — `app/api/upload-model/route.ts:42-44` using `MAX_MODEL_SIZE_BYTES`
- **Direct to Supabase:** No — proxied

**Server handler:** `app/api/upload-model/route.ts:15` (POST)
- Validates extension against `SUPPORTED_MODEL_EXTENSIONS` (`.glb`, `.gltf`, `.3dm`, `.stl`) — line 37–39
- Validates size 10 MB — line 42–44
- No server-side compression
- Storage path: `{userId}/models/{timestamp}-{random}-{safeName}.{ext}`

---

### 1c. Model file preview (local only) — `app/model/page.tsx`

**Entry point (client):** `app/model/page.tsx:118-123`
```tsx
<input ref={fileInputRef} type="file" accept=".glb,.gltf,.3dm" onChange={handleFileChange} className="hidden" />
```
- `handleFileChange` at `app/model/page.tsx:56-78`
- **Does NOT upload to storage.** Creates a local `URL.createObjectURL(file)` blob URL for preview only.
- **Size cap (client):** 10 MB — line 65 (`if (file.size > MAX_MODEL_SIZE_BYTES)`)
- **No server involvement.** Blob URL is revoked on navigation.

---

### 1d. Avatar upload — `app/settings/page.tsx`

**Entry point (client):** `app/settings/page.tsx:378`
```tsx
accept="image/*"
```
- `handleAvatarChange` at `app/settings/page.tsx:187-221`
- **Bucket(s):** `avatars`
- **File types accepted (client):** `image/*` (no MIME restriction enforced in code — whatever the browser allows)
- **Size cap (client):** None enforced
- **Size cap (server):** None enforced (upload goes directly to Supabase Storage from client)
- **Routes through:** Client calls `supabase.storage.from('avatars').upload(...)` directly — does NOT go through a Vercel `/api` route
- **After upload:** Calls `/api/settings/profile` (PATCH, JSON) to store the public URL in `user_profiles.avatar_url`

---

### 1e. Wall config upload — `app/api/studios/[id]/wall-config/route.ts`

**Entry point (server-internal only):** `app/api/studios/[id]/wall-config/route.ts:26`
- Not triggered by a file input — JSON serialized from DB then written to storage
- **Bucket(s):** `board-images` (via `CONFIG_BUCKET` alias, line 4)
- **File types:** `application/json` only
- **Size cap:** None (JSON config blob, negligible size)
- **Routes through:** Server-side only (service role client); client POSTs JSON to this route, server writes to storage

---

## 2. Current upload limits

`lib/uploadLimits.ts` (verbatim):

```ts
export const MAX_MODEL_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const SUPPORTED_MODEL_EXTENSIONS = ['.glb', '.gltf', '.3dm', '.stl'] as const
export type SupportedModelExt = typeof SUPPORTED_MODEL_EXTENSIONS[number]
```

---

## 3. Bucket inventory (from code)

| Bucket name | Where referenced | File types | Path naming convention |
|---|---|---|---|
| `board-images` | `app/api/upload/route.ts:260,276,285,293,300,322`<br>`app/api/upload-model/route.ts:64,76`<br>`app/api/studios/[id]/wall-config/route.ts:4,11,26`<br>`app/api/boards/route.ts:472`<br>`scripts/cleanup-orphan-storage.ts:33` | JPEG, PNG, WebP, PDF (images); GLB, GLTF, 3DM, STL (models); JSON (configs) | Multiple sub-path conventions (see §4) |
| `avatars` | `app/settings/page.tsx:195,199` | Any image (`image/*`) | `{userId}/avatar.{ext}` |

---

## 4. Path conventions

### Bucket: `board-images`

Three distinct sub-path patterns within the same bucket:

**Board images (full):**
```
{userId}/{timestamp}-{random}.jpg
# e.g. abc123def/1716400000000-k8j2x1.jpg
```
(`app/api/upload/route.ts:151-152`)

**Board images (thumbnail variant):**
```
{userId}/{timestamp}-{random}-thumb.jpg
# e.g. abc123def/1716400000000-k8j2x1-thumb.jpg
```
(`app/api/upload/route.ts:153`)

**3D models:**
```
{userId}/models/{timestamp}-{random}-{safeName}.{ext}
# e.g. abc123def/models/1716400000000-x7z9p2-my-chair.glb
```
(`app/api/upload-model/route.ts:53`)

**Wall configs:**
```
wall-configs/{studioId}.json
# e.g. wall-configs/ws_abc123.json
```
(`app/api/studios/[id]/wall-config/route.ts:5,10,24`)

### Bucket: `avatars`

```
{userId}/avatar.{ext}
# e.g. abc123def/avatar.jpg
```
(`app/settings/page.tsx:193`) — fixed filename, upserted; `ext` comes from original file name.

---

## 5. Next.js config

**File:** `next.config.js`

| Setting | Value |
|---|---|
| `experimental.serverActions.bodySizeLimit` | **Not set** (uses Next.js default of 1 MB for Server Actions — irrelevant here since uploads use Route Handlers, not Server Actions) |
| `api.bodyParser.sizeLimit` | **Not set** |
| `export const maxDuration` (route segments) | Set to `60` in `app/api/workspaces/[id]/export/route.ts:6` only. Not set in upload routes. |
| `compress` | `true` (HTTP response compression) |
| `experimental.optimizePackageImports` | `['three', '@react-three/fiber', '@react-three/drei']` |
| `reactStrictMode` | `true` |
| Sentry | Injected via `withSentryConfig`; `tunnelRoute: "/monitoring"` |

**Implications for uploads:** No `bodySizeLimit` is configured for Server Actions (not applicable). Route Handler body parsing is handled by the Next.js runtime; the effective limit on Vercel is the platform's default request body limit (**4.5 MB** for Serverless Functions unless overridden, or **up to 4.5 MB** by default on the Pro plan). The `/api/upload` route claims to accept 50 MB files but **there is no `export const maxDuration` and no `bodySizeLimit` override** in that route — Vercel may truncate bodies larger than the platform limit before the handler's size check on line 100 can fire.

---

## 6. Sharp / server compression

**Only one use of `sharp` in the codebase:**

**File:** `app/api/upload/route.ts:4` (`import sharp from 'sharp'`)

**Where it runs:** Lines 123–142, inside `POST /api/upload`, for non-PDF image uploads only.

**What it does:**
```ts
// Full image: max 2400px wide, quality 85, mozjpeg encoder
sharp(inputBuffer)
  .resize({ width: 2400, withoutEnlargement: true })
  .jpeg({ quality: 85, mozjpeg: true })
  .toBuffer()

// Thumbnail: max 800px wide, quality 75, mozjpeg encoder
sharp(inputBuffer)
  .resize({ width: 800, withoutEnlargement: true })
  .jpeg({ quality: 75, mozjpeg: true })
  .toBuffer()
```

Both run in parallel (`Promise.all`). On failure, falls back silently to the original buffer (`console.warn`) and skips the thumbnail.

**Not used for:** 3D model uploads, avatar uploads, wall config uploads, or PDF uploads.

---

## 7. Wall-config write paths

### 7a. The only storage write: `app/api/studios/[id]/wall-config/route.ts`

**Context:** Server-side API Route Handler (no `'use client'` directive — this is a Next.js route handler file, not a component).

**Supabase client used:** `supabaseServiceRole()` — line 2 import, line 23 call.

```ts
// lib/supabase/server.ts:30-36
export const supabaseServiceRole = () => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set ...')
  return createClient(/* url, serviceRoleKey */)
}
```

`SUPABASE_SERVICE_ROLE_KEY` → **bypasses RLS entirely**.

**Exact upload call** (`app/api/studios/[id]/wall-config/route.ts:22-31`):
```ts
async function writeConfigToStorage(id: string, config: unknown): Promise<void> {
  const db = supabaseServiceRole()                         // line 23 — service role
  const filePath = `${CONFIG_PREFIX}/${id}.json`           // line 24 — "wall-configs/{id}.json"
  const payload = Buffer.from(JSON.stringify(config), 'utf-8')  // line 25
  const { error } = await db.storage.from(CONFIG_BUCKET).upload(filePath, payload, {
    upsert: true,                // overwrites existing config
    contentType: 'application/json',
  })
  if (error) throw error
}
```

**This function is called from one place:**

`POST /api/studios/[id]/wall-config` handler — `route.ts:58-68`:
```ts
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const body = await request.json()
  await writeConfigToStorage(id, body)   // ← only call site of the upload
  return NextResponse.json({ success: true })
}
```

Note: **there is no auth check in the POST handler**. Any caller that can reach the route can overwrite any studio's wall config.

---

### 7b. All callers of `POST /api/studios/[id]/wall-config`

All callers are `'use client'` components or hooks that send `fetch(... method: 'POST')`. They trigger the server-side write indirectly.

| Caller | File + line | Context |
|---|---|---|
| `flushWallConfig` | `app/studio/[id]/page.tsx:177-181` | Called when user saves wall config in the floor editor |
| First-load default persist | `app/studio/[id]/page.tsx:310-315` | Writes `DEFAULT_CONFIG` to storage when no config exists yet |
| `StudioRoom` save callback | `components/3d/StudioRoom.tsx:588-593` | Called after wall edits, with `keepalive: true` for tab-close safety |

All three callers are in `'use client'` components. They POST JSON (not a file). The actual Supabase storage write happens server-side via the route handler using the service role key.

---

### 7c. Read-only references to `wall-configs/` (not writes)

| File | Line | What it does |
|---|---|---|
| `scripts/cleanup-orphan-storage.ts:106` | `.list('wall-configs', ...)` | Cleanup script lists configs to find model URL references — read only, never writes |
| `scripts/cleanup-orphan-storage.ts:117-118` | `.download(filePath)` | Downloads each config JSON to extract model URLs — read only |
| `scripts/cleanup-orphan-storage.ts:170` | `!p.startsWith('wall-configs/')` | Excludes wall-config paths from orphan deletion — no storage mutation |
| `app/api/studios/[id]/wall-config/route.ts:11` | `.download(filePath)` | GET handler reads config — no write |
| `app/studio/[id]/page.tsx:283` | `fetch(...wall-config)` GET | Client reads config on load — no write |
| `app/studio/[id]/view/page.tsx:229-230` | `fetch(...wall-config)` GET | View-only page reads config — no write |
| `app/share/[token]/page.tsx:212` | `fetch(...wall-config)` GET | Share page reads config — no write |
| `lib/studioViewCache.ts:83-84` | `fetch(...wall-config)` GET | Cache preloader reads config — no write |
| `components/Gallery3D.tsx:916` | `fetch(...wall-config)` GET | Gallery reads config — no write |

---

**Conclusion:** Wall-config writes are SERVER-SIDE via service role (RLS bypassed). The single storage `upload()` call lives exclusively in the `POST /api/studios/[id]/wall-config` route handler and always uses `supabaseServiceRole()` with `SUPABASE_SERVICE_ROLE_KEY`. No client component writes directly to the `wall-configs/` path. The POST handler itself has no auth guard — it relies on the caller being a logged-in studio owner in practice but does not enforce this server-side.

---

## 8. /api/upload write mechanism

### 8a. Supabase client used for storage writes

**Import** (`app/api/upload/route.ts:2`):
```ts
import { supabaseServer, supabaseServiceRole } from '@/lib/supabase/server'
```

**Client construction** (`app/api/upload/route.ts:8`):
```ts
const supabase = supabaseServer()
```

`supabaseServer()` is defined in `lib/supabase/server.ts:5-27`:
```ts
export const supabaseServer = () => {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,   // ← anon key, NOT service role
    { cookies: { get, set, remove } }              // ← reads caller's cookie session
  )
}
```

This is a **user-session client** (`createServerClient` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + cookie passthrough). **RLS applies.** The client acts as the authenticated user whose cookie is present in the incoming request.

`supabaseServiceRole()` is also imported and used in this file, but **only for**:
- Room lookup validation (`adminForRoomLookup`, line 160)
- RLS-fallback DB insert (`admin`, line 217)
- Storage `.remove()` rollback on failure (lines 285, 322)

It is **not** used for the storage `.upload()` calls.

---

### 8b. How `userId` is determined

`app/api/upload/route.ts:10-19`:
```ts
const {
  data: { session },
  error: sessionError,
} = await supabase.auth.getSession()

// ...

const userId = session?.user?.id
if (!userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

`userId` comes exclusively from the authenticated cookie session — not from the request body, URL params, or any client-supplied value.

---

### 8c. Exact `.upload()` calls

**Full image** (`app/api/upload/route.ts:259-264`):
```ts
const { error: uploadError } = await supabase.storage
  .from('board-images')
  .upload(filePath, uploadBuffer, {
    contentType: uploadContentType,
    upsert: false,
  })
```

**Thumbnail** (`app/api/upload/route.ts:275-279`):
```ts
const { error: thumbUploadError } = await supabase.storage
  .from('board-images')
  .upload(thumbnailPath, thumbnailBuffer, {
    contentType: uploadContentType,
    upsert: false,
  })
```

Both calls use `supabase` (the user-session client). Both use `upsert: false`.

---

### 8d. Object path strings

**Path construction** (`app/api/upload/route.ts:149-153`):
```ts
const ext = isPdf ? (uploadFile.name.split('.').pop() || 'jpg') : 'jpg'
const timestamp = Date.now()
const baseSlug = `${userId}/${timestamp}-${Math.random().toString(36).substring(7)}`
const filePath = `${baseSlug}.${ext}`
const thumbnailPath = thumbnailBuffer ? `${baseSlug}-thumb.${ext}` : null
```

Examples:
```
abc123def456/1716400000000-k8j2x1.jpg          ← full image (non-PDF)
abc123def456/1716400000000-k8j2x1-thumb.jpg    ← thumbnail
abc123def456/1716400000000-k8j2x1.pdf          ← PDF (no sharp, no thumb)
```

The path **always begins with `{userId}/`** — the authenticated session's user ID, not anything supplied by the client.

---

**Conclusion:** /api/upload uses USER SESSION — strict RLS policy will block it unless path starts with the authenticated user's uid.

---

## 9. Membership check inventory

### 9a. Dedicated helper functions — NONE

No canonical `isWorkspaceMember`, `requireMember`, `assertMember`, `checkWorkspaceAccess`, or similar utility exists anywhere in `lib/`, `utils/`, or `db/`. The relevant `lib/` files are:

| File | Contents |
|---|---|
| `lib/workspaceUtils.ts` | Slug generator, ID generator only — no auth/membership logic |
| `lib/rooms.ts` | `resolveFirstRoomId` / `resolveMainRoomId` — resolves first room in a workspace, no membership check |
| `lib/auth/isAdmin.ts` | Admin check only |

**Every membership check is currently inline, duplicated per route.**

---

### 9b. Existing API routes that do membership gating

**Route 1 — `app/api/boards/route.ts:300-326` (PATCH board)**

Uses `supabaseServiceRole()` (`adminDb`). Pattern: check workspace owner → then check `workspace_members`.

```ts
// app/api/boards/route.ts:300-326
const { data: workspace } = await adminDb
  .from('workspaces').select('owner_id').eq('id', boardData.workspace_id).single()
const isWorkspaceOwner = workspace?.owner_id === userId
const { data: membership } = await adminDb
  .from('workspace_members').select('user_id')
  .eq('workspace_id', boardData.workspace_id).eq('user_id', userId).maybeSingle()
// ...
const canEdit = boardData.owner_id === userId || isWorkspaceOwner || membership !== null
if (!canEdit) return NextResponse.json({ error: '...' }, { status: 403 })
```

**Route 2 — `app/api/rooms/[id]/share/route.ts:44-54` (POST share token)**

Uses `supabaseServiceRole()` (`admin`). Pattern: check owner first, then member if not owner.

```ts
// app/api/rooms/[id]/share/route.ts:44-54
if (ws.owner_id !== userId) {
  const { data: membership } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', room.workspace_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

**Route 3 — `app/api/upload/route.ts:218-236` (POST upload, fallback path)**

Uses `supabaseServiceRole()` (`admin`). RLS fallback — runs only when the initial user-session insert failed.

```ts
// app/api/upload/route.ts:218-236
const { data: workspace } = await admin
  .from('workspaces').select('owner_id, is_public').eq('id', workspaceId).maybeSingle()
const isOwner = workspace?.owner_id === userId
let isMember = false
if (!isOwner) {
  const { data: membership } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle()
  isMember = !!membership
}
if (!workspace || (!isOwner && !isMember && !workspace.is_public)) { /* 403 */ }
```

---

### 9c. `workspace_members` schema (from code evidence)

No `CREATE TABLE workspace_members` exists in the numbered migrations (table was created before migration numbering). Columns inferred from all query patterns across the codebase:

| Column | Type | Evidence |
|---|---|---|
| `user_id` | `TEXT` | All queries use `.eq('user_id', userId)` where `userId = session.user.id` (string); SQL uses `uid::text` |
| `workspace_id` | `UUID` (stored/compared as string) | All queries use `.eq('workspace_id', workspaceId)` |
| `role` | Not present | No query across the codebase selects or filters on a `role` column |

**No `role` column.** Membership is binary: row exists = member.

---

### 9d. Studio → workspace association

The route `app/api/studios/[id]/wall-config/route.ts` is misnamed — its `[id]` parameter is actually the **workspace ID**, not a studio ID. All callers confirm this:

- `app/studio/[id]/page.tsx:175,177`: `const wsKey = workspaceId ?? studioId` → `fetch(\`/api/studios/${wsKey}/wall-config\`)`
- `components/3d/StudioRoom.tsx:588`: `fetch(\`/api/studios/${wsKey}/wall-config\`)`

The `rooms` table bridges workspaces and rooms/studios:

```sql
-- migrations/014_add_rooms_table.sql:37-47
CREATE TABLE rooms (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID  NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT  NOT NULL,
  ...
);
```

So the ownership chain is: `workspaces.id` ← `rooms.workspace_id`. The `[id]` param in the wall-config route IS `workspaces.id` — no join needed.

---

### Recommended check for P2c

**No import change needed** — `supabaseServer` and `supabaseServiceRole` are already imported in `app/api/studios/[id]/wall-config/route.ts:2`.

Insert this block at the top of the `POST` handler body, before `await request.json()`:

```ts
// Verify caller is authenticated and owns or is a member of workspace `id`
const { data: { session } } = await supabaseServer().auth.getSession()
if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const userId = session.user.id
const admin = supabaseServiceRole()
const { data: ws } = await admin.from('workspaces').select('owner_id').eq('id', id).maybeSingle()
if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })
if (ws.owner_id !== userId) {
  const { data: m } = await admin.from('workspace_members').select('user_id')
    .eq('workspace_id', id).eq('user_id', userId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

**Why service role for the membership query:** The handler already uses `supabaseServiceRole()` for the storage write; using it for the membership lookup avoids a second cookie-session client construction and sidesteps any RLS recursion on `workspace_members`. This matches the pattern used in `app/api/rooms/[id]/share/route.ts:45` and `app/api/boards/route.ts:308`.

---

## 10. /api/upload call sites

Grepped: `fetch('/api/upload')`, `/api/upload` string literals in `*.ts`/`*.tsx`. Four live call sites found. `app/studio/[id]/page.tsx:372` is a code comment only.

---

### CS-1 — `hooks/useBoardUpload.ts:414` — `uploadFile` (image single-upload)

**Component/function:** Module-level function `uploadFile` (not a React component)  
**Client/server:** `'use client'` at line 1  
**File types:** Image only (`isPDF: false` hardcoded at line 401)

**FormData construction** — delegates to `createBoardFormData` (`hooks/useBoardUpload.ts:98–163`):
```ts
formData.append('image', file)
formData.append('studioId', options.studioId)
formData.append('workspaceId', ...)      // explicit workspaceId (post-6.2b fix)
formData.append('roomId', ...)           // Phase 6.1 room id
formData.append('title', ...)
formData.append('studentName', ...)      // clerkName if present
formData.append('description', '')
formData.append('tags', '')
formData.append('originalWidth/Height/aspectRatio', ...)
formData.append('physicalWidth/Height', ...)   // if available from EXIF
formData.append('position_wall_index/x/y/width/height/side', ...) // if on wall
formData.append('ownerId', ...)
formData.append('ownerName', ...)
formData.append('ownerColor', ...)
```

**10-line snippet (lines 404–427):**
```ts
    })

    const response = await fetch('/api/upload', { method: 'POST', body: formData })

    if (!response.ok) {
      const errorText = await response.text()
      let errMsg = errorText || `Upload failed (${response.status})`
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error) errMsg = parsed.error
        if (parsed.missing?.length) errMsg += ` - missing: ${parsed.missing.join(', ')}`
      } catch {
        // use errMsg as-is
      }
      throw new Error(errMsg)
    }

    const data = await response.json()
    let uploadedBoard = data.board as Board
```

**Response handling:** Parses `data.board as Board`. Then calls `replaceTempBoardInState` to swap the optimistic temp blob board for the real board, revokes the blob URL, and returns `{ success: true, uploadedBoard }`.

---

### CS-2 — `hooks/useBoardUpload.ts:586` — `uploadPDF` (PDF multi-page loop)

**Component/function:** Module-level function `uploadPDF`  
**Client/server:** `'use client'` at line 1  
**File types:** PDF only (`isPDF: true` hardcoded at line 573). Each page is a converted-to-image `File` from `pdfToImage`.

**FormData construction** — also delegates to `createBoardFormData`, per-page:
```ts
// per page in loop:
formData.append('image', page.imageFile)  // converted JPEG
formData.append('studioId', options.studioId)
formData.append('workspaceId', ...)
formData.append('roomId', ...)
formData.append('title', pageTitle)        // "filename - Page N" if multi-page
formData.append('tags', 'pdf')
formData.append('physicalWidth/Height', ...) // from PDF page metadata
formData.append('position_...', ...)         // grid position per page
```

**10-line snippet (lines 581–600):**
```ts
      })

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`)
      }

      const data = await response.json()
      let uploadedBoard = data.board as Board
      const editingSide = options.editingWallSide || 'front'
      if (uploadedBoard?.position && options.editingWall !== null) {
        uploadedBoard = { ...uploadedBoard, position: { ...uploadedBoard.position, side: editingSide } }
      }
```

**Response handling:** Parses `data.board as Board`, patches `position.side`, then calls `replaceTempBoardInState`. On success increments `successCount`.

---

### CS-3 — `components/WallCanvasEditor.tsx:193` — `handleFileSelect` PDF branch

**Component/function:** `handleFileSelect` inside `WallCanvasEditor` component  
**Client/server:** `'use client'` at line 1  
**File types:** PDF only (converted to image pages via `pdfToImage` before upload)

**FormData construction** — inline, simpler than CS-1/CS-2:
```ts
const formData = new FormData()
formData.append('image', page.imageFile)
formData.append('studioId', studioId)    // NO separate workspaceId
formData.append('title', pageTitle)
formData.append('studentName', 'Uploaded Board')  // hardcoded string
formData.append('description', 'PDF Document')
formData.append('tags', 'pdf')
formData.append('originalWidth', page.width.toString())
formData.append('originalHeight', page.height.toString())
formData.append('aspectRatio', page.aspectRatio.toString())
// physicalWidth/Height appended if present
// NO position fields, NO ownerName/ownerColor
```

**10-line snippet (lines 183–208):**
```ts
          if (page.physicalWidth && page.physicalHeight) {
            formData.append('physicalWidth', page.physicalWidth.toString())
            formData.append('physicalHeight', page.physicalHeight.toString())
          }

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })

          if (response.ok) {
            const data = await response.json()
            const newBoard = data.board as Board
            setAvailableBoardsState((prev: Board[]) => [...prev, newBoard])
            uploadedBoards.push(newBoard)
```

**Response handling:** On `response.ok`, parses `data.board as Board`, pushes to `availableBoards` state and a local `uploadedBoards` array. After the loop, calls `setPlacedBoards` to grid-arrange all uploaded pages on the wall. No optimistic temp board — upload-then-display.

---

### CS-4 — `components/WallCanvasEditor.tsx:292` — `handleFileSelect` image branch

**Component/function:** `handleFileSelect` inside `WallCanvasEditor` component  
**Client/server:** `'use client'` at line 1  
**File types:** Image only (JPEG, PNG; WebP falls through to this branch via `validTypes` check at line 137)

**FormData construction** — inline:
```ts
const formData = new FormData()
formData.append('image', uploadFile)
formData.append('studioId', studioId)    // NO separate workspaceId
formData.append('title', file.name.replace(/\.[^/.]+$/, ''))
formData.append('studentName', 'Uploaded Board')  // hardcoded string
formData.append('description', '')
formData.append('tags', '')
formData.append('originalWidth', width.toString())
formData.append('originalHeight', height.toString())
formData.append('aspectRatio', aspectRatio.toString())
// physicalWidth/Height appended if present via dims cast
// NO position fields, NO ownerName/ownerColor, NO workspaceId/roomId
```

**10-line snippet (lines 285–311):**
```ts
        formData.append('aspectRatio', aspectRatio.toString())

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (response.ok) {
          const data = await response.json()
          const newBoard = data.board as Board
          setAvailableBoardsState((prev: Board[]) => [...prev, newBoard])

          setPlacedBoards((prev) => {
            if (prev.some(pb => pb.board.id === newBoard.id)) return prev
            return [...prev, { board: newBoard, x: 50, y: 50 }]
          })
```

**Response handling:** On `response.ok`, parses `data.board as Board`, adds to `availableBoards` state, auto-places at center (50%, 50%) on the current wall. No temp board.

---

### Key architectural note for Phase 4 cutover

`useDirectUpload` (P3) handles **storage only** and returns `{ fullUrl, thumbnailUrl, storagePath }`. The current `/api/upload` handler also **creates the `boards` DB record** (inserts placeholder row, sets `upload_status='complete'` after storage succeeds). A full cutover requires a second step — a new POST to `/api/boards` (or equivalent) to write the board metadata — or an expanded hook that also does the DB insert via a thin API endpoint. This is the primary design decision for Phase 4.

---

## Cutover order

| # | Call site | Justification |
|---|-----------|---------------|
| 1 | **CS-4** `WallCanvasEditor.tsx:292` — image branch | Simplest: single file, inline FormData, no temp board, no position fields. Validates the hook end-to-end before touching the more complex paths. |
| 2 | **CS-3** `WallCanvasEditor.tsx:193` — PDF branch | Same file, same function, similar simplicity. PDF pages arrive as already-converted JPEG blobs so the hook's image path handles them identically. After CS-4 works, CS-3 is a small addition. |
| 3 | **CS-2** `useBoardUpload.ts:586` — `uploadPDF` | More complex (temp board, grid position, loop), but lower traffic than the image path. PDF upload is infrequent, making it safer to migrate and observe before touching the hot path. |
| 4 | **CS-1** `useBoardUpload.ts:414` — `uploadFile` | Highest traffic, most fields (EXIF physical dims, position, owner color, optimistic blob temp board). Migrate last, after the other three are stable. |

**Why `workspaces.owner_id` covers the owner case without a membership row:** The `workspace_members` table does not include the workspace owner — only invited members have rows. The owner check must come first, exactly as in all three existing gating routes.

---

## 11. /api/upload full behavior

Full read of `app/api/upload/route.ts` (364 lines). No external SDK imports beyond `next/server`, `@/lib/supabase/server`, `@/lib/rooms`, and `sharp`.

---

### a) Streaming / SSE

**None.** Single `NextResponse.json()` at line 358. All work (compression, DB writes, storage uploads) completes before the response is returned.

---

### b) Audit logs

**None.** No inserts to `audit_log`, `activity`, `events`, or any similar table. Confirmed by grepping the file — zero hits.

---

### c) Analytics

**None.** No PostHog, Mixpanel, Segment, GA, or other tracking SDK calls. No `import` of any analytics library.

---

### d) Sentry

**None.** No manual `Sentry.captureMessage`, `addBreadcrumb`, `setContext`, `setTag`, or `startTransaction` calls. Only `console.error` / `console.warn` are used.

---

### e) Email

**None.** No Resend, SendGrid, or Nodemailer calls.

---

### f) Notifications / Realtime

**None from the handler.** No explicit Realtime broadcast or `NOTIFY` call. However, Supabase Realtime picks up the `boards` INSERT/UPDATE automatically because `app/studio/[id]/page.tsx` subscribes to `postgres_changes` on the `boards` table. That subscription fires as a side effect of the DB write, not a direct call from this handler.

---

### g) Auxiliary DB writes

Only the `boards` table is written to. All other table accesses are **reads only**:

| Table | Operation | Line | Notes |
|-------|-----------|------|-------|
| `user_profiles` | SELECT `full_name` | 24–29 | Read-only; used to populate `student_name` fallback |
| `rooms` | SELECT `id, workspace_id` | 163–167 | Read-only; validates roomId cross-workspace |
| `rooms` | SELECT `id` via `resolveMainRoomId` | 176 | Read-only; finds first room by display_order |
| `workspaces` | SELECT `owner_id, is_public` | 218–222 | Read-only; RLS fallback path only |
| `workspace_members` | SELECT `user_id` | 227–233 | Read-only; RLS fallback path only |
| `boards` | **INSERT** placeholder | 208–212 | `upload_status='pending'`, empty URLs |
| `boards` | **UPDATE** to complete | 307–316 | Sets `thumbnail_url`, `full_image_url`, `upload_status='complete'` |
| `boards` | **DELETE** rollback | 269, 286, 323 | Only on failure paths |

```ts
// app/api/upload/route.ts:208-212 — placeholder insert
let { data: pendingBoard, error: insertError } = await supabase
  .from('boards')
  .insert(placeholderData)
  .select()
  .single()

// app/api/upload/route.ts:306-316 — flip to complete
const adminUpdate = supabaseServiceRole()
const { data: savedBoard, error: dbError } = await adminUpdate
  .from('boards')
  .update({ thumbnail_url: thumbnailUrl, full_image_url: imageUrl, upload_status: 'complete' })
  .eq('id', boardId)
  .select()
  .single()
```

---

### h) Image processing beyond compression

**Only two sharp variants (main + thumb). No explicit EXIF operations, but:**

- `sharp()` **auto-rotates based on EXIF orientation by default** (behavior since sharp ≥ 0.28 / libvips auto-orient). No explicit `.rotate()` call, but EXIF orientation is silently corrected.
- `.jpeg()` output **strips most EXIF** by default (sharp drops metadata unless `.withMetadata()` is called — it is not called here).
- No palette extraction. `ownerColor` comes from the client (`formData.get('ownerColor')`) — it is not computed server-side.
- No additional variants beyond full (2400 px / q85) and thumb (800 px / q75).
- PDF files skip sharp entirely (`isPdf` branch, line 119): the raw buffer is uploaded unchanged.

```ts
// app/api/upload/route.ts:122-135
const [fullJpeg, thumbJpeg] = await Promise.all([
  sharp(inputBuffer)
    .resize({ width: 2400, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer(),
  sharp(inputBuffer)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer(),
])
uploadBuffer = fullJpeg
thumbnailBuffer = thumbJpeg
uploadContentType = 'image/jpeg'
```

---

### i) Validation

Beyond auth + file type + size, the handler checks:

| Check | Code location | Behavior on failure |
|-------|---------------|---------------------|
| `workspaceId` present and non-empty | Line 86–95 | 400 `{ error, missing: [...] }` |
| `image` field present and non-zero size | Line 87 | 400 |
| `roomId` belongs to the given workspace | Lines 162–173 | 400 `roomId does not belong...` |
| Workspace ownership or membership (RLS fallback) | Lines 214–242 | 403 |

No quota check, no board-count limit, no file-content sniffing, no virus scan.

```ts
// app/api/upload/route.ts:162-173 — roomId cross-workspace check
if (roomIdFromRequest) {
  const { data: room } = await adminForRoomLookup
    .from('rooms').select('id, workspace_id')
    .eq('id', roomIdFromRequest).maybeSingle()
  if (!room || room.workspace_id !== workspaceId) {
    return NextResponse.json(
      { error: 'roomId does not belong to the given workspace' }, { status: 400 }
    )
  }
  resolvedRoomId = room.id as string
}
```

---

### j) Error rollback

Three rollback points, all synchronous best-effort deletes:

```ts
// Storage upload fails → delete placeholder boards row
// app/api/upload/route.ts:266-270
const adminCleanup = supabaseServiceRole()
await adminCleanup.from('boards').delete().eq('id', boardId)
return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })

// Thumbnail upload fails → remove main storage object + delete boards row
// app/api/upload/route.ts:282-288
const adminCleanup = supabaseServiceRole()
await adminCleanup.storage.from('board-images').remove([filePath])
await adminCleanup.from('boards').delete().eq('id', boardId)
return NextResponse.json({ error: 'Failed to upload thumbnail' }, { status: 500 })

// DB update (flip to complete) fails → remove all storage objects + delete boards row
// app/api/upload/route.ts:318-325
const objectsToRemove = thumbnailPath ? [filePath, thumbnailPath] : [filePath]
await adminUpdate.storage.from('board-images').remove(objectsToRemove)
await adminUpdate.from('boards').delete().eq('id', boardId)
return NextResponse.json({ error: 'Failed to save board' }, { status: 500 })
```

No temp files on disk — all processing is in-memory Node.js buffers.

---

### k) Response shape

**Success (HTTP 200):**
```ts
{ success: true, board: Board }
```
where `Board` (frontend shape) is:
```ts
{
  id: string                  // "board-{ts}-{rand6}"
  studioId: string            // = workspaceId (backward-compat alias)
  workspaceId: string
  studentName: string | null
  studentEmail: string | null
  title: string
  description: string | null
  thumbnailUrl: string        // public Supabase Storage URL
  fullImageUrl: string        // public Supabase Storage URL
  tags: string[]
  uploadedAt: string          // ISO 8601
  position?: {
    wallIndex: number
    x: number                 // 0-100 percentage
    y: number
    width?: number
    height?: number
    side: 'front' | 'back'
  }
  ownerId: string
  ownerName: string
  ownerColor: string | null
  originalWidth: number | null
  originalHeight: number | null
  aspectRatio: number | null
  physicalWidth: number | null
  physicalHeight: number | null
}
```

**Error responses:**
```ts
// 400 — missing fields
{ error: 'Missing required fields', missing: string[] }
// 400 — size/type/roomId
{ error: string }
// 401
{ error: 'Unauthorized' }
// 403
{ error: 'Not authorized to save board in this workspace' }
// 500
{ error: string }  // e.g. 'Failed to upload image', 'Failed to save board'
```

---

### Replication checklist for /api/boards

When `/api/upload` is replaced by client-side `useDirectUpload` (storage) + a new `/api/boards` POST (DB record), the following must be decided:

| Side effect | Must preserve? | Where it moves |
|-------------|---------------|----------------|
| Placeholder-row pattern (`pending` → `complete`) | **Yes** — prevents Realtime subscribers from seeing empty-URL rows | Keep in `/api/boards`: insert pending, signal client, client confirms URLs exist |
| `resolveMainRoomId` lookup | **Yes** — every board must have a `room_id` | Stays in `/api/boards` (server reads `rooms` table) |
| roomId cross-workspace validation | **Yes** — security check | Stays in `/api/boards` |
| RLS fallback ownership/membership check | **Yes** — needed when session RLS is misaligned | Stays in `/api/boards` |
| sharp image compression (main + thumb) | **Move to client** — `useDirectUpload` already does this with `browser-image-compression`; avoid double-compression | Remove from `/api/upload`/`/api/boards`; it's done in the hook |
| EXIF auto-orient | **Move to client** — `browser-image-compression` preserves orientation; sharp's auto-orient is no longer needed when the file arrives already correct | n/a once sharp is removed |
| EXIF strip | **Low priority** — sharp strips by default; `browser-image-compression` output is also clean | n/a |
| `ownerColor` generation | **Already on client** — `generateOwnerColor(userId)` called in `createBoardFormData`; server just stores what's sent | No change needed |
| Board ID generation | **Move to client** — can generate `board-{ts}-{rand}` client-side and pass to `/api/boards` | Or keep server-side; either works |
| `user_profiles` read for `student_name` fallback | **Keep in `/api/boards`** — requires server session to read private profile data | Stays in `/api/boards` |
| Rollback (storage remove + boards delete on failure) | **Split**: storage remove on client (hook), boards delete in `/api/boards` | Hook should accept optional `storagePaths` to clean up on its side; `/api/boards` cleans its own row |

---

## 12. WallCanvasEditor upload semantics

Source: `components/WallCanvasEditor.tsx` (419 lines total).

---

### a) What the component does with the response

Both call sites (PDF at line 193, image at line 292) parse `data.board as Board` and then:

1. Push the new `Board` into `availableBoardsState` (local component state — a sidebar list of uploadable boards).
2. Push it into `placedBoards` (either center-placed at `{x:50, y:50}`, or grid-arranged for PDF pages).
3. Do **not** call `/api/studios/[id]/wall-config`, write a wall-config JSON, or POST to any other endpoint.

The wall-config is written only when the user clicks "Save & Exit" via `handleSave` → `onSave` callback:

```ts
// components/WallCanvasEditor.tsx:350-412 — handleSave
const boardPositions = placedBoards.map(pb => ({
  boardId: pb.board.id,
  x: centerX,      // converted from 0-100 CSS % to -0.5..+0.5
  y: centerY,
  width: widthPercent,
  height: heightPercent,
}))
onSave(wallIndex, boardPositions)
```

The `onSave` prop takes board IDs + positions — it doesn't write URLs. The caller is responsible for saving those positions (presumably to wall-config or DB). Since the component is never mounted (see §d), this is never called.

---

### b) Does it create a boards table row?

**Yes** — via `/api/upload`, which creates a full `boards` row (placeholder → complete pattern). The component stores the returned `Board` object in component state but does not make any additional API calls to persist position data independently of `onSave`.

---

### c) Why is workspaceId missing from the FormData?

The `WallCanvasEditorProps` interface only declares `studioId: string` — no `workspaceId`, no `roomId`:

```ts
// components/WallCanvasEditor.tsx:15-22
interface WallCanvasEditorProps {
  wallIndex: number
  studioId: string       // ← only workspace identifier
  allBoards: Board[]
  wallDimensions: WallDimensions
  onSave: (wallIndex: number, boardPositions: Array<{...}>) => void
  onExit: () => void
}
```

This component predates the workspaceId/studioId split introduced in Phase 6.2b. The server handles this gracefully:

```ts
// app/api/upload/route.ts:34
const rawWorkspaceId = (formData.get('workspaceId') ?? formData.get('studioId')) as string | null
```

`workspaceId` is absent so the server falls back to `studioId`. No `roomId` is sent, so `resolveMainRoomId` is called to find the default room.

---

### d) Where is WallCanvasEditor mounted in the app?

**Nowhere.** A codebase-wide grep for `import.*WallCanvasEditor` across all `*.ts`, `*.tsx`, `*.js`, `*.jsx` files returned **zero matches**. The component is defined only in `components/WallCanvasEditor.tsx` and is never imported by any page or layout.

**WallCanvasEditor is dead/unreachable code.**

---

### e) What is studentName used for?

**On the server** (`app/api/upload/route.ts:38-41`):
```ts
const rawStudentName = formData.get('studentName') as string | null
const studentName = (rawStudentName && String(rawStudentName).trim())
  ? String(rawStudentName).trim()
  : (profileName || session?.user?.email?.split('@')[0] || 'Anonymous')
```
Written to `boards.student_name`. If the client sends `'Uploaded Board'` (which both WallCanvasEditor call sites do), the server stores that literal string — it does **not** override with the user's real name.

**On the client**, `student_name` maps to `Board.studentName` and is displayed in board attribution labels in the studio wall UI (e.g., "Uploaded by: Uploaded Board"). Since the WallCanvasEditor is dead, no live UI currently shows this value from these two call sites.

---

### f) Is it the same boards table?

**Yes** — exactly the same `boards` table and `Board` frontend type. The `WallCanvasEditor` path does not use a separate data model, wall-config storage, or embedded JSON. The boards created via these two call sites are full first-class `boards` rows, indistinguishable from those created by `useBoardUpload`.

---

### WallCanvasEditor verdict

**CS-3 and CS-4 should be skipped in the Phase 4 migration and the WallCanvasEditor component should be marked for deletion, not migration.**

Justification: The component is dead code — it has no active import anywhere in the codebase (confirmed by exhaustive grep). No user can reach its upload paths. Migrating CS-3 and CS-4 to `useDirectUpload` + a new `/api/boards` endpoint would be wasted effort on code that is never executed. The correct action is to delete `components/WallCanvasEditor.tsx` entirely after confirming it is not referenced via dynamic import strings or `require()`. The Phase 4 cutover order from Section 10 should be revised: only CS-1 (`useBoardUpload.ts:uploadFile`) and CS-2 (`useBoardUpload.ts:uploadPDF`) need migration.

---

## 13. CS-1 cutover plan

Source: `hooks/useBoardUpload.ts` — module-level function `uploadFile` (lines 313-494).

---

### a) Code blocks being replaced

**Dynamic import removed (line 322):**
```ts
const { extractImagePhysicalDimensions } = await import('@/lib/extractPhysicalDimensions')
```
Removed together with the physicalDims extraction block below — removing either alone would leave an `@typescript-eslint/no-unused-vars` error.

**physicalDims block (lines 381-389) — removed:**
```ts
  let physicalWidth: number | undefined
  let physicalHeight: number | undefined
  try {
    const physicalDims = await extractImagePhysicalDimensions(file)
    physicalWidth = physicalDims.physicalWidth
    physicalHeight = physicalDims.physicalHeight
  } catch {
    // optional
  }
```

**formData + fetch block (lines 391-430) — replaced:**
```ts
    const formData = createBoardFormData(file, {
      studioId: options.studioId,
      roomId: options.roomId,
      workspaceId: options.workspaceId,
      title,
      user: options.user,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
      isPDF: false,
      physicalWidth,
      physicalHeight,
      position: options.editingWall !== null && options.editingWallDimensions ? {
        wallIndex: options.editingWall,
        x: 0,
        y: 0,
        width: widthPercent,
        height: heightPercent,
        side: options.editingWallSide || 'front',
      } : undefined,
    })

    const response = await fetch('/api/upload', { method: 'POST', body: formData })

    if (!response.ok) {
      const errorText = await response.text()
      let errMsg = errorText || `Upload failed (${response.status})`
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error) errMsg = parsed.error
        if (parsed.missing?.length) errMsg += ` - missing: ${parsed.missing.join(', ')}`
      } catch {
        // use errMsg as-is
      }
      throw new Error(errMsg)
    }

---

## 17. PDF upload bugs — diagnosis

_Date: 2026-05-23. Diagnosis only — no code modified. `npx tsc --noEmit` exit 0 (no type errors)._

---

### Bug 1: PDF page renders at ~1% size on the wall

#### 1. `calculateBoardDimensions` return values — units

`hooks/useBoardUpload.ts:65-94`

```typescript
const baseHeightPercent = 0.30   // 30 % of wall height
const maxWidthPercent   = 0.50   // 50 % cap
const maxHeightPercent  = 0.50   // 50 % cap
// ...
return { widthPercent, heightPercent }
// e.g. → { widthPercent: 0.30, heightPercent: 0.22 }
```

**Unit: 0.0–1.0 decimal** (0.30 = 30 % of wall dimension).

---

#### 2. `calculateGridPosition` return values — units

`hooks/useBoardUpload.ts:43-60` (JSDoc comment at lines 41–42 confirms):

```typescript
const gridX = spacingX + col * (boardWidth + spacingX) + boardWidth / 2 - 0.5
const gridY = spacingY + row * (boardHeight + spacingY) + boardHeight / 2 - 0.5
return { x: gridX, y: gridY, width: boardWidth, height: boardHeight }
```

**Unit: x/y are −0.5 to +0.5 normalized (wall center = 0, 0).  
width/height are 0.0–1.0 decimal (fraction of wall).**

---

#### 3. `uploadPDF` → `createTempBoard` call — position.width/height NOT × 100

`hooks/useBoardUpload.ts:531-550`:

```typescript
const tempBoard = createTempBoard(tempBoardId, {
  ...
  position: {
    wallIndex: options.editingWall,
    x: gridPos.x,          // −0.5..+0.5 normalized
    y: gridPos.y,          // −0.5..+0.5 normalized
    width: widthPercent,   // 0.30 decimal  ← BUG: not × 100
    height: heightPercent, // 0.22 decimal  ← BUG: not × 100
    side: options.editingWallSide || 'front',
  }
})
```

`widthPercent` and `heightPercent` are passed **without × 100**.

---

#### 4. `uploadPDF` → `addTempBoardToState` call — no × 100 (correct for `placedBoards3D`)

`hooks/useBoardUpload.ts:552-557`:

```typescript
addTempBoardToState(
  tempBoard,
  { x: gridPos.x, y: gridPos.y, width: widthPercent, height: heightPercent },
  { ... }
)
```

The second argument populates the `placedBoards3D` map, which uses normalized 0.0–1.0 for width/height. No × 100 here is **intentional and correct** — `uploadFile` also passes `width: widthPercent` (no × 100) to `addTempBoardToState`.

---

#### 5. `uploadPDF` → JSON payload to `/api/boards` — × 100 IS applied

`hooks/useBoardUpload.ts:578-586`:

```typescript
position: {
  wallIndex: options.editingWall,
  x: (gridPos.x + 0.5) * 100,        // −0.5..+0.5 → 0..100  ✓
  y: (gridPos.y + 0.5) * 100,        // −0.5..+0.5 → 0..100  ✓
  widthPercent:  widthPercent * 100,  // 0.30 → 30             ✓
  heightPercent: heightPercent * 100, // 0.22 → 22             ✓
  side: options.editingWallSide ?? 'front',
},
```

The API payload is **correct**. The unit mismatch only affects the optimistic temp board.

---

#### 6. `uploadFile` (working path) — comparison

**`createTempBoard` call** (`hooks/useBoardUpload.ts:349-366`):

```typescript
position: {
  wallIndex: options.editingWall,
  x: CENTER_API,             // 50  (0–100 API units)     ✓
  y: CENTER_API,             // 50  (0–100 API units)     ✓
  width: widthPercent * 100, // 0.30 → 30                 ✓  ← × 100 present
  height: heightPercent * 100,                            // ✓  ← × 100 present
  side: options.editingWallSide || 'front',
}
```

**`addTempBoardToState` call** (`hooks/useBoardUpload.ts:368-379`):

```typescript
addTempBoardToState(
  tempBoard,
  { x: 0, y: 0, width: widthPercent, height: heightPercent }, // 0.0–1.0 for placedBoards3D ✓
  ...
)
```

**JSON payload to `/api/boards`** (`hooks/useBoardUpload.ts:396-405`):

```typescript
position: {
  x: CENTER_API,                     // 50 (already 0–100)  ✓
  y: CENTER_API,
  widthPercent: widthPercent * 100,  // × 100               ✓
  heightPercent: heightPercent * 100,
  side: options.editingWallSide ?? 'front',
}
```

**Side-by-side:**

| | `createTempBoard.position.width` | `addTempBoardToState.width` | `/api/boards` widthPercent |
|---|---|---|---|
| `uploadFile` | `widthPercent * 100` = **30** ✓ | `widthPercent` = 0.30 ✓ | `widthPercent * 100` = 30 ✓ |
| `uploadPDF` | `widthPercent` = **0.30** ✗ | `widthPercent` = 0.30 ✓ | `widthPercent * 100` = 30 ✓ |

---

#### 7. Database units — expected convention

**POST `/api/boards`** (`app/api/boards/route.ts:597-598`):
```typescript
const positionWidth  = typeof raw.position?.widthPercent  === 'number' ? raw.position.widthPercent  : null
const positionHeight = typeof raw.position?.heightPercent === 'number' ? raw.position.heightPercent : null
```
Client sends `widthPercent * 100` (e.g., 30). DB stores **0–100 percentage**.

**GET `/api/boards`** (`app/api/boards/route.ts:203-204`):
```typescript
width:  board.position_width  != null ? Number(board.position_width)  : undefined,
height: board.position_height != null ? Number(board.position_height) : undefined,
```
Returns raw numeric from DB → `Board.position.width` on client is **0–100 percentage**.

**PUT `/api/boards`** (`app/api/boards/route.ts:268-269`):
```typescript
if (board.position.width  !== undefined) updateData.position_width  = board.position.width.toString()
if (board.position.height !== undefined) updateData.position_height = board.position.height.toString()
```
Accepts caller's value as-is — caller must already supply **0–100 percentage**.

**→ DB convention: `position_width` / `position_height` store 0–100 percentage  
(e.g., 30 = 30 % of wall width). `Board.position.width/height` on the client must match.**

Expected rows for a recent PDF board: `position_width ≈ 30`, `position_height ≈ 22` (not 0.30 / 0.22).  
Expected rows for a recent image board: same range — `position_width` 20–50, `position_height` 20–50.

---

#### 8. Unit mismatch — exact location and lines needing the fix

Primary: `hooks/useBoardUpload.ts:547-548` inside `uploadPDF`'s `createTempBoard` call:

```typescript
// Current (wrong):
width: widthPercent,   // 0.30 — factor-of-100 short of Board.position.width convention
height: heightPercent, // 0.22

// Must be:
width: widthPercent * 100,   // 30
height: heightPercent * 100, // 22
```

Secondary (x/y also wrong in same call): `hooks/useBoardUpload.ts:545-546`:

```typescript
// Current (wrong):
x: gridPos.x,   // −0.13 normalized — Board.position.x expects 0–100 (37)
y: gridPos.y,   // −0.08 normalized — Board.position.y expects 0–100 (42)

// Must be:
x: (gridPos.x + 0.5) * 100,
y: (gridPos.y + 0.5) * 100,
```

The `/api/boards` payload at lines 580-584 already applies these conversions correctly. Only the `createTempBoard` call is missing them.

**Impact scope:** DB record is correct. After `replaceTempBoardInState` swaps in the real board (which has correct 0–100 values from the API response), the final board renders at the right size. Only the optimistic temp board (visible during upload) is tiny and misplaced.

---

### Bug 2: Second PDF upload showed brief flicker then disappeared

#### 1. Per-page error handlers that swallow exceptions and call `cleanupTempBoard`

`hooks/useBoardUpload.ts:626-636`:

```typescript
} catch (error) {
  console.error(`[Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
  if (pageBlobUrl) URL.revokeObjectURL(pageBlobUrl)
  if (tempBoardId) {
    cleanupTempBoard(tempBoardId, {
      removeTempBoard: options.removeTempBoard,
      setPlacedBoards3D: options.setPlacedBoards3D,
      placedBoards3DRef: options.placedBoards3DRef,
    })
  }
}
```

**Yes.** The per-page catch calls `cleanupTempBoard` (removes the temp board from wall and `placedBoards3D`) and logs to `console.error` only. There is **no `toast.error` call**. The loop does not `break` — it continues to the next page. If every page fails, all temp boards disappear silently. This perfectly matches "boards appear, flicker, disappear, no error visible."

---

#### 2. Rate limiting, cooldown, or session refresh

No explicit rate limit or cooldown in `useBoardUpload.ts`. `useDirectUpload` calls `supabase.auth.getUser()` fresh on every `upload()` invocation (`lib/useDirectUpload.ts:53`). If the Supabase JWT rotates between the two PDF uploads, `getUser()` returns `null`, throws `"Not authenticated"` — caught silently by the per-page catch.

---

#### 3. Duplicate temp-board-id collision

`hooks/useBoardUpload.ts:529`:

```typescript
tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
```

The 9-character base-36 suffix gives 36⁹ ≈ 1.6 trillion combinations. Collision probability is negligible.

---

#### 4. `upsert: false` storage path collision between rapid uploads

`lib/useDirectUpload.ts:57-58`:

```typescript
const ts   = Date.now()
const rand = Math.random().toString(36).substring(7)
```

`substring(7)` extracts from position 7 of a base-36 string like `"0.4fzyo82vzxi"` — roughly 4–5 characters of entropy (lower than the 9-char temp-board-id suffix). Storage path (`lib/useDirectUpload.ts:92`):

```typescript
storagePath = `${userId}/${ts}-${rand}.jpg`
```

Upload uses `upsert: false` (`lib/useDirectUpload.ts:110`):

```typescript
const { error: uploadError } = await supabase.storage
  .from(BUCKET)
  .upload(storagePath, uploadBlob, { contentType, upsert: false })
if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)
```

A same-millisecond collision (same `ts` + same `rand`) yields a 409 from Supabase Storage. The thrown error propagates to the per-page catch, `cleanupTempBoard` runs, board disappears silently. Probability is low but non-zero for back-to-back PDF uploads on fast devices where PDF-to-image conversion is sub-millisecond.

---

#### 5. Console logs emitted by `uploadPDF`

The per-page catch emits: `` console.error(`[Upload PDF] Failed to upload page ${pageIndex + 1}:`, error) ``

No `console.warn` anywhere in `uploadPDF`. Error message from `useDirectUpload` would be one of:
- `"Not authenticated"` — auth failure
- `"Storage upload failed: <Supabase message>"` — e.g., storage 409 or network error
- `"Upload failed: <HTTP status>"` — if `/api/boards` POST returns non-2xx

All visible in browser DevTools → Console; none surface as user-visible toasts.

---

#### Top 3 most likely causes

**Cause A — Silent per-page throw with no user toast (high confidence, structural)**  
Any throw in the per-page try block lands in the catch, which calls `cleanupTempBoard` and logs to console only. "Temp boards appear → disappear → no visible error" is guaranteed by this code path whenever any upload step fails. The root cause of _why_ the second PDF's pages throw is unknown without console output, but the silence is inherent to the current implementation.

**Cause B — `upsert: false` storage path collision (medium confidence)**  
`rand = Math.random().toString(36).substring(7)` produces ~4–5 chars of entropy. Two uploads at the same millisecond have a small chance of generating identical `${userId}/${ts}-${rand}.jpg` paths. The resulting 409 throws silently through the per-page catch. Most likely trigger if the second PDF was uploaded immediately after the first completed.

**Cause C — Supabase auth session rotation between uploads (lower confidence)**  
Supabase auto-refreshes JWTs near expiry. If the session rotated between the two uploads and the client `supabase` instance held a momentarily invalid token, `getUser()` returns `null`, throwing `"Not authenticated"`. All pages fail silently.

**To confirm:** Open browser DevTools → Console, reproduce the failing second upload, and check for `[Upload PDF] Failed to upload page` entries and the error message that follows.

    const data = await response.json()
    let uploadedBoard = data.board as Board
```

---

### b) Temp-board pattern

`uploadFile` runs a full optimistic-update cycle around the API call:

1. **Before API call (lines 341-379):** If `editingWall !== null`, creates a blob URL via `URL.createObjectURL(file)`, pre-warms the texture cache via `loadTexture(blobUrl)`, then calls `flushSync(() => addTempBoardToState(...))` so the board appears on the wall immediately — before any network traffic.
2. **After API call succeeds (lines 440-476):** Pre-warms the CDN URLs (`loadTexture(thumbnailUrl)`, `loadTexture(fullImageUrl)`) with a 3 s hard timeout, then calls `replaceTempBoardInState(tempBoardId, uploadedBoard, ...)` to atomically swap the blob-URL placeholder for the permanent board.
3. **After swap (line 479):** `URL.revokeObjectURL(blobUrl)` cleans up the blob.
4. **On error (lines 484-491):** `URL.revokeObjectURL(blobUrl)` + `cleanupTempBoard(tempBoardId, ...)` removes the optimistic placeholder so the wall is left clean.

The new flow (directUpload + `/api/boards`) does not change steps 1, 2, 3, or 4 — those blocks are untouched. Only the code between `flushSync` and the pre-warm block (the data-fetch section) is replaced.

---

### c) EXIF / physicalDimensions source

`extractImagePhysicalDimensions` (dynamically imported at line 322) reads JPEG APP1/Exif metadata to extract `physicalWidth` and `physicalHeight` in real-world units (e.g. millimetres from DPI tags). These were forwarded to `/api/upload` which stored them in `boards.physical_width` and `boards.physical_height`.

After the cutover, these columns will be `null` for boards created via the new path — the `/api/boards` POST handler hard-codes `physical_width: null, physical_height: null` (line 695-696 of the handler). This is an **accepted regression** documented here; the columns can be populated later if a use case demands it.

`getImageDimensions` (dynamically imported at line 321) is **not removed** — it provides `dims.width`, `dims.height`, and `dims.aspectRatio`, which are still needed for the temp-board aspect ratio and forwarded to `/api/boards` as `width` / `height`.

---

### d) ownerColor source

`generateOwnerColor(userId)` is called at `createBoardFormData` line 159:
```ts
formData.append('ownerColor', generateOwnerColor(options.user.id))
```
It is already 100% client-side (deterministic hash of the user ID). The `/api/upload` server just stores whatever the client sends. The new `/api/boards` POST requires `ownerColor` explicitly (returns 400 if absent). The patched `uploadFile` calls `generateOwnerColor(options.user?.id ?? '')` directly — same function, same value, already imported at `useBoardUpload.ts:5`.

---

### e) Response field comparison

| Field | `/api/upload` response | `/api/boards` response | Used by `uploadFile`? |
|-------|----------------------|----------------------|----------------------|
| `data.board` | ✓ `Board` object | ✓ `Board` object | **Yes** — parsed as `uploadedBoard` |
| `data.board.thumbnailUrl` | ✓ | ✓ | Yes — pre-warm + `replaceTempBoardInState` |
| `data.board.fullImageUrl` | ✓ | ✓ | Yes — pre-warm |
| `data.board.position` | ✓ (when wall set) | ✓ (when wall set) | Yes — side-patch then `replaceTempBoardInState` |
| `data.success` | ✓ `true` | not present (but `data.board` present signals success) | Not used directly; `uploadFile` checks `response.ok` |
| `data.fullUrl` | not returned | ✓ (extra field) | Not used |
| `data.thumbnailUrl` | not returned | ✓ (extra field) | Not used |

Both responses return `data.board as Board`. The only consumer of the response in `uploadFile` is `data.board` — fully compatible.

---

### f) Compatibility verdict

**Full compatibility confirmed.** The new flow is:

```
directUpload(file)              → { storagePath, thumbnailPath }
POST /api/boards (JSON)         → { board: Board }
                                   ↑ data.board — same shape consumed by replaceTempBoardInState
```

The following are identical between old and new paths:
- Temp-board optimistic update (all four stages — unchanged)
- Response consumer (`data.board as Board`)
- `position.side` patch applied after response (unchanged)
- Pre-warm + `replaceTempBoardInState` + blob URL revoke (unchanged)

**React hook constraint:** `uploadFile` is a module-level `async` function — it cannot call `useDirectUpload()` directly. Solution: `useDirectUpload().upload` is called inside the `useBoardUpload` hook (which IS a React hook) and passed as a third parameter `directUpload` to `uploadFile`. Three call sites inside `useBoardUpload` (lines 679, 719, 748) each receive the bound `upload` function.

---

## 14. CS-2 cutover plan

Source: `hooks/useBoardUpload.ts` — module-level function `uploadPDF` (lines 496-632).

---

### a) Current uploadPDF body

```ts
const uploadPDF = async (
  file: File,
  options: UploadOptions
): Promise<{ success: boolean; count: number }> => {
  const { convertPDFToImages } = await import('@/lib/pdfToImage')
  const pages = await convertPDFToImages(file)

  const cols = Math.ceil(Math.sqrt(pages.length))
  const rows = Math.ceil(pages.length / cols)
  let successCount = 0

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]
    const pageTitle = pages.length > 1
      ? `${file.name.replace('.pdf', '')} - Page ${page.pageNumber}`
      : file.name.replace('.pdf', '')

    const { widthPercent, heightPercent } = calculateBoardDimensions(
      page.aspectRatio, options.editingWallDimensions)
    const gridPos = calculateGridPosition(pageIndex, pages.length)

    // Temp board (no flushSync — different from uploadFile)
    let tempBoardId: string | null = null
    let pageBlobUrl: string | null = null
    if (options.editingWall !== null && options.editingWallDimensions) {
      pageBlobUrl = URL.createObjectURL(page.imageFile)
      tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const tempBoard = createTempBoard(tempBoardId, { ..., position: { wallIndex, x: gridPos.x, y: gridPos.y, ... } })
      addTempBoardToState(tempBoard, { x: gridPos.x, y: gridPos.y, width: widthPercent, height: heightPercent }, ...)
    }

    // Upload per page (lines 560-628)
    try {
      const formData = createBoardFormData(page.imageFile, {
        ..., isPDF: true, physicalWidth: page.physicalWidth, physicalHeight: page.physicalHeight,
        position: { wallIndex, x: gridPos.x, y: gridPos.y, width: widthPercent, height: heightPercent, side }
      })
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
      const data = await response.json()
      let uploadedBoard = data.board as Board
      if (uploadedBoard?.position && options.editingWall !== null) {
        uploadedBoard = { ...uploadedBoard, position: { ...uploadedBoard.position, side: editingSide } }
      }
      if (tempBoardId && options.editingWall !== null) {
        replaceTempBoardInState(tempBoardId, uploadedBoard, options.editingWall, editingSide, ...)
      }
      if (pageBlobUrl) URL.revokeObjectURL(pageBlobUrl)
      successCount++
    } catch (error) {
      console.error(`[Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
      if (pageBlobUrl) URL.revokeObjectURL(pageBlobUrl)
      if (tempBoardId) cleanupTempBoard(tempBoardId, ...)
      // loop continues — one-page failure does NOT abort remaining pages
    }
  }
  return { success: successCount > 0, count: successCount }
}
```

---

### b) Call sites for uploadPDF inside useBoardUpload

Two call sites, both passing only `(file, options)` before this patch:

| Location | Line | Context |
|---|---|---|
| `handleUpload` → `input.onchange` loop | ~670 | `const result = await uploadPDF(file, options)` |
| `uploadFilesDirect` loop | ~744 | `const result = await uploadPDF(file, options)` |

Both updated to `uploadPDF(file, options, upload)` — `upload` is the `useDirectUpload().upload` bound at the top of `useBoardUpload` (introduced in P4b).

---

### c) BoardsPostBody after Part 1 extension

After adding `physicalWidth`/`physicalHeight`, the full interface is:

```ts
interface BoardsPostBody {
  workspaceId?: unknown
  roomId?: unknown
  storagePath?: unknown
  thumbnailPath?: unknown
  contentType?: unknown
  fileSize?: unknown
  physicalWidth?: unknown   // NEW — optional; maps to physical_width column
  physicalHeight?: unknown  // NEW — optional; maps to physical_height column
  position?: {
    x?: unknown; y?: unknown; z?: unknown; rotation?: unknown; scale?: unknown
    wallIndex?: unknown; widthPercent?: unknown; heightPercent?: unknown; side?: unknown
  }
  width?: unknown; height?: unknown
  ownerColor?: unknown
  isPdf?: unknown
  originalFilename?: unknown
  studentName?: unknown
}
```

`physical_width` and `physical_height` already exist on the `boards` table (present since the original schema). The old INSERT hard-coded `null`; after Part 1 the server accepts client-supplied values.

---

### d) Response shape compatibility

`/api/upload` response: `{ success: true, board: Board }`
`/api/boards` response: `{ board: Board, fullUrl, thumbnailUrl }`

`uploadPDF` consumes only `data.board as Board` — the extra `fullUrl`/`thumbnailUrl` fields are ignored. Both endpoints return an identical `Board` object shape (confirmed in P4b §13e). **Compatible.**

---

### e) Coordinate space translation for gridPos

`calculateGridPosition` returns `{ x, y }` in normalized **−0.5 … +0.5** space (same as the position fields in `createTempBoard`). `createBoardFormData` converts these to percentages before sending:

```ts
const apiX = (options.position.x + 0.5) * 100  // −0.5 → 0%, 0 → 50%, +0.5 → 100%
const apiY = (options.position.y + 0.5) * 100
```

The `/api/boards` endpoint stores `positionX`/`positionY` as supplied (percentages). So the new payload must apply the same conversion:

```ts
x: (gridPos.x + 0.5) * 100,
y: (gridPos.y + 0.5) * 100,
```

This is the only non-obvious coordinate translation in the CS-2 cutover.

---

### f) Compatibility verdict

**Full compatibility confirmed.** No blockers. Changes:
- `uploadPDF` gains a third parameter `directUpload`; two call sites updated.
- The `createBoardFormData + fetch('/api/upload')` block replaced with `directUpload(page.imageFile) + fetch('/api/boards', JSON)`.
- `gridPos.x/y` converted from normalized to percentage before send.
- `physicalWidth`/`physicalHeight` forwarded from `page` to the payload (previously forwarded via FormData; now via JSON).
- `/api/boards` BoardsPostBody extended with `physicalWidth?`/`physicalHeight?`; INSERT updated to use them instead of hard-coded `null`.

---

## 15. P4d pre-delete grep

Grep run on 2026-05-22 before deleting `components/WallCanvasEditor.tsx`.

**Command 1 — all text references:**
```
grep -rE "WallCanvasEditor|wall-canvas-editor" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.json" --include="*.md"
```

**Results (all hits):**

| File | Notes |
|---|---|
| `audits/codebase-audit-2026-05-12.md:107` | Text reference in a prior audit doc — not an import |
| `components/WallCanvasEditor.tsx` (5 lines) | The file being deleted — self-references only |
| `docs/storage-audit-P1.md` (many lines) | This audit document — not an import |

**Command 2 — dynamic imports:**
```
grep -rE "import\(.*WallCanvas" --include="*.ts" --include="*.tsx"
```
Result: **zero matches**

**Command 3 — require:**
```
grep -rE "require\(.*WallCanvas" --include="*.ts" --include="*.tsx"
```
Result: **zero matches**

**Verdict:** No live imports anywhere. No co-located test, story, or stylesheet files (`Glob components/WallCanvasEditor*` returns only the single `.tsx`). Safe to delete.

---

## 16. P5 pre-flight checks

Run date: 2026-05-22. No code was modified in this section. `npx tsc --noEmit` clean.

---

### Check 1 — No live calls to /api/upload remain

**Grep:** `/api/upload` in all `*.ts`, `*.tsx`, `*.js`, `*.jsx`.

| File | Line | Content | Classification |
|---|---|---|---|
| `components/3d/FloorEditorOverlay.tsx` | 235 | `fetch('/api/upload-model', ...)` | **Different endpoint** (`/api/upload-model`) — not `/api/upload` |
| `hooks/useBoardUpload.ts` | 19 | `/** Phase 6.1 room id; forwarded to /api/upload so the new board lands... */` | JSDoc comment — stale wording, not live code |
| `hooks/useBoardUpload.ts` | 22 | `* Workspace id for /api/upload's 'workspaceId' form field.` | JSDoc comment — stale |
| `hooks/useBoardUpload.ts` | 103 | `/** Phase 6.1 room id; sent to /api/upload alongside studioId/workspaceId. */` | JSDoc comment — stale |
| `hooks/useBoardUpload.ts` | 105 | `/** Workspace id; required by /api/upload.` | JSDoc comment — stale |
| `app/studio/[id]/page.tsx` | 372 | `// /api/upload first INSERTs a placeholder row...` | `//` comment |
| `app/api/boards/route.ts` | 500, 520, 652, 654 | Various `//` comments referencing old behavior | `//` comments |

**Result: ZERO live non-comment calls to `/api/upload` remain outside the route file itself.** ✅ P6 can proceed.

Note: The stale JSDoc comments in `hooks/useBoardUpload.ts` (lines 19, 22, 103, 105) reference the old `/api/upload` path. These are documentation drift — harmless but should be cleaned up in P6 alongside the route deletion.

---

### Check 2 — useDirectUpload is the only client-side path to board-images uploads

**Grep:** `.upload(` across all `*.ts`, `*.tsx`.

| File | Lines | Bucket | Client or server? | Expected? |
|---|---|---|---|---|
| `lib/useDirectUpload.ts` | 110, 116 | `board-images` (via `BUCKET` constant) | Client (hook) | ✅ Yes — canonical client uploader |
| `app/settings/page.tsx` | 196 | **`avatars`** (confirmed by reading the call) | Client | ✅ Yes — profile avatar upload, unrelated to board-images |
| `app/api/upload/route.ts` | 261, 277 | `board-images` | Server (legacy) | ✅ Yes — scheduled for deletion in P6 |
| `app/api/upload-model/route.ts` | 65 | `board-images` | Server (model upload) | ✅ Yes — separate upload path for 3D models, out of scope |
| `app/api/studios/[id]/wall-config/route.ts` | 26 | `board-images` (via `CONFIG_BUCKET`) | Server (service-role) | ✅ Yes — wall-config JSON write, unrelated to board uploads |
| `app/api/boards/route.ts` | — | — | — | ✅ Correct — does NOT appear; this route is DB-only |

**Result: All hits accounted for. No unexpected client-side board-images uploaders.** ✅

`app/settings/page.tsx` uploads to the `avatars` bucket (verified by reading line 194-196) — not `board-images`. Not a bug.

---

### Check 3 — sharp is only imported in /api/upload

**Grep:** `import .* from 'sharp'` and `require('sharp')` across all `*.ts`, `*.tsx`.

| File | Line | Content |
|---|---|---|
| `app/api/upload/route.ts` | 4 | `import sharp from 'sharp'` |

**Result: Only one hit — the legacy route scheduled for deletion in P6.** ✅ No other file imports `sharp`. P6 cleanup scope is exactly `app/api/upload/route.ts`.

---

### Check 4 — No stale calls to createBoardFormData

**Grep (definition):** `createBoardFormData` → hit at `hooks/useBoardUpload.ts:99` (the function definition).

**Grep (call sites):** `createBoardFormData(` → **zero matches**.

`createBoardFormData` (lines 98-163 of `hooks/useBoardUpload.ts`) is defined but never called. Both `uploadFile` (P4b) and `uploadPDF` (P4c) have been migrated away from it. It is **dead code**.

**Result: ⚠️ Dead helper present.** The function definition should be deleted in P6 to avoid confusion. It is safe to leave until then — it has no callers and TypeScript does not flag unused module-level `const` declarations as errors (only variables/imports trigger `noUnusedLocals`).

---

### Check 5 — Migration audit (008 onwards)

**Full migration listing:**

| File | Added by | Status |
|---|---|---|
| `008_add_organization_id_columns.sql` | Pre-P2 | Applied (pre-existing) |
| `009_drop_institution_id_columns.sql` | Pre-P2 | Applied (pre-existing) |
| `010_add_workspace_archive.sql` | Pre-P2 | Applied (pre-existing) |
| `011_add_board_upload_status.sql` | Pre-P2 | Applied (pre-existing) |
| `012_add_board_rotation.sql` | Pre-P2 | Applied (pre-existing) |
| `013_add_org_request_type.sql` | Pre-P2 | Applied (pre-existing) |
| `014_add_rooms_table.sql` | Pre-P2 | Applied (pre-existing) |
| `015_add_workspaces_active_room_id.sql` | Pre-P2 | Applied (pre-existing) |
| `016_drop_active_room_and_global_network.sql` | Pre-P2 | Applied (pre-existing) |
| `017_seed_org_domains.sql` | Pre-P2 | Applied (pre-existing) |
| `018_create_room_share_tokens.sql` | Pre-P2 | Applied (pre-existing) |
| `008_tighten_board_images_insert_rls.sql` | **P2b** | ⚠️ **Requires confirmation** (see below) |
| `019_add_shared_workspace_type.sql` | Outside P2-P4 scope | ⚠️ Untracked (not yet committed) |
| `020_notification_preferences.sql` | Outside P2-P4 scope | ⚠️ Untracked (not yet committed) |

**Naming collision:** Two files share the `008_` prefix — `008_add_organization_id_columns.sql` (pre-existing) and `008_tighten_board_images_insert_rls.sql` (P2b). The Supabase CLI uses file timestamps rather than numeric prefixes for ordering, so they don't conflict at the schema level, but the duplicate prefix is confusing. Noted.

**`008_tighten_board_images_insert_rls.sql` (P2b):**

Content:
```sql
DROP POLICY IF EXISTS "Authenticated users can upload board images" ON storage.objects;
CREATE POLICY "Users can upload to own folder in board-images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'board-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);
```

This is the **critical security migration** for the Phase 4 client-direct upload path. `useDirectUpload` writes to `{userId}/...` paths, which satisfies this policy. If this migration has NOT been applied, all client-direct uploads will be rejected by RLS with a 403.

**Status: Requires human confirmation.** Cannot be verified from code alone — must be checked in Supabase SQL Editor or Dashboard → Authentication → Policies.

Verification query (run in SQL Editor):
```sql
SELECT policyname, cmd, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname = 'Users can upload to own folder in board-images';
```

Expected: one row returned. If zero rows returned, apply `008_tighten_board_images_insert_rls.sql` before any user testing of P4b/P4c/P4d.

**`019_add_shared_workspace_type.sql` and `020_notification_preferences.sql`:**

Both are untracked files (outside P2-P4 scope). Neither affects the storage upload path. Not a blocker for P6.

---

## 18. PDF gray-flash diagnosis

_Date: 2026-05-23. Diagnosis only — no code modified. `npx tsc --noEmit` exit 0._

P4c.2 ported the CDN texture pre-warm block from `uploadFile` into `uploadPDF`. Smoke testing shows `uploadPDF` still exhibits a ~2 s gray-skeleton flash per page while `uploadFile` shows none. This section traces why.

---

### 1. `uploadFile` — `thumbnailUrl`/`fullImageUrl` in `createTempBoard`

`hooks/useBoardUpload.ts:349-366` — `createTempBoard` is called with:

```typescript
createTempBoard(tempBoardId, {
  ...
  blobUrl: createdBlobUrl,  // ← URL.createObjectURL(file)
  ...
})
```

`createTempBoard` sets (`hooks/useBoardUpload.ts:197-198`):

```typescript
thumbnailUrl: options.blobUrl,  // ← blob URL
fullImageUrl: options.blobUrl,  // ← blob URL
```

So the temp board's image URLs are the local blob URL (`blob:http://…`).

---

### 2. `uploadPDF` — `thumbnailUrl`/`fullImageUrl` in `createTempBoard`

`hooks/useBoardUpload.ts:531-550` — `createTempBoard` is called with:

```typescript
createTempBoard(tempBoardId, {
  ...
  blobUrl,  // ← URL.createObjectURL(page.imageFile)
  ...
})
```

Identical assignment — `thumbnailUrl = blobUrl`, `fullImageUrl = blobUrl`. Both point to the local blob URL for the JPEG-rendered PDF page. The URLs are structurally identical to `uploadFile`'s temp board.

---

### 3. `createTempBoard` function body

`hooks/useBoardUpload.ts:169-208` — full relevant body:

```typescript
const createTempBoard = (tempId, options): Board => {
  return {
    id: tempId,
    localId: tempId,
    studioId: options.studioId,
    title: options.title,
    studentName: options.user?.fullName || options.user?.firstName || '',
    ownerId: options.user?.id,
    ownerName: options.user?.fullName || options.user?.firstName || 'Anonymous',
    thumbnailUrl: options.blobUrl,   // ← always the blob URL passed in
    fullImageUrl: options.blobUrl,   // ← same
    uploadedAt: new Date(),
    tags: options.tags,
    originalWidth: options.width,
    originalHeight: options.height,
    aspectRatio: options.aspectRatio,
    physicalWidth: options.physicalWidth,
    physicalHeight: options.physicalHeight,
    position: options.position,
  }
}
```

**Both paths are identical here.** The divergence is not inside `createTempBoard`.

---

### 4. `DraggableBoard` — rendering path for PDF vs image temp boards

`components/3d/DraggableBoard.tsx:866-937`:

```typescript
const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
const isPDF = imageUrl.toLowerCase().endsWith('.pdf')

// ...
{isPDF ? (
  <Suspense fallback={<meshStandardMaterial color="#f3f4f6" />}>
    <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
  </Suspense>
) : hasImage ? (
  <BoardTextureMaterial imageUrl={imageUrl} />   // ← both temp boards land here
) : (
  <meshStandardMaterial ... />
)}
```

For the **temp board** in both cases, `imageUrl = blob:http://…` — a blob URL never ends in `.pdf`, so `isPDF = false`. Both the image temp board and the PDF page temp board render via `BoardTextureMaterial → useBoardTexture(blobUrl)`. The rendering path is **identical**.

`PDFTextureMaterial` is never involved for temp boards.

---

### 5. Is the blob URL correctly threaded into the display path?

Yes. `page.imageFile` is a JPEG `File` object (`new File([blob], '…page1.jpg', { type: 'image/jpeg' })`). `URL.createObjectURL(page.imageFile)` produces a valid `blob:` URL. The `THREE.TextureLoader` used by `loadTexture` / `useBoardTexture` can load blob URLs via XHR exactly like it loads regular image URLs — same codepath as `uploadFile`'s `URL.createObjectURL(file)`.

---

### Root cause

**`uploadPDF` never pre-warms the blob URL texture before calling `addTempBoardToState`. `uploadFile` does.**

`uploadFile` (`hooks/useBoardUpload.ts:329-347`):

```typescript
// Created up-front, BEFORE measuring dimensions:
const earlyBlobUrl = URL.createObjectURL(file)

// Pre-warm starts immediately (concurrent with getImageDimensions):
const texturePrewarm = loadTexture(earlyBlobUrl).catch(() => undefined)

const dims = await getImageDimensions(file)
// ...

// ← AWAITED before addTempBoardToState:
await texturePrewarm

// By here, resolvedCache.has(earlyBlobUrl) === true.
// DraggableBoard's first render: useState(resolvedCache.get(blobUrl)) → texture ≠ null → no skeleton.
flushSync(() => {
  addTempBoardToState(tempBoard, ...)
})
```

`uploadPDF` (`hooks/useBoardUpload.ts:527-557`):

```typescript
pageBlobUrl = URL.createObjectURL(page.imageFile)
const blobUrl = pageBlobUrl

// ← NO loadTexture(blobUrl) call here.

const tempBoard = createTempBoard(tempBoardId, { blobUrl, ... })

// addTempBoardToState called immediately — resolvedCache has no entry for blobUrl yet.
addTempBoardToState(tempBoard, ...)
```

**The consequence, step by step:**

1. `addTempBoardToState` commits the temp board to React state with an un-warmed blob URL.
2. `DraggableBoard` renders → `BoardTextureMaterial` → `useBoardTexture(blobUrl)`.
3. `useBoardTexture` initialises: `useState(resolvedCache.get(blobUrl) ?? null)` → `null` (cache miss).
4. `isInitialLoad = true` → skeleton rendered (0.22-opacity white material, `components/3d/DraggableBoard.tsx:112-120`).
5. `useEffect([blobUrl])` fires → `loadTexture(blobUrl)` starts: `THREE.TextureLoader` fetches the blob via XHR, decodes the JPEG, uploads the WebGL texture. For a large PDF page (e.g., 1 500 × 2 000 px JPEG at 1.5× scale), this takes **~1–2 seconds** even though the data is local — the WebGL texture upload is the bottleneck.
6. After ~1–2 s the blob texture resolves → `setTexture(tex)` → image appears.
7. Upload + API call + CDN pre-warm (P4c.2) complete → `replaceTempBoardInState` swaps to real board.
8. `useBoardTexture` URL prop changes blob → CDN URL → effect hits cache → instant.

Steps 4–6 produce the **~2 s gray-skeleton flash**. P4c.2 eliminated a SECOND flash at step 8, but step 4 was never addressed.

**Exact divergence line:** `hooks/useBoardUpload.ts:552` — `addTempBoardToState(...)` is called without any prior `await loadTexture(pageBlobUrl)`. The fix is to insert `await loadTexture(pageBlobUrl).catch(() => undefined)` between line 529 (`URL.createObjectURL`) and line 552 (`addTempBoardToState`), mirroring `uploadFile`'s lines 332-347.

---

## 19. P6 cleanup

_Date: 2026-05-23. Upload migration finalized. `npx tsc --noEmit` exit 0._

---

### Deletions

**`app/api/upload/route.ts` — deleted**  
The legacy multipart-upload route. Handled server-side `sharp` compression and Supabase storage proxying. All client upload paths migrated to `useDirectUpload + /api/boards POST` in P4b/P4c (confirmed in §16). Zero callers remained.

**`sharp` npm dependency — uninstalled**  
`npm uninstall sharp` removed `sharp` and its 3 transitive packages (`@img/sharp-libvips-win32-x64`, `@img/sharp-win32-x64`, `color`). Was the sole consumer inside the now-deleted `/api/upload/route.ts`. `package.json` and `package-lock.json` updated.

**`createBoardFormData` function in `hooks/useBoardUpload.ts` — deleted**  
Dead helper (~70 lines, former lines 96-164) that assembled `multipart/form-data` for `/api/upload`. Zero call sites remained after P4b/P4c switched to JSON payloads for `/api/boards POST`.

---

### Discovery grep results

**sharp imports** (`grep -rE "from ['\"]sharp['\"]|require\(['\"]sharp['\"]\)" --include="*.ts" --include="*.tsx" --include="*.js"`):
```
(no output — zero hits)
```

**`createBoardFormData` call sites** (`grep -rE "createBoardFormData" --include="*.ts" --include="*.tsx"`):
```
(no output — zero hits outside definition)
```

Both greps confirmed safe before any deletion.

---

### Migration complete

The upload architecture after P6:

| Concern | Before (P1 baseline) | After (P6) |
|---|---|---|
| File bytes path | Browser → Vercel `/api/upload` → Supabase Storage | Browser → Supabase Storage direct (`useDirectUpload`) |
| Image compression | Server-side `sharp` (2400 px / q85 full, 800 px / q75 thumb) | Client-side `browser-image-compression` (same size targets) |
| DB record creation | `INSERT` inside `/api/upload` handler | `POST /api/boards` (metadata only, no file bytes) |
| Vercel payload cap | 4.5 MB hard limit (blocked large images) | Bypassed — storage upload never touches Vercel |
| Auth gate for storage | Supabase RLS `"Users can upload to own folder in board-images"` | Same RLS policy (unchanged) |
| Wall-config writes | `/api/studios/[id]/wall-config` via service role + workspace-member check | Unchanged |
| 3D model uploads | `/api/upload-model` (separate route, still active) | Unchanged — not in scope for P6 |

The `/api/upload` route, `sharp` dependency, and `createBoardFormData` helper are permanently removed. No migrations required.

---

## 20. Progress toast plan

### Problem
Multi-page PDF uploads currently show no UI feedback between file pick and first page appearing on the wall. The pipeline does `convertPDFToImages` (PDF.js render of every page to canvas → JPEG) before the first network call, which for a 10+ page PDF can take several seconds with zero visible signal. Users assume the upload failed and click upload again, queueing a duplicate run.

### Toast helper surface (`lib/toast.ts`)

```typescript
export type ToastType = 'success' | 'error' | 'info' | 'warning'

export const toast = {
  success: (message: string, duration = 3000) => emit(message, 'success', duration),
  error: (message: string, duration = 4500) => emit(message, 'error', duration),
  info: (message: string, duration = 3000) => emit(message, 'info', duration),
  warning: (message: string, duration = 3500) => emit(message, 'warning', duration),
}

function emit(message: string, type: ToastType, duration: number) {
  const id = Math.random().toString(36).slice(2, 9)
  const item: ToastItem = { id, message, type, duration }
  listeners.forEach((l) => l(item))
}
```

The id is generated **inside** `emit` from `Math.random()` — callers cannot pass one in, and there is no `dismiss(id)` or `update(id, …)` exported. The helper is strictly fire-and-forget. No `loading` variant either.

### Pattern chosen: fire-and-forget pair

Adding an update-by-id API to `lib/toast.ts` would touch a shared helper and the `ToastViewport` consumer for a single-call feature. Not worth the blast radius. Falling back to the simpler pair pattern the brief explicitly accepts:

1. **Start toast** (multi-page only, `pages.length > 1`): one `toast.info(…)` immediately after `convertPDFToImages` resolves with `"Uploading \"<name>\" — <N> pages"`. Bumped duration to ~8000 ms so it stays visible across the upload of a typical small deck. Dropped the literal `0 of N pages` wording from the brief since without updates it would look like a stuck progress meter.
2. **No mid-loop updates** — fire-and-forget can't reach the existing toast.
3. **End toast**: after the loop, before `return`. `toast.success` if all pages uploaded, `toast.warning` if some failed (uses existing `successCount < pages.length` signal). Per-page error toasts from P4c.1 stay as-is — they fire alongside the warning summary, which is the desired behavior (user gets a per-page reason AND a roll-up).
4. **Single-page PDFs** (`pages.length === 1`): no progress toast. The temp-board → swap UX already covers them; a toast would be noise.

### Scope
Only `uploadPDF` in `hooks/useBoardUpload.ts` changes. `uploadFile` (images), `lib/useDirectUpload.ts`, `app/api/boards/route.ts`, and `lib/toast.ts` itself are untouched.
