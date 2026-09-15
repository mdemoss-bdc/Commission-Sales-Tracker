import { assembleOverlayState, assembleRepViewState, assembleStagedState, flattenTrackerState, hasIncomingPushedSheet, rowsForMonth } from "./deal-records.ts";
import { refreshAuthSession } from "./auth-session.ts";
import { getCachedProfile, isMissingFunction, isMissingTable, listProfiles, loadDealRows, syncDraftPayloads, syncLivePayloads, syncStagedEdits } from "./org.ts";
import { locationIdForRepSave } from "./assignment.ts";
import { parseTrackerState } from "./storage.ts";
import { getSupabase, isSupabaseConfigured } from "./supabase.ts";
import { PAY_TRACKER_STATE_TABLE } from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

export type CloudLoad =
  | { status: "ready"; state: TrackerState | null; userId: string; incomingPush: boolean }
  | { status: "setup" }
  | { status: "offline" }
  | { status: "blocked" }
  | { status: "unconfigured" }
  | { status: "signed-out" };

export type TrackerView = "live" | "overlay" | "staged";
export type CloudSaveStatus = CloudLoad["status"] | "synced" | "retry";

export function shouldKeepLocalOverCloud(input: {
  incomingPush: boolean;
  cloudHasData: boolean;
  localHasData: boolean;
}): boolean {
  if (input.incomingPush) return false;
  if (input.cloudHasData) return false;
  return input.localHasData;
}

export function classifyCloudWriteError(error: string): "retry" {
  console.error("Cloud save failed:", error);
  return "retry";
}

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await refreshAuthSession();
  return user?.id ?? null;
}

async function loadLegacyState(userId: string): Promise<TrackerState | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .select("state")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Legacy tracker load failed:", error.message);
    return null;
  }
  if (!data) return null;
  return parseTrackerState(data.state);
}

export async function loadStateFromCloud(
  view: TrackerView = "live",
  targetRepId?: string,
  monthId?: string,
): Promise<CloudLoad> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const userId = await currentUserId();
  if (!userId) return { status: "signed-out" };
  const deals = await loadDealRows();
  if (deals.status !== "ready") {
    if (deals.status === "signed-out") return { status: "signed-out" };
    console.error("deal_records load did not succeed:", deals.status);
    return { status: deals.status };
  }
  const ownerId = targetRepId ?? userId;
  const mine = deals.rows.filter((row) => row.rep_id === ownerId);
  const incomingPush =
    view === "live" &&
    !targetRepId &&
    (hasIncomingPushedSheet(mine) || (monthId ? hasIncomingPushedSheet(rowsForMonth(mine, monthId)) : false));
  if (mine.length > 0) {
    const state =
      view === "overlay"
        ? assembleOverlayState(mine)
        : view === "staged"
          ? assembleStagedState(mine)
          : assembleRepViewState(mine);
    return { status: "ready", state, userId: ownerId, incomingPush };
  }
  if (view === "live" && !targetRepId) {
    const legacy = await loadLegacyState(userId);
    return { status: "ready", state: legacy, userId, incomingPush: false };
  }
  return { status: "ready", state: { months: [], vehicleTypes: [] }, userId: ownerId, incomingPush };
}

export async function saveStateToCloud(
  state: TrackerState,
  view: TrackerView = "live",
  targetRepId?: string,
): Promise<CloudSaveStatus> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  const profile = getCachedProfile();
  const deals = await loadDealRows();
  if (deals.status !== "ready") {
    if (deals.status === "signed-out") return "signed-out";
    return classifyCloudWriteError(`deal_records load returned ${deals.status}`);
  }
  const rows = deals.rows;
  const ownerId = targetRepId ?? userId;
  const mine = rows.filter((row) => row.rep_id === ownerId);
  const payloads = flattenTrackerState(state);
  const target = rows.find((row) => row.rep_id === ownerId);
  let targetRepLocationId: string | null | undefined =
    ownerId === userId ? profile?.location_id : undefined;
  if (ownerId !== userId) {
    const people = await listProfiles();
    targetRepLocationId = people.find((person) => person.id === ownerId)?.location_id ?? null;
  }
  const locationId = locationIdForRepSave({
    existingDealLocation: target?.location_id,
    targetRepId: ownerId,
    actorId: userId,
    actorLocationId: profile?.location_id,
    targetRepLocationId,
  });
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
    if (isMissingTable(error) || isMissingFunction(error)) {
      return classifyCloudWriteError(error);
    }
    return classifyCloudWriteError(error);
  }
  return "synced";
}
