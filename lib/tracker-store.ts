"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  onAuthUserChange,
  type SessionUser,
} from "@/lib/auth-session";
import { loadStateFromCloud, saveStateToCloud, shouldKeepLocalOverCloud, type CloudSaveStatus, type TrackerView } from "@/lib/cloud-sync";
import { deleteDealRecordsForSales } from "@/lib/org";
import {
  emptyState,
  hasTrackerData,
  loadState,
  saveState,
  takeGuestStateForUser,
} from "@/lib/storage";
import { listDeletedSaleIds, rememberDeletedSaleIds, stripDeletedSalesFromState } from "@/lib/sale-deletes";
import { refreshOrg } from "@/lib/org-store";
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
  entryRepId = null;
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

async function persistToCloud() {
  if (!isSupabaseConfigured() || !activeUserId) return;
  if (saveInFlight) {
    saveAgain = true;
    return;
  }
  const writeGeneration = localEditGeneration;
  saveInFlight = true;
  setCloudStatus("syncing");
  try {
    const status = await saveStateToCloud(snapshot, currentView(), entryRepId ?? undefined);
    if (status === "signed-out") {
      setCloudStatus("signed-out");
      return;
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
      return;
    }
    if (status === "unconfigured") {
      setCloudStatus("local");
      return;
    }
    noteCloudWriteFailure(status);
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
  const result = await loadStateFromCloud(currentView(), entryRepId ?? undefined, monthId);
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
  if (incomingPush || cloudHasData) {
    applyState(result.state ?? emptyState());
    setCloudStatus("synced");
    return;
  }
  if (shouldKeepLocalOverCloud({ incomingPush: false, cloudHasData: false, localHasData: hasTrackerData(snapshot) })) {
    if (!entryRepId && !reviewMode) {
      await persistToCloud();
      return;
    }
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
      void refreshFromCloud();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pay_tracker_state" }, () => {
      void refreshFromCloud();
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

export async function flushTrackerSave() {
  if (saveTimer) clearTimeout(saveTimer);
  if (!isSupabaseConfigured() || !activeUserId) return;
  await persistToCloud();
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

export function setEntryRepId(next: string | null) {
  if (entryRepId === next && !reviewMode) return;
  if (saveTimer) clearTimeout(saveTimer);
  entryRepId = next;
  reviewMode = false;
  hydrateStarted = false;
  emit();
  void hydrateFromCloud();
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
