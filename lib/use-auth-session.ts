"use client";

import { useSyncExternalStore } from "react";
import {
  getSessionUser,
  initAuth,
  isAuthReady,
  isPasswordRecovery,
  shouldOpenDashboardAfterConfirm,
  subscribeAuth,
  type SessionUser,
} from "@/lib/auth-session";

type AuthSnapshot = {
  ready: boolean;
  user: SessionUser | null;
  passwordRecovery: boolean;
  homeAfterConfirm: boolean;
};

const serverSnapshot: AuthSnapshot = {
  ready: false,
  user: null,
  passwordRecovery: false,
  homeAfterConfirm: false,
};
let snapshot: AuthSnapshot = serverSnapshot;

function refreshSnapshot(): AuthSnapshot {
  const next = {
    ready: isAuthReady(),
    user: getSessionUser(),
    passwordRecovery: isPasswordRecovery(),
    homeAfterConfirm: shouldOpenDashboardAfterConfirm(),
  };
  if (
    snapshot.ready === next.ready &&
    snapshot.passwordRecovery === next.passwordRecovery &&
    snapshot.homeAfterConfirm === next.homeAfterConfirm &&
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
  queueMicrotask(() => {
    void initAuth().finally(() => {
      refreshSnapshot();
      listener();
    });
  });
  return unsubscribe;
}

export function useAuthSession(): AuthSnapshot {
  return useSyncExternalStore(subscribe, refreshSnapshot, () => serverSnapshot);
}
