"use client";

import { useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  isAuthReady,
  subscribeAuth,
  type SessionUser,
} from "@/lib/auth-session";

type AuthSnapshot = {
  ready: boolean;
  user: SessionUser | null;
};

let snapshot: AuthSnapshot = { ready: false, user: null };

function refreshSnapshot(): AuthSnapshot {
  const next = { ready: isAuthReady(), user: getSessionUser() };
  if (
    snapshot.ready === next.ready &&
    snapshot.user?.id === next.user?.id &&
    snapshot.user?.email === next.user?.email
  ) {
    return snapshot;
  }
  snapshot = next;
  return snapshot;
}

function subscribe(listener: () => void) {
  const unsubscribe = subscribeAuth(() => {
    refreshSnapshot();
    listener();
  });
  void initAuth().then(() => {
    refreshSnapshot();
    listener();
  });
  return unsubscribe;
}

export function useAuthSession(): AuthSnapshot {
  return useSyncExternalStore(subscribe, refreshSnapshot, () => snapshot);
}
