> **STALE:** This doc is from before Phase 4 and may be inaccurate. See CONTEXT.md for current state.
>
> The SQL file list below describes the original schema bootstrap; those files now live in `migrations/archive/`, and additional schema changes are tracked in `migrations/001_*.sql` … `010_*.sql`. For the up-to-date deployment workflow, use `docs/VERCEL_DEPLOYMENT.md`.

# 🚀 Deployment Checklist for PinSpace v2

## ✅ What's Ready

- ✅ **Backend fully migrated to Supabase** (workspaces, boards, comments, members)
- ✅ **Authentication** (Supabase Auth)
- ✅ **RLS Policies** (security in place)
- ✅ **All core features** working with database
- ✅ **API routes** migrated from JSON to Supabase

## ✅ Image Storage - MIGRATED TO SUPABASE STORAGE

**Status:** ✅ **COMPLETE**

The upload system has been migrated to Supabase Storage:
- ✅ Upload API updated to use Supabase Storage
- ✅ Storage bucket setup SQL provided (`setup_supabase_storage.sql`)
- ✅ RLS policies configured
- ✅ File validation added (10MB limit, type checking)
- ✅ Production-ready CDN URLs

**Action Required:**
1. Run `setup_supabase_storage.sql` in Supabase SQL Editor
2. Test upload functionality
3. See `STORAGE_MIGRATION_GUIDE.md` for details

## 📋 Pre-Deployment Steps

### 1. Environment Variables
Set these in your production environment (Vercel, Netlify, etc.):

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### 2. Supabase Dashboard Configuration

**Authentication → URL Configuration:**
- **Site URL:** `https://your-domain.com`
- **Redirect URLs:** 
  - `https://your-domain.com/**`
  - `https://your-domain.com/auth/callback`

### 3. Database Migrations
Run all SQL files in Supabase SQL Editor (in order). The original
schema-bootstrap files now live in `migrations/archive/`:
1. `migrations/archive/add_workspace_publish_columns.sql` (if not already run)
2. `migrations/archive/create_boards_table.sql` (or `migrations/archive/FIXED_create_boards_table.sql`)
3. `migrations/archive/create_comments_table.sql`
4. `migrations/archive/setup_rls_policies.sql`
5. `migrations/archive/FIX_workspaces_rls_no_recursion.sql`
6. `migrations/archive/FIX_boards_rls_for_public.sql`
7. `migrations/archive/FIX_comments_rls_for_public.sql`

Then run the post-Phase-4 migrations in numeric order from `migrations/`:
`001_rename_institutions_to_organizations.sql` through
`010_add_workspace_archive.sql`.

### 4. Test Production Build
```bash
npm run build
npm run start
```
Make sure there are no build errors.

## 🔧 Required Before Production

### High Priority:
1. ✅ **Migrate image storage to cloud** - DONE (Supabase Storage)
2. ✅ **Add file size limits** - DONE (10MB limit)
3. ✅ **Add image validation** - DONE (file type checking)
4. **Update redirect URLs** in Supabase Auth settings (see step 2 below)

### Medium Priority:
5. **Add error boundaries** (better error handling)
6. **Add loading states** (improve UX)
7. **Add rate limiting** (prevent abuse)
8. **Set up monitoring** (error tracking)

### Low Priority:
9. **Migrate wall config** to database (optional)
10. **Add analytics** (optional)

## ✅ Image Storage Migration - COMPLETE

The image storage has been migrated to Supabase Storage:
- ✅ Upload API updated
- ✅ Storage bucket setup SQL provided
- ✅ RLS policies configured
- ✅ File validation added

**Next Step:** Run `setup_supabase_storage.sql` in Supabase SQL Editor (see `STORAGE_MIGRATION_GUIDE.md`)

## 📝 Deployment Platforms

### Vercel (Recommended for Next.js)
- Easy deployment
- Automatic HTTPS
- Environment variables in dashboard
- **Note:** Need cloud storage for images

### Netlify
- Similar to Vercel
- Also need cloud storage

### Self-hosted
- More control
- Need to manage server, database, storage yourself

---

**Bottom Line:** The app is **almost ready**, but you **MUST** migrate image storage to cloud before deploying to production. Everything else is ready to go!

