import { assembleLiveState, assembleStagedState, flattenTrackerState, hasIncomingPushedSheet, rowsForMonth } from "./deal-records.ts";
import { refreshAuthSession } from "./auth-session.ts";
import {
  loadAdminEmployeeSheet,
  resolveAdminLedgerEmployeeId,
  resolveAdminLedgerPeriodKey,
  shouldPersistOverlayToAdminLedger,
  upsertAdminEmployeeSheet,
  deleteAdminEmployeeSheet,
} from "./admin-employee-sheets.ts";
import { isAwaitingRepAction, chainFromPayTrackerRow, isRepModifiedStatus, EMPTY_TRACKER } from "./approval-chain.ts";
import { getCachedProfile, listProfiles, loadDealRows, loadPayTrackerStateForUser, persistPayTrackerSnapshot, syncLivePayloads, syncStagedEdits } from "./org.ts";
import { withExplicitBonuses } from "./worksheet-persist.ts";
import { locationIdForRepSave } from "./assignment.ts";
import { hasTrackerData, parseTrackerState } from "./storage.ts";
import {
  listDeletedSaleIds,
  omitDeletedSalePayloads,
  omitDeletedSaleRows,
  stripDeletedSalesFromState,
} from "./sale-deletes.ts";
import { getSupabase, isSupabaseConfigured } from "./supabase.ts";
import { PAY_TRACKER_STATE_TABLE } from "./supabase-schema.ts";
import { isPersistedDealRecordId, trackerStateFromPayTrackerDocument } from "./pay-tracker-state.ts";
import { canManageOrg, canReviewDeals } from "./roles.ts";
import type { TrackerState } from "./types.ts";
import { emptyTrackerForPeriod, sheetMatchesRosterPeriod } from "./admin-roster.ts";
import { payPeriodKey, type PayPeriodIdentity } from "./pay-period.ts";

function honorDeletedSales(state: TrackerState | null, ownerId: string): TrackerState | null {
  if (!state) return state;
  return stripDeletedSalesFromState(state, listDeletedSaleIds(ownerId));
}

export type CloudLoad =
  | { status: "ready"; state: TrackerState | null; userId: string; incomingPush: boolean }
  | { status: "setup" }
  | { status: "offline" }
  | { status: "blocked" }
  | { status: "unconfigured" }
  | { status: "signed-out" };

export type TrackerView = "live" | "overlay" | "staged";
export type CloudSaveStatus = CloudLoad["status"] | "synced" | "retry" | "error";

export function shouldKeepLocalOverCloud(input: {
  incomingPush: boolean;
  cloudHasData: boolean;
  localHasData: boolean;
}): boolean {
  void input.incomingPush;
  if (input.cloudHasData) return false;
  return input.localHasData;
}

export function classifyCloudWriteError(error: string): "retry" | "error" {
  console.error("Cloud save failed:", error);
  const text = error.toLowerCase();
  if (
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("not signed in") ||
    text.includes("only an admin") ||
    text.includes("employee not found") ||
    text.includes("violates") ||
    text.includes("schema cache") ||
    text.includes("could not find the") ||
    error === "missing-admin-employee-sheets"
  ) {
    return "error";
  }
  return "retry";
}

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await refreshAuthSession();
  return user?.id ?? null;
}

async function loadLegacyState(userId: string): Promise<TrackerState | null> {
  const row = await loadPayTrackerStateForUser(userId);
  if (row) {
    const fromRow = trackerStateFromPayTrackerDocument(row.state);
    if (fromRow && hasTrackerData(fromRow)) return fromRow;
  }
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .select("state,status")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Legacy tracker load failed:", error.message);
    return null;
  }
  if (!data) return null;
  return parseTrackerState((data as { state?: unknown }).state);
}

