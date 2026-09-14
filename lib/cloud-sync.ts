import { parseTrackerState } from "./storage.ts";
import { getSupabase, isSupabaseConfigured } from "./supabase.ts";
import { PAY_TRACKER_STATE_TABLE } from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

export type CloudLoad =
  | { status: "ready"; state: TrackerState | null; userId: string }
  | { status: "setup" }
  | { status: "offline" }
  | { status: "blocked" }
  | { status: "unconfigured" }
  | { status: "signed-out" };

function isMissingTable(message: string, code?: string): boolean {
  return (
    code === "PGRST205" ||
    message.includes("Could not find the table") ||
    message.includes("schema cache")
  );
}

function isPermissionError(message: string, code?: string): boolean {
  const text = message.toLowerCase();
  return (
    code === "42501" ||
    code === "PGRST301" ||
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("jwt")
  );
}

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function loadStateFromCloud(): Promise<CloudLoad> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const supabase = getSupabase();
  if (!supabase) return { status: "unconfigured" };
  const userId = await currentUserId();
  if (!userId) return { status: "signed-out" };
  const { data, error } = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .select("state")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message, error.code)) return { status: "setup" };
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    return { status: "offline" };
  }
  if (!data) return { status: "ready", state: null, userId };
  return { status: "ready", state: parseTrackerState(data.state), userId };
}

export async function saveStateToCloud(state: TrackerState): Promise<CloudLoad["status"] | "synced"> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const supabase = getSupabase();
  if (!supabase) return "unconfigured";
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  const { error } = await supabase.from(PAY_TRACKER_STATE_TABLE).upsert({
    id: userId,
    state,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    if (isMissingTable(error.message, error.code)) return "setup";
    if (isPermissionError(error.message, error.code)) return "blocked";
    return "offline";
  }
  return "synced";
}
