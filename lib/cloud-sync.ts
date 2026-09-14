import { assembleLiveState, assembleOverlayState, assembleStagedState, flattenTrackerState } from "./deal-records.ts";
import { getCachedProfile, loadDealRows, syncDraftPayloads, syncLivePayloads, syncStagedEdits } from "./org.ts";
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

export type TrackerView = "live" | "overlay" | "staged";

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

export async function loadStateFromCloud(view: TrackerView = "live", targetRepId?: string): Promise<CloudLoad> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const userId = await currentUserId();
  if (!userId) return { status: "signed-out" };
  const deals = await loadDealRows();
  if (deals.status !== "ready") return { status: deals.status };
  const ownerId = targetRepId ?? userId;
  const mine = deals.rows.filter((row) => row.rep_id === ownerId);
  if (mine.length > 0) {
    const state =
      view === "overlay" ? assembleOverlayState(mine) : view === "staged" ? assembleStagedState(mine) : assembleLiveState(mine);
    return { status: "ready", state, userId: ownerId };
  }
  if (view === "live" && !targetRepId) {
    const legacy = await loadLegacyState(userId);
    return { status: "ready", state: legacy, userId };
  }
  return { status: "ready", state: { months: [], vehicleTypes: [] }, userId: ownerId };
}

export async function saveStateToCloud(
  state: TrackerState,
  view: TrackerView = "live",
  targetRepId?: string,
): Promise<CloudLoad["status"] | "synced"> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  const profile = getCachedProfile();
  const deals = await loadDealRows();
  if (deals.status !== "ready") return deals.status;
  const ownerId = targetRepId ?? userId;
  const mine = deals.rows.filter((row) => row.rep_id === ownerId);
  const payloads = flattenTrackerState(state);
  const target = deals.rows.find((row) => row.rep_id === ownerId);
  const locationId =
    (target?.location_id ??
      (ownerId === userId ? profile?.location_id : null) ??
      profile?.location_id) ||
    null;
  const error =
    view === "overlay"
      ? await syncDraftPayloads({
          repId: ownerId,
          locationId,
          createdBy: userId,
          payloads,
          existing: mine,
        })
      : view === "staged"
        ? await syncStagedEdits({ repId: ownerId, payloads, existing: mine })
        : await syncLivePayloads({
            repId: ownerId,
            locationId,
            createdBy: userId,
            payloads,
            existing: mine,
          });
  if (error) {
    if (error.includes("Could not find the table") || error.includes("schema cache") || error.includes("Could not find the function")) {
      return "setup";
    }
    if (/row-level security|permission denied|jwt|not allowed/i.test(error)) return "blocked";
    return "offline";
  }
  return "synced";
}
