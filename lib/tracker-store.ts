"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  onAuthUserChange,
  type SessionUser,
} from "@/lib/auth-session";
import { loadStateFromCloud, saveStateToCloud } from "@/lib/cloud-sync";
import {
  emptyState,
  hasTrackerData,
  loadState,
  saveState,
  takeGuestStateForUser,
} from "@/lib/storage";
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

function setCloudStatus(next: CloudStatus) {
  if (cloudStatus === next) return;
  cloudStatus = next;
  emit();
}

function persistLocal(state: TrackerState) {
  saveState(state, activeUserId);
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
  setCloudStatus("syncing");
  applyState(loadState(user.id), false);
  const result = await loadStateFromCloud();
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
  } else if (hasTrackerData(snapshot)) {
    setCloudStatus(cloudStatusFromSave(await saveStateToCloud(snapshot)));
    return;
  } else {
    const guest = takeGuestStateForUser(user.id);
    if (guest) {
      applyState(guest);
      setCloudStatus(cloudStatusFromSave(await saveStateToCloud(guest)));
      return;
    }
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
    void saveStateToCloud(state).then((status) => {
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

export function retryCloudSync() {
  hydrateStarted = false;
  void hydrateFromCloud();
}
