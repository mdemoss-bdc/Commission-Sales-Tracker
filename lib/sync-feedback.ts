"use client";

const listeners = new Set<() => void>();
let toast = "";
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeSyncToast(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncToast() {
  return toast;
}

export function showSyncToast(message: string) {
  toast = message;
  emit();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = "";
    emit();
  }, 4200);
}
