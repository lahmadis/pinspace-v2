# 📦 GitHub Setup for Vercel Deployment

## Step 1: Create GitHub Repository

1. **Go to GitHub:**
   - Visit [github.com](https://github.com)
   - Sign in to your account

2. **Create New Repository:**
   - Click the "+" icon (top right) → "New repository"
   - **Repository name:** `pinspace-v2`
   - **Description:** (optional) "Interactive Architecture Studio Network"
   - **Visibility:** Public or Private (your choice)
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
   - Click "Create repository"

3. **Copy the repository URL:**
   - You'll see a page with setup instructions
   - Copy the HTTPS URL (looks like: `https://github.com/your-username/pinspace-v2.git`)

## Step 2: Initialize Git and Push (if not already done)

Run these commands in your project directory:

```powershell
# Make sure you're in the project directory
cd "C:\Users\slahm\OneDrive - Wentworth Institute of Technology\Desktop\pinspace-v2"

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Ready for Vercel deployment"

# Add remote (replace YOUR-USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR-USERNAME/pinspace-v2.git

# Push to GitHub
git push -u origin main
```

**Note:** If you get an error about "main" branch, try `master` instead:
```powershell
git push -u origin master
```

## Step 3: Verify

- Go to your GitHub repository page
- You should see all your project files
- Ready for Vercel deployment!

---

**After pushing to GitHub, proceed to Vercel deployment (see `VERCEL_DEPLOYMENT.md`)**

