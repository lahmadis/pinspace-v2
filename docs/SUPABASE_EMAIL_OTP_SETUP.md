# Supabase Email OTP Setup

PinSpace uses a 6-digit verification code to confirm that users have access to their email address. This prevents fake sign-ups (e.g. `hi@wit.edu` without inbox access).

## Enable the 6-digit code in Supabase

1. Go to **Supabase Dashboard** → **Authentication** → **Email Templates**
2. Edit the **Magic Link** template (used by `signInWithOtp`)
3. Make sure the template includes the token so users see the code:

```html
<h2>Your PinSpace verification code</h2>
<p>Enter this verification code in PinSpace:</p>
<p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
<p>This code expires in 1 hour.</p>
```

Note: Supabase may send a 6- or 8-digit code depending on your project. PinSpace accepts both.

4. Save the template.

## Optional: Custom SMTP

For reliable delivery (especially to school domains), configure custom SMTP in **Project Settings** → **Authentication** → **SMTP Settings** using a provider like Resend, SendGrid, or Mailgun.

## Add role column (if you have existing user_profiles)

Run `migrations/archive/add_role_to_user_profiles.sql` in the Supabase SQL editor to add the `role` (student/faculty) column.
