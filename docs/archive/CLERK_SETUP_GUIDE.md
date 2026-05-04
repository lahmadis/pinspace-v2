# Clerk Authentication Setup Guide

## 🚀 Quick Setup

### **Step 1: Get Clerk Keys**

1. Go to [https://dashboard.clerk.com](https://dashboard.clerk.com)
2. Sign up (free tier is fine)
3. Create a new application
4. Choose "Email + Password" as authentication method
5. Copy your API keys

### **Step 2: Add Environment Variables**

Create `.env.local` in your project root:

```env
# Clerk Authentication Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
CLERK_SECRET_KEY=sk_test_your_secret_key_here

# Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

### **Step 3: Restart Dev Server**

```bash
# Stop current server (Ctrl+C)
npm run dev
```

---

## ✅ Verification

After setup, you should be able to:
- Access `/sign-in` and see Clerk's login UI
- Access `/sign-up` and create an account
- Protected routes redirect to sign-in if not authenticated

---

## 🔧 What I'm Building Now

While you set up Clerk keys, I'm adding:
1. ClerkProvider wrapper
2. Middleware for protected routes
3. Sign-in/sign-up pages
4. Dashboard page
5. User data integration

I'll continue building - just add your keys when ready!

