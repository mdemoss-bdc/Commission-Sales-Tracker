import { parseTrackerState } from "./storage.ts";
import { getSupabase, isSupabaseConfigured } from "./supabase.ts";
import { PAY_TRACKER_STATE_ID, PAY_TRACKER_STATE_TABLE } from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

export type CloudLoad =
  | { status: "ready"; state: TrackerState | null }
  | { status: "setup" }
  | { status: "offline" }
  | { status: "unconfigured" };

function isMissingTable(message: string, code?: string): boolean {
  return (
    code === "PGRST205" ||
    message.includes("Could not find the table") ||
    message.includes("schema cache")
  );
}

export async function loadStateFromCloud(): Promise<CloudLoad> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const supabase = getSupabase();
  if (!supabase) return { status: "unconfigured" };
  const { data, error } = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .select("state")
    .eq("id", PAY_TRACKER_STATE_ID)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message, error.code)) return { status: "setup" };
    return { status: "offline" };
  }
  if (!data) return { status: "ready", state: null };
  return { status: "ready", state: parseTrackerState(data.state) };
}

export async function saveStateToCloud(state: TrackerState): Promise<CloudLoad["status"] | "synced"> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const supabase = getSupabase();
  if (!supabase) return "unconfigured";
  const { error } = await supabase.from(PAY_TRACKER_STATE_TABLE).upsert({
    id: PAY_TRACKER_STATE_ID,
    state,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    if (isMissingTable(error.message, error.code)) return "setup";
    return "offline";
  }
  return "synced";
}
