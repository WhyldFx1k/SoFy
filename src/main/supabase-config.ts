/**
 * Public Supabase client settings. The anon key is safe to ship: every table
 * is protected by RLS and all writes go through SECURITY DEFINER functions.
 * Empty values keep local accounts.
 */
const PROJECT_URL = "https://kdszamabdlsawfppagvv.supabase.co"
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkc3phbWFiZGxzYXdmcHBhZ3Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MDQxMDMsImV4cCI6MjEwOTE4MDEwM30.KI7biD3p8ALY9-FrZ-6X7UdBgdYk3LemecoXoVuMXA0"

export const SUPABASE_URL = process.env.SOFY_SUPABASE_URL ?? PROJECT_URL
export const SUPABASE_ANON_KEY = process.env.SOFY_SUPABASE_ANON_KEY ?? ANON_KEY
