"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadStateFromCloud, saveStateToCloud } from "@/lib/cloud-sync";
import { emptyState, loadState, saveState } from "@/lib/storage";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { TrackerState } from "@/lib/types";

export type CloudStatus = "local" | "syncing" | "synced" | "setup" | "offline";

const listeners = new Set<() => void>();
const serverSnapshot = emptyState();
let snapshot: TrackerState = serverSnapshot;
let loaded = false;
let cloudStatus: CloudStatus = "local";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrateStarted = false;

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

async function hydrateFromCloud() {
  if (hydrateStarted || !isSupabaseConfigured()) return;
  hydrateStarted = true;
  setCloudStatus("syncing");
  const result = await loadStateFromCloud();
  if (result.status === "setup") {
    setCloudStatus("setup");
    return;
  }
  if (result.status === "offline" || result.status === "unconfigured") {
    setCloudStatus(result.status === "unconfigured" ? "local" : "offline");
    return;
  }
  if (result.state && (result.state.months.length > 0 || result.state.vehicleTypes.length > 0)) {
    snapshot = result.state;
    saveState(snapshot);
    emit();
  } else if (snapshot.months.length > 0 || snapshot.vehicleTypes.length > 0) {
    const saved = await saveStateToCloud(snapshot);
    setCloudStatus(saved === "synced" ? "synced" : saved === "setup" ? "setup" : "offline");
    return;
  }
  setCloudStatus("synced");
}

function queueCloudSave(state: TrackerState) {
  if (!isSupabaseConfigured() || cloudStatus === "setup") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveStateToCloud(state).then((status) => {
      if (status === "synced") setCloudStatus("synced");
      else if (status === "setup") setCloudStatus("setup");
      else if (status === "offline") setCloudStatus("offline");
    });
  }, 400);
}

function getSnapshot() {
  if (!loaded) {
    snapshot = loadState();
    loaded = true;
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
      saveState(snapshot);
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
