/**
 * Public Supabase configuration. These values are safe to ship in the browser:
 *  - SUPABASE_URL is public.
 *  - SUPABASE_ANON_KEY is the public "front door" key; data access is protected
 *    by Row Level Security policies in Postgres, not by hiding this key.
 *
 * The Supabase service-role key (and Stripe secret keys) live only in Supabase
 * Edge Function secrets — never in this file.
 */
export const SUPABASE_URL = 'https://hdzykardmczasemtmbsm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkenlrYXJkbWN6YXNlbXRtYnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODE0MTksImV4cCI6MjA5NTQ1NzQxOX0.GC5t597GEZg8-oKTMXGAGnuMVFLT6__n7TjNw1BN_z4';
