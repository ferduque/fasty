# Supabase setup for Fasty

One-time steps to provision your Supabase project so the app can sign users in
and store their libraries.

## 1. Create the project

1. Sign in at <https://supabase.com>.
2. Click **New project**.
3. Name it `fasty`. Pick a region close to you. Set a strong DB password (write
   it down — you won't see it again, though you rarely need it).
4. Wait ~2 minutes for provisioning.

## 2. Run the migrations

In the dashboard, open **SQL Editor**.

1. Open `supabase/migrations/0001_init.sql` from this repo, paste it into the
   SQL Editor, click **Run**. You should see `Success`.
2. Repeat with `supabase/migrations/0002_quotas.sql`.

## 3. Create the covers storage bucket

In the dashboard:

1. Go to **Storage**.
2. Click **Create bucket**.
3. Name it `covers`.
4. **Public bucket:** OFF.
5. **File size limit:** 200 KB.
6. **Allowed MIME types:** `image/jpeg, image/png`.
7. Click **Create**.

Then open **SQL Editor** again, paste `supabase/storage-policies.sql`,
**Run**.

## 4. Configure auth

In the dashboard:

1. **Authentication → Providers → Email**: enable. Toggle **Confirm email** ON.
2. (Optional) **Authentication → Providers → Google**: follow the in-app
   instructions to create an OAuth client in Google Cloud Console and paste the
   client ID/secret.
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:8080` (add your production URL later, e.g. a
     Railway/Vercel deployment).

## 5. Copy keys into the app

In the dashboard, open **Settings → API**. Copy two values:

- **Project URL**
- **anon public** key

Then, in the repo:

```bash
cp src/config.example.js src/config.js
```

Edit `src/config.js` and paste the two values into `SUPABASE_URL` and
`SUPABASE_ANON_KEY`. (`src/config.js` is gitignored, so your keys never get
committed.)

The anon key is meant to be public — Row-Level Security in the DB is what
protects users' data. **Never** put the `service_role` key in client code.

## 6. Reload the app

The sidebar will now show a **Sign in** button. Sign up with your email,
confirm via the link, sign in. Your existing local library will migrate up to
the cloud on first sign-in.
