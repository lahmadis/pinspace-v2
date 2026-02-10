# Pinspace institution onboarding

How to give Pinspace to Wentworth (WIT) or another school.

## What was implemented

1. **Institution handoff links** – Each school gets a short URL that goes to Explore filtered for that institution.
2. **Create institution (admin)** – Admins can add new schools from the app.
3. **Workspace ↔ institution** – When creating a workspace, the professor picks the institution so workspaces are scoped to the right school.
4. **Admin institutions page** – List institutions and add new ones.

---

## Giving Pinspace to Wentworth (WIT)

1. **Deploy** the app (e.g. Vercel) and ensure the `institutions` table has WIT (run `add_institutions_and_workspace_institution_id.sql` if needed).
2. **Give WIT these links:**
   - Main app: `https://your-domain.com`
   - WIT-only explore: `https://your-domain.com/i/wit` (or `/explore?institution=wit`)
3. **Tell faculty:** Sign in → **Create a Class** (workspace) → choose **Institution: Wentworth Institute of Technology** → share the **invite link** with students. Students use **Join a Class** with the code or link.

---

## Adding another school

1. **Set admin emails** in your deployment (e.g. Vercel env):
   ```bash
   PINSPACE_ADMIN_EMAILS=your@email.com,other@wit.edu
   ```
2. **Sign in** as one of those users and go to **Dashboard** → **Institutions** (or `/admin/institutions`).
3. **Add institution:** Name (e.g. "MIT"), Slug (e.g. `mit`), optional Network label. Save.
4. **Give that school:** Share `https://your-domain.com/i/mit` (or whatever slug you used).
5. **Faculty at that school:** Sign in, Create a Class, select the new institution, share invite links as usual.

---

## Handoff URLs

| URL | Behavior |
|-----|----------|
| `/i/wit` | Redirects to Explore filtered to WIT |
| `/i/mit` | Redirects to Explore filtered to MIT (after you add that institution) |
| `/explore?institution=wit` | Same as `/i/wit` |

---

## Summary

- **WIT (or any school)** uses **workspace invite links** for onboarding students and faculty.
- **You** use **Institutions (admin)** to add schools and give each one a handoff link (`/i/[slug]`).
- **Professors** choose the institution when creating a workspace so it appears under the right school in Explore.
