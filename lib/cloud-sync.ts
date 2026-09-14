import { assembleLiveState, assembleOverlayState, assembleStagedState, flattenTrackerState } from "./deal-records.ts";
import { getCachedProfile, isMissingFunction, isMissingTable, loadDealRows, syncDraftPayloads, syncLivePayloads, syncStagedEdits } from "./org.ts";
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
  if (deals.status === "blocked") return { status: "blocked" };
  if (deals.status === "setup") return { status: "setup" };
  if (deals.status === "signed-out") return { status: "signed-out" };
  const rows = deals.status === "ready" ? deals.rows : [];
  const ownerId = targetRepId ?? userId;
  const mine = rows.filter((row) => row.rep_id === ownerId);
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
  if (deals.status === "blocked") return "blocked";
  if (deals.status === "setup") return "setup";
  if (deals.status === "signed-out") return "signed-out";
  const rows = deals.status === "ready" ? deals.rows : [];
  const ownerId = targetRepId ?? userId;
  const mine = rows.filter((row) => row.rep_id === ownerId);
  const payloads = flattenTrackerState(state);
  const target = rows.find((row) => row.rep_id === ownerId);
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
    console.error("Cloud save failed:", error);
    if (isMissingTable(error)) return "setup";
    if (/row-level security|permission denied|jwt|not allowed/i.test(error)) return "blocked";
    if (isMissingFunction(error)) return "synced";
    return "offline";
  }
  return "synced";
}
