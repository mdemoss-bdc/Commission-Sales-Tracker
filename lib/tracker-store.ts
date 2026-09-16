"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  onAuthUserChange,
  type SessionUser,
} from "@/lib/auth-session";
import { loadStateFromCloud, saveStateToCloud, shouldKeepLocalOverCloud, type CloudSaveStatus, type TrackerView } from "@/lib/cloud-sync";
import { deleteDealRecordsForSales, getCachedProfile } from "@/lib/org";
import { canManageOrg } from "@/lib/roles";
import {
  emptyState,
  hasTrackerData,
  loadState,
  saveState,
  takeGuestStateForUser,
} from "@/lib/storage";
import { listDeletedSaleIds, rememberDeletedSaleIds, stripDeletedSalesFromState } from "@/lib/sale-deletes";
import { getAdminRosterPeriod, refreshOrg } from "@/lib/org-store";
import { payPeriodKey } from "@/lib/pay-period";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { showSyncToast } from "@/lib/sync-feedback";
import type { TrackerState } from "@/lib/types";
import {
  REMOTE_ECHO_HOLD_MS,
  markLocalEdit,
  resolvePersistedGeneration,
  shouldApplyRemoteWorksheet,
} from "@/lib/worksheet-persist";

export type CloudStatus = "local" | "signed-out" | "syncing" | "synced";

const INITIAL_RETRY_MS = 1500;
const MAX_RETRY_MS = 20000;
const ENTRY_REP_SESSION_KEY = "pay-tracker-entry-rep";

const listeners = new Set<() => void>();
const serverSnapshot = emptyState();
let snapshot: TrackerState = serverSnapshot;
let loaded = false;
let activeUserId: string | null = null;
let entryRepId: string | null = null;
let reviewMode = false;
let incomingPushActive = false;
let liveTrackerSyncStarted = false;
let cloudStatus: CloudStatus = "local";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = INITIAL_RETRY_MS;
let saveInFlight = false;
let saveAgain = false;
let hydrateStarted = false;
let hydrateGen = 0;
let authHooked = false;
let isDirty = false;
let localEditGeneration = 0;
let persistedGeneration = 0;
let ignoreRemoteUntilMs = 0;

function readStoredEntryRepId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("rep") || params.get("employee");
    if (fromQuery?.trim()) return fromQuery.trim();
    const stored = window.sessionStorage.getItem(ENTRY_REP_SESSION_KEY);
    return stored?.trim() || null;
  } catch {
    return null;
  }
}

