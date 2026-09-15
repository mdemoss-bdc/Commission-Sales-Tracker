import { captureAuthCallbackFromWindow } from "./auth-callback.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://orcmzzgyljmtxaovyluy.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yY216emd5bGptdHhhb3Z5bHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MDM5MTksImV4cCI6MjEwNDk3OTkxOX0.3IvCWCyorbXffu92_cEWnqy8fQZq5r4ZKeRUmhdVTp4";

function makeClient(): SupabaseClient {
  const inBrowser = typeof window !== "undefined";
  if (inBrowser) captureAuthCallbackFromWindow();
  return createClient(supabaseUrl, supabaseAnonKey.trim(), {
    auth: {
      persistSession: inBrowser,
      autoRefreshToken: inBrowser,
      detectSessionInUrl: inBrowser,
      storage: inBrowser ? window.localStorage : undefined,
    },
  });
}

export const supabase = makeClient();

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!supabaseUrl || !supabaseAnonKey.trim()) {
    client = null;
    return client;
  }
  client = supabase;
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey.trim());
}
