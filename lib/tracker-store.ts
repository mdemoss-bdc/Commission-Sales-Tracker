"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  onAuthUserChange,
  type SessionUser,
} from "@/lib/auth-session";
import { loadStateFromCloud, saveStateToCloud, type TrackerView } from "@/lib/cloud-sync";
import {
  emptyState,
  hasTrackerData,
  loadState,
  saveState,
  takeGuestStateForUser,
} from "@/lib/storage";
import { refreshOrg } from "@/lib/org-store";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { TrackerState } from "@/lib/types";

export type CloudStatus =
  | "local"
  | "signed-out"
  | "syncing"
  | "synced"
  | "setup"
  | "offline"
  | "blocked";

const listeners = new Set<() => void>();
const serverSnapshot = emptyState();
let snapshot: TrackerState = serverSnapshot;
let loaded = false;
let activeUserId: string | null = null;
let entryRepId: string | null = null;
let reviewMode = false;
let cloudStatus: CloudStatus = "local";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrateStarted = false;
let hydrateGen = 0;
let authHooked = false;

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
  saveState(state, owner ? `${reviewMode ? "review:" : entryRepId ? "draft:" : ""}${owner}` : null);
}

function applyState(state: TrackerState, persist = true) {
  snapshot = state;
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
  activeUserId = user?.id ?? null;
  entryRepId = null;
  reviewMode = false;
  hydrateStarted = false;
  applyState(loadState(activeUserId), false);
  await hydrateFromCloud();
}

async function hydrateFromCloud() {
  if (hydrateStarted) return;
  hydrateStarted = true;
  const gen = ++hydrateGen;
  hookAuth();
  await initAuth();
  if (gen !== hydrateGen) return;
  const user = getSessionUser();
  activeUserId = user?.id ?? null;
  if (!isSupabaseConfigured()) {
    applyState(loadState(null), false);
    setCloudStatus("local");
    return;
  }
  if (!user) {
    applyState(loadState(null), false);
    setCloudStatus("signed-out");
    return;
  }
  await refreshOrg();
  if (gen !== hydrateGen) return;
  setCloudStatus("syncing");
  const owner = currentOwnerId() ?? user.id;
  applyState(loadState(`${reviewMode ? "review:" : entryRepId ? "draft:" : ""}${owner}`), false);
  const result = await loadStateFromCloud(currentView(), entryRepId ?? undefined);
  if (gen !== hydrateGen) return;
  if (result.status === "setup" || result.status === "blocked" || result.status === "offline") {
    setCloudStatus(result.status);
    return;
  }
  if (result.status === "signed-out") {
    activeUserId = null;
    applyState(loadState(null), false);
    setCloudStatus("signed-out");
    return;
  }
  if (result.status === "unconfigured") {
    setCloudStatus("local");
    return;
  }
  if (result.state && hasTrackerData(result.state)) {
    applyState(result.state);
  } else if (!entryRepId && !reviewMode && hasTrackerData(snapshot)) {
    setCloudStatus(cloudStatusFromSave(await saveStateToCloud(snapshot, "live")));
    return;
  } else if (!entryRepId && !reviewMode) {
    const guest = takeGuestStateForUser(user.id);
    if (guest) {
      applyState(guest);
      setCloudStatus(cloudStatusFromSave(await saveStateToCloud(guest, "live")));
      return;
    }
    applyState(result.state ?? emptyState());
  } else {
    applyState(result.state ?? emptyState());
  }
  setCloudStatus("synced");
}

function cloudStatusFromSave(status: Awaited<ReturnType<typeof saveStateToCloud>>): CloudStatus {
  if (status === "synced") return "synced";
  if (status === "setup" || status === "blocked" || status === "signed-out" || status === "offline") {
    return status;
  }
  return "local";
}

function queueCloudSave(state: TrackerState) {
  if (!isSupabaseConfigured() || !activeUserId) return;
  if (cloudStatus === "setup" || cloudStatus === "signed-out" || cloudStatus === "blocked") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveStateToCloud(state, currentView(), entryRepId ?? undefined).then((status) => {
      setCloudStatus(cloudStatusFromSave(status));
    });
  }, 400);
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
      snapshot = typeof patch === "function" ? patch(snapshot) : patch;
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
  hydrateStarted = false;
  void hydrateFromCloud();
}

export function getTrackerSnapshot() {
  return snapshot;
}

export async function flushTrackerSave() {
  if (saveTimer) clearTimeout(saveTimer);
  if (!isSupabaseConfigured() || !activeUserId) return;
  if (cloudStatus === "setup" || cloudStatus === "signed-out" || cloudStatus === "blocked") return;
  const status = await saveStateToCloud(snapshot, currentView(), entryRepId ?? undefined);
  setCloudStatus(cloudStatusFromSave(status));
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
