"use client";

import { useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  isAuthReady,
  isPasswordRecovery,
  subscribeAuth,
  type SessionUser,
} from "@/lib/auth-session";

type AuthSnapshot = {
  ready: boolean;
  user: SessionUser | null;
  passwordRecovery: boolean;
};

let snapshot: AuthSnapshot = { ready: false, user: null, passwordRecovery: false };

function refreshSnapshot(): AuthSnapshot {
  const next = {
    ready: isAuthReady(),
    user: getSessionUser(),
    passwordRecovery: isPasswordRecovery(),
  };
  if (
    snapshot.ready === next.ready &&
    snapshot.passwordRecovery === next.passwordRecovery &&
    snapshot.user?.id === next.user?.id &&
    snapshot.user?.email === next.user?.email &&
    snapshot.user?.fullName === next.user?.fullName
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