function rememberEntryRepId(next: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (next?.trim()) window.sessionStorage.setItem(ENTRY_REP_SESSION_KEY, next.trim());
    else window.sessionStorage.removeItem(ENTRY_REP_SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

function readRoutePeriodKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const match = window.location.pathname.match(/\/m\/([^/]+)\/s\//);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentView(): TrackerView {
  if (entryRepId) return "overlay";
  if (reviewMode) return "staged";
  return "live";
}

function currentOwnerId(): string | null {
  return entryRepId ?? activeUserId;
}

function setCloudStatus(next: CloudStatus) {
  if (cloudStatus === next) return;
  cloudStatus = next;
  emit();
}

function persistLocal(state: TrackerState) {
  const owner = currentOwnerId();
  const cleaned = stripDeletedSalesFromState(state, listDeletedSaleIds(owner));
  saveState(cleaned, owner ? `${reviewMode ? "review:" : entryRepId ? "draft:" : ""}${owner}` : null);
}

function applyState(state: TrackerState, persist = true) {
  snapshot = stripDeletedSalesFromState(state, listDeletedSaleIds(currentOwnerId()));
  if (persist) persistLocal(snapshot);
  emit();
}

function hookAuth() {
  if (authHooked) return;
  authHooked = true;
  onAuthUserChange((user) => {
    void switchUser(user);
  });
}

async function switchUser(user: SessionUser | null) {
  if (saveTimer) clearTimeout(saveTimer);
  if (retryTimer) clearTimeout(retryTimer);
  retryDelay = INITIAL_RETRY_MS;
  activeUserId = user?.id ?? null;
  entryRepId = readStoredEntryRepId();
  reviewMode = false;
  hydrateStarted = false;
  isDirty = false;
  localEditGeneration = 0;
  persistedGeneration = 0;
  ignoreRemoteUntilMs = 0;
  applyState(loadState(activeUserId), false);
  await hydrateFromCloud();
}

function scheduleSaveRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void persistToCloud();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
}

function noteCloudWriteFailure(status: CloudSaveStatus) {
  console.error("Cloud write did not complete:", status);
  if (status === "error") {
    showSyncToast("Couldn't finish cloud save. Check console for details.");
    setCloudStatus(activeUserId ? "synced" : "signed-out");
    return;
  }
  showSyncToast("Couldn't finish cloud save. Retrying in the background.");
  setCloudStatus(activeUserId ? "synced" : "signed-out");
  scheduleSaveRetry();
}

function remoteApplyAllowed(force = false) {
  return shouldApplyRemoteWorksheet({
    isDirty,
    saveInFlight,
    localEditGeneration,
    persistedGeneration,
    ignoreRemoteUntilMs,
    nowMs: Date.now(),
    force,
  });
}

function noteLocalUserEdit() {
  const next = markLocalEdit(localEditGeneration);
  isDirty = next.isDirty;
  localEditGeneration = next.localEditGeneration;
}

async function persistToCloud(): Promise<CloudSaveStatus | undefined> {
  if (!isSupabaseConfigured() || !activeUserId) return undefined;
  if (saveInFlight) {
    saveAgain = true;
    return undefined;
  }
  const writeGeneration = localEditGeneration;
  saveInFlight = true;
  setCloudStatus("syncing");
  try {
    const rosterPeriod = entryRepId || readStoredEntryRepId() ? getAdminRosterPeriod() : null;
    const routePeriodKey = readRoutePeriodKey();
    const monthId =
      routePeriodKey ||
      rosterPeriod?.key ||
      (rosterPeriod?.year && rosterPeriod?.month && rosterPeriod.split !== "unknown"
        ? payPeriodKey(rosterPeriod.year, rosterPeriod.month, rosterPeriod.split)
        : null);
    const resolvedRepId = entryRepId?.trim() || readStoredEntryRepId() || undefined;
    if (resolvedRepId && !entryRepId) {
      entryRepId = resolvedRepId;
    }
    const status = await saveStateToCloud(snapshot, currentView(), resolvedRepId, {
      monthId,
      urlRepId: readStoredEntryRepId(),
      routePeriodKey,
    });
    if (status === "signed-out") {
      setCloudStatus("signed-out");
      return status;
    }
    if (status === "synced") {
      retryDelay = INITIAL_RETRY_MS;
      setCloudStatus("synced");
      const resolved = resolvePersistedGeneration({
        writeGeneration,
        localEditGeneration,
      });
      isDirty = resolved.isDirty;
      persistedGeneration = resolved.persistedGeneration;
      if (!resolved.isDirty) {
        ignoreRemoteUntilMs = Date.now() + REMOTE_ECHO_HOLD_MS;
      }
      return status;
    }
    if (status === "unconfigured") {
      setCloudStatus("local");
      return status;
    }
    noteCloudWriteFailure(status);
    return status;
  } finally {
    saveInFlight = false;
    if (saveAgain) {
      saveAgain = false;
      void persistToCloud();
    }
  }
}

async function hydrateFromCloud(monthId?: string, force = false) {
  if (hydrateStarted) return;
  hydrateStarted = true;
  const gen = ++hydrateGen;
  hookAuth();
  startLiveTrackerSync();
  await initAuth();
  if (gen !== hydrateGen) return;
  const user = getSessionUser();
  activeUserId = user?.id ?? null;
  if (!isSupabaseConfigured()) {
    if (remoteApplyAllowed(force)) applyState(loadState(null), false);
    setCloudStatus("local");
    return;
  }
  if (!user) {
    if (remoteApplyAllowed(force)) applyState(loadState(null), false);
    setCloudStatus("signed-out");
    incomingPushActive = false;
    return;
  }
  await refreshOrg();
  if (gen !== hydrateGen) return;
  setCloudStatus("syncing");
  const owner = currentOwnerId() ?? user.id;
  const local = loadState(`${reviewMode ? "review:" : entryRepId ? "draft:" : ""}${owner}`);
  if (remoteApplyAllowed(force)) applyState(local, false);
  const result = await loadStateFromCloud(
    currentView(),
    entryRepId ?? undefined,
    monthId,
    entryRepId ? getAdminRosterPeriod() : undefined,
  );
  if (gen !== hydrateGen) return;
  if (result.status === "signed-out") {
    activeUserId = null;
    if (remoteApplyAllowed(force)) applyState(loadState(null), false);
    setCloudStatus("signed-out");
    incomingPushActive = false;
    return;
  }
  if (result.status === "unconfigured") {
    setCloudStatus("local");
    return;
  }
  if (result.status !== "ready") {
    console.error("Cloud load did not succeed:", result.status);
    showSyncToast("Couldn't refresh cloud data. Retrying in the background.");
    setCloudStatus("synced");
    scheduleSaveRetry();
    return;
  }
  const incomingPush = Boolean(result.incomingPush);
  incomingPushActive = incomingPush && !entryRepId && !reviewMode;
  const cloudHasData = Boolean(result.state && hasTrackerData(result.state));
  if (!remoteApplyAllowed(force)) {
    setCloudStatus("synced");
    return;
  }
  if (
    shouldKeepLocalOverCloud({
      incomingPush,
      cloudHasData,
      localHasData: hasTrackerData(snapshot),
    })
  ) {
    if (!entryRepId && !reviewMode && !cloudHasData) {
      await persistToCloud();
      return;
    }
    setCloudStatus("synced");
    return;
  }
  if (cloudHasData) {
    applyState(result.state ?? emptyState());
    setCloudStatus("synced");
    return;
  }
  if (!entryRepId && !reviewMode) {
    const guest = takeGuestStateForUser(user.id);
    if (guest) {
      applyState(guest);
      await persistToCloud();
      return;
    }
  }
  if (!remoteApplyAllowed(force)) {
    setCloudStatus("synced");
    return;
  }
  applyState(result.state ?? emptyState());
  setCloudStatus("synced");
}

function tableBelongsToCurrentView(table: string): boolean {
  const view = currentView();
  if (view === "overlay") {
    if (canManageOrg(getCachedProfile()?.role)) return table === "admin_employee_sheets";
    return table === "pay_tracker_state";
  }
  return table === "deal_records" || table === "pay_tracker_state";
}

function startLiveTrackerSync() {
  if (liveTrackerSyncStarted || typeof window === "undefined") return;
  liveTrackerSyncStarted = true;
  window.addEventListener("focus", () => {
    void refreshFromCloud();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshFromCloud();
  });
  const supabase = getSupabase();
  if (!supabase) return;
  supabase
    .channel("tracker-live-refresh")
    .on("postgres_changes", { event: "*", schema: "public", table: "deal_records" }, () => {
      if (tableBelongsToCurrentView("deal_records")) void refreshFromCloud();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pay_tracker_state" }, () => {
      if (tableBelongsToCurrentView("pay_tracker_state")) void refreshFromCloud();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "admin_employee_sheets" }, () => {
      if (tableBelongsToCurrentView("admin_employee_sheets")) void refreshFromCloud();
    })
    .subscribe();
}

function queueCloudSave(state: TrackerState) {
  if (!isSupabaseConfigured() || !activeUserId) return;
  persistLocal(state);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  void persistToCloud();
}

function getSnapshot() {
  if (!loaded) {
    loaded = true;
    hookAuth();
    queueMicrotask(() => {
      void hydrateFromCloud();
    });
  }
  return snapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

export function useTrackerStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setState = useCallback(
    (patch: TrackerState | ((current: TrackerState) => TrackerState)) => {
      const next = typeof patch === "function" ? patch(snapshot) : patch;
      snapshot = stripDeletedSalesFromState(next, listDeletedSaleIds(currentOwnerId()));
      noteLocalUserEdit();
      persistLocal(snapshot);
      queueCloudSave(snapshot);
      emit();
    },
    [],
  );

  return [state, setState] as const;
}

export function useCloudStatus() {
  return useSyncExternalStore(
    subscribe,
    () => cloudStatus,
    () => "local" as CloudStatus,
  );
}

export function useEntryRepId() {
  return useSyncExternalStore(
    subscribe,
    () => entryRepId,
    () => null as string | null,
  );
}

export function useReviewMode() {
  return useSyncExternalStore(
    subscribe,
    () => reviewMode,
    () => false,
  );
}

export function retryCloudSync() {
  void refreshFromCloud();
}

export function clearIncomingPush() {
  incomingPushActive = false;
}

export async function refreshFromCloud(monthId?: string, options?: { force?: boolean }) {
  if (!options?.force && !remoteApplyAllowed()) return;
  hydrateStarted = false;
  retryDelay = INITIAL_RETRY_MS;
  await hydrateFromCloud(monthId, options?.force);
}

export function getTrackerSnapshot() {
  return snapshot;
}

export async function flushTrackerSave(): Promise<CloudSaveStatus | undefined> {
  if (saveTimer) clearTimeout(saveTimer);
  if (!isSupabaseConfigured() || !activeUserId) return undefined;
  const started = Date.now();
  while (saveInFlight && Date.now() - started < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return persistToCloud();
}

export async function persistDeletedSales(saleIds: string[]) {
  const ids = [...new Set(saleIds.filter(Boolean))];
  if (ids.length === 0) return;
  rememberDeletedSaleIds(ids, currentOwnerId());
  snapshot = stripDeletedSalesFromState(snapshot, listDeletedSaleIds(currentOwnerId()));
  noteLocalUserEdit();
  persistLocal(snapshot);
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  await deleteDealRecordsForSales(ids, currentOwnerId());
  await persistToCloud();
}

export function setEntryRepId(next: string | null, forceHydrate = false) {
  const cleaned = typeof next === "string" && next.trim() ? next.trim() : null;
  if (entryRepId === cleaned && !reviewMode && !forceHydrate) return;
  if (saveTimer) clearTimeout(saveTimer);
  entryRepId = cleaned;
  rememberEntryRepId(cleaned);
  reviewMode = false;
  hydrateStarted = false;
  emit();
  void hydrateFromCloud(undefined, true);
}

export function setReviewMode(next: boolean) {
  if (reviewMode === next && !entryRepId) return;
  if (saveTimer) clearTimeout(saveTimer);
  reviewMode = next;
  entryRepId = null;
  hydrateStarted = false;
  emit();
  void hydrateFromCloud();
}