export async function loadStateFromCloud(
  view: TrackerView = "live",
  targetRepId?: string,
  monthId?: string,
  period?: PayPeriodIdentity | null,
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
  const deletedIds = listDeletedSaleIds(ownerId);
  const mine = omitDeletedSaleRows(
    deals.rows.filter((row) => row.rep_id === ownerId),
    deletedIds,
  );
  const empty = { months: [] as TrackerState["months"], vehicleTypes: [] as TrackerState["vehicleTypes"] };
  const chainRow = await loadPayTrackerStateForUser(ownerId);
  const chain = chainRow ? chainFromPayTrackerRow(chainRow) : null;
  const monthPush = monthId ? hasIncomingPushedSheet(rowsForMonth(mine, monthId)) : false;
  const incomingPush =
    view === "live" &&
    !targetRepId &&
    (isAwaitingRepAction(chain?.status) || hasIncomingPushedSheet(mine) || monthPush);
  if (view === "overlay") {
    const actorIsAdmin = canManageOrg(getCachedProfile()?.role);
    if (actorIsAdmin) {
      const preferred = period ?? null;
      const periodKey =
        preferred?.key ??
        (preferred?.year && preferred?.month
          ? payPeriodKey(
              preferred.year,
              preferred.month,
              preferred.split === "unknown" ? "part1" : preferred.split,
            )
          : null);
      const ledger = await loadAdminEmployeeSheet(ownerId, periodKey);
      const row = ledger.status === "ready" ? ledger.row : null;
      const matchesPeriod = preferred ? sheetMatchesRosterPeriod(row, preferred) : true;
      let adminState =
        matchesPeriod && row?.state && hasTrackerData(row.state)
          ? honorDeletedSales(row.state, ownerId)
          : null;
      if (!adminState || !hasTrackerData(adminState)) {
        adminState = preferred ? emptyTrackerForPeriod(preferred) : empty;
      }
      return {
        status: "ready",
        state: adminState,
        userId: ownerId,
        incomingPush: false,
      };
    }
    const managerState =
      isRepModifiedStatus(chain?.status) && chain?.repDraft && hasTrackerData(chain.repDraft)
        ? chain.repDraft
        : chain?.adminBaseline && hasTrackerData(chain.adminBaseline)
          ? chain.adminBaseline
          : EMPTY_TRACKER;
    return {
      status: "ready",
      state: honorDeletedSales(managerState, ownerId) ?? empty,
      userId: ownerId,
      incomingPush: false,
    };
  }
  if (view === "staged") {
    return {
      status: "ready",
      state: honorDeletedSales(assembleStagedState(mine), ownerId),
      userId: ownerId,
      incomingPush,
    };
  }
  let liveState = assembleLiveState(mine);
  const workingFromState = chainRow ? trackerStateFromPayTrackerDocument(chainRow.state) : null;
  if (!hasTrackerData(liveState) && workingFromState && hasTrackerData(workingFromState)) {
    liveState = workingFromState;
  }
  liveState = honorDeletedSales(liveState, ownerId) ?? liveState;
  if (hasTrackerData(liveState)) {
    return { status: "ready", state: liveState, userId: ownerId, incomingPush };
  }
  if (view === "live" && !targetRepId) {
    const legacy = honorDeletedSales(await loadLegacyState(userId), userId);
    if (legacy) return { status: "ready", state: legacy, userId, incomingPush };
  }
  return { status: "ready", state: empty, userId: ownerId, incomingPush };
}

