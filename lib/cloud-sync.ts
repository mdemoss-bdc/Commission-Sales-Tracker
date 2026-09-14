import { assembleTrackerState, flattenTrackerState } from "./deal-records.ts";
import { loadDealRows, syncDealPayloads } from "./org.ts";
import { getCachedProfile } from "./org.ts";
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

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function loadLegacyState(userId: string): Promise<TrackerState | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .select("state")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return parseTrackerState(data.state);
}

export async function loadStateFromCloud(): Promise<CloudLoad> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const userId = await currentUserId();
  if (!userId) return { status: "signed-out" };
  const deals = await loadDealRows();
  if (deals.status !== "ready") return { status: deals.status };
  const mine = deals.rows.filter((row) => row.rep_id === userId);
  if (mine.length > 0) {
    return { status: "ready", state: assembleTrackerState(mine), userId };
  }
  const legacy = await loadLegacyState(userId);
  return { status: "ready", state: legacy, userId };
}

export async function saveStateToCloud(state: TrackerState): Promise<CloudLoad["status"] | "synced"> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  const profile = getCachedProfile();
  const deals = await loadDealRows();
  if (deals.status !== "ready") return deals.status;
  const mine = deals.rows.filter((row) => row.rep_id === userId);
  const error = await syncDealPayloads({
    repId: userId,
    locationId: profile?.location_id ?? null,
    createdBy: userId,
    payloads: flattenTrackerState(state),
    existing: mine,
  });
  if (error) {
    if (error.includes("Could not find the table") || error.includes("schema cache")) return "setup";
    if (/row-level security|permission denied|jwt/i.test(error)) return "blocked";
    return "offline";
  }
  return "synced";
}
