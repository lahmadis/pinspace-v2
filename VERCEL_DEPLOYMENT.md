# 🚀 Deploy to Vercel - Step by Step

## Prerequisites
- ✅ Code pushed to GitHub (or GitLab/Bitbucket)
- ✅ Supabase Storage set up and working
- ✅ All SQL migrations run in Supabase

## Step 1: Push Code to GitHub

If you haven't already:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Ready for production deployment"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/your-username/pinspace-v2.git
git push -u origin main
```

## Step 2: Deploy to Vercel

### Option A: Via Vercel Dashboard (Recommended)

1. **Go to Vercel:**
   - Visit [vercel.com](https://vercel.com)
   - Sign up / Sign in (use GitHub to connect)

2. **Import Project:**
   - Click "Add New..." → "Project"
   - Import your GitHub repository
   - Select `pinspace-v2`

3. **Configure Project:**
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `./` (default)
   - **Build Command:** `npm run build` (auto-filled)
   - **Output Directory:** `.next` (auto-filled)
   - **Install Command:** `npm install` (auto-filled)

4. **Add Environment Variables:**
   Click "Environment Variables" and add:

   ```
   NEXT_PUBLIC_SUPABASE_URL
   ```
   Value: Your Supabase project URL (from Supabase Dashboard → Settings → API)

   ```
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```
   Value: Your Supabase anon key (from Supabase Dashboard → Settings → API)

   ```
   SUPABASE_SERVICE_ROLE_KEY
   ```
   Value: Your Supabase service role key (from Supabase Dashboard → Settings → API)
   ⚠️ **Important:** Keep this secret! It's only used server-side.

5. **Deploy:**
   - Click "Deploy"
   - Wait for build to complete (2-3 minutes)
   - You'll get a URL like: `pinspace-v2.vercel.app`

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Follow prompts:
# - Set up and deploy? Yes
# - Which scope? (select your account)
# - Link to existing project? No
# - Project name? pinspace-v2
# - Directory? ./
# - Override settings? No

# Add environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY

# Deploy to production
vercel --prod
```

## Step 3: Update Supabase Auth Settings

**Critical:** Update Supabase to allow your Vercel domain.

1. **Go to Supabase Dashboard:**
   - Authentication → URL Configuration

2. **Update Site URL:**
   - Change from `http://localhost:3000`
   - To: `https://your-project.vercel.app` (or your custom domain)

3. **Add Redirect URLs:**
   Add these URLs (one per line):
   ```
   https://your-project.vercel.app/**
   https://your-project.vercel.app/auth/callback
   ```
   
   If you have a custom domain:
   ```
   https://yourdomain.com/**
   https://yourdomain.com/auth/callback
   ```

4. **Save Changes**

## Step 4: Test Your Deployment

1. **Visit your Vercel URL:**
   - Go to `https://your-project.vercel.app`
   - Test sign up / sign in
   - Test uploading a board
   - Verify images appear in 3D studio

2. **Check for Errors:**
   - Open browser console (F12)
   - Check for any errors
   - Check Vercel deployment logs if issues occur

## Step 5: Custom Domain (Optional)

1. **In Vercel Dashboard:**
   - Go to your project → Settings → Domains
   - Add your domain
   - Follow DNS configuration instructions

2. **Update Supabase:**
   - Add your custom domain to Supabase Auth redirect URLs

## Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Verify all environment variables are set
- Make sure `npm run build` works locally first

### Images Not Loading
- Verify Supabase Storage bucket is public
- Check image URLs in database (should be Supabase Storage URLs)
- Check browser console for CORS errors

### Authentication Not Working
- Verify Site URL and Redirect URLs in Supabase
- Check environment variables are correct
- Clear browser cache

### 500 Errors
- Check Vercel function logs
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Check Supabase dashboard for errors

## Post-Deployment

### Monitor
- Check Vercel Analytics (if enabled)
- Monitor Supabase usage (storage, database)
- Watch for errors in Vercel logs

### Updates
- Push to GitHub → Vercel auto-deploys
- Environment variables persist across deployments
- Database migrations need to be run manually in Supabase

---

**You're live! 🎉**

Your app is now accessible to anyone at your Vercel URL!

