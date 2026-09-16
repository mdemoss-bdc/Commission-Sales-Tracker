"use client";

import { useSyncExternalStore } from "react";
import { ADMIN_DRAFT_SAVED_TOAST } from "@/lib/admin-roster";
import { getSyncToast, subscribeSyncToast } from "@/lib/sync-feedback";

export function CloudSyncToast() {
  const message = useSyncExternalStore(subscribeSyncToast, getSyncToast, () => "");
  if (!message) return null;
  const success = message === ADMIN_DRAFT_SAVED_TOAST;
  return (
    <p
      className={`update-toast cloud-sync-toast no-print${success ? "" : " update-toast-warn"}`}
      role="status"
    >
      {message}
    </p>
  );
}
