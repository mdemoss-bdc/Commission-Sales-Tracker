"use client";

import { useSyncExternalStore } from "react";
import { getSyncToast, subscribeSyncToast } from "@/lib/sync-feedback";

export function CloudSyncToast() {
  const message = useSyncExternalStore(subscribeSyncToast, getSyncToast, () => "");
  if (!message) return null;
  return (
    <p className="update-toast update-toast-warn cloud-sync-toast no-print" role="status">
      {message}
    </p>
  );
}