export async function saveStateToCloud(
  state: TrackerState,
  view: TrackerView = "live",
  targetRepId?: string,
  options?: { monthId?: string | null; urlRepId?: string | null; routePeriodKey?: string | null },
): Promise<CloudSaveStatus> {
  if (!isSupabaseConfigured()) return "unconfigured";
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  const profile = getCachedProfile();
  const ledgerEmployeeId = resolveAdminLedgerEmployeeId({
    targetRepId,
    urlRepId: options?.urlRepId,
  });
  const ownerId = ledgerEmployeeId ?? targetRepId ?? userId;
  const deletedIds = listDeletedSaleIds(ownerId);
  const normalized = stripDeletedSalesFromState(withExplicitBonuses(state), deletedIds);

  // Admin master-sheet overlay: write only to admin_employee_sheets (skip deal_records / pay_tracker_state).
  if (
    shouldPersistOverlayToAdminLedger({
      view,
      actorRole: profile?.role,
      targetRepId: ledgerEmployeeId,
    })
  ) {
    if (!ledgerEmployeeId) {
      console.error("Admin master sheet cloud save aborted: employee_id unresolved.");
      return "error";
    }
    const periodKey = resolveAdminLedgerPeriodKey({
      monthId: options?.monthId ?? null,
      routePeriodKey: options?.routePeriodKey ?? null,
    });
    // Removing the last month/sheet must delete the ledger row — never call upsert RPC for deletions.
    if (normalized.months.length === 0) {
      const deleteError = await deleteAdminEmployeeSheet({
        employeeId: ledgerEmployeeId,
        periodKey,
      });
      if (!deleteError) return "synced";
      console.error("Admin master sheet delete failed:", deleteError);
      return classifyCloudWriteError(deleteError);
    }
    let locationId: string | null = profile?.location_id ?? null;
    try {
      const people = await listProfiles();
      locationId = people.find((person) => person.id === ledgerEmployeeId)?.location_id ?? locationId;
    } catch (err) {
      console.error("Admin ledger save: could not resolve employee location:", err);
    }
    const ledgerError = await upsertAdminEmployeeSheet({
      employeeId: ledgerEmployeeId,
      state: normalized,
      locationId,
      monthId: options?.monthId ?? null,
      urlRepId: options?.urlRepId ?? null,
      routePeriodKey: options?.routePeriodKey ?? null,
      isPaid: false,
    });
    if (!ledgerError) return "synced";
    console.error("Admin master sheet cloud save failed:", ledgerError);
    return classifyCloudWriteError(ledgerError);
  }

  if (view === "overlay" && canManageOrg(profile?.role) && !ledgerEmployeeId) {
    console.error(
      "Admin overlay save skipped: employee_id missing from entryRepId/URL/admin context (refusing empty fallback).",
    );
    return "error";
  }

  const deals = await loadDealRows();
  if (deals.status !== "ready") {
    if (deals.status === "signed-out") return "signed-out";
    return classifyCloudWriteError(`deal_records load returned ${deals.status}`);
  }
  const rows = deals.rows;
  const mine = rows.filter((row) => row.rep_id === ownerId && isPersistedDealRecordId(row.id));
  const payloads = omitDeletedSalePayloads(flattenTrackerState(normalized), deletedIds);
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
  if (view === "live") {
    const snapshotError = await persistPayTrackerSnapshot({
      employeeId: ownerId,
      state: normalized,
      locationId,
    });
    if (snapshotError) {
      return classifyCloudWriteError(snapshotError);
    }
  }
  if (view === "overlay") {
    if (canManageOrg(profile?.role)) {
      // Admin overlay already returned above when shouldPersistOverlayToAdminLedger matched.
      return "synced";
    }
    // Manager editing a pushed sheet for a rep: persist snapshot + deal rows.
    if (canReviewDeals(profile?.role) && ownerId) {
      const { saveManagerPushedSheetEdits } = await import("./org.ts");
      const managerError = await saveManagerPushedSheetEdits({
        employeeId: ownerId,
        state: normalized,
      });
      if (!managerError) return "synced";
      return classifyCloudWriteError(managerError);
    }
    return "synced";
  }
  const error =
    view === "staged"
      ? await syncStagedEdits({ repId: ownerId, payloads, existing: mine })
      : await syncLivePayloads({
          repId: ownerId,
          locationId,
          createdBy: userId,
          payloads,
          existing: mine,
        });
  if (error) {
    return classifyCloudWriteError(error);
  }
  return "synced";
}
