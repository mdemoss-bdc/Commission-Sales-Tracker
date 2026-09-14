"use client";

import { useCallback, useSyncExternalStore } from "react";
import { emptyState, loadState, saveState } from "@/lib/storage";
import type { TrackerState } from "@/lib/types";

const listeners = new Set<() => void>();
const serverSnapshot = emptyState();
let snapshot: TrackerState = serverSnapshot;
let loaded = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  if (!loaded) {
    snapshot = loadState();
    loaded = true;
  }
  return snapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

export function useTrackerStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setState = useCallback(
    (patch: Partial<TrackerState> | ((current: TrackerState) => TrackerState)) => {
      snapshot = typeof patch === "function" ? patch(snapshot) : { ...snapshot, ...patch };
      saveState(snapshot);
      emit();
    },
    [],
  );

  return [state, setState] as const;
}
