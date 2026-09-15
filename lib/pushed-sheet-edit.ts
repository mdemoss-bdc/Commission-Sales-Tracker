"use client";

import { useSyncExternalStore } from "react";

export type EditingPushedSheet = {
  monthId: string;
  sheetId: string;
};

let current: EditingPushedSheet | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginEditingPushedSheet(monthId: string, sheetId: string) {
  current = { monthId, sheetId };
  emit();
}

export function clearEditingPushedSheet() {
  if (!current) return;
  current = null;
  emit();
}

export function getEditingPushedSheet() {
  return current;
}

export function isEditingPushedSheet(monthId?: string, sheetId?: string): boolean {
  if (!current) return false;
  if (!monthId) return true;
  if (current.monthId !== monthId) return false;
  if (sheetId && current.sheetId !== sheetId) return false;
  return true;
}

export function useEditingPushedSheet(monthId?: string, sheetId?: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isEditingPushedSheet(monthId, sheetId),
    () => false,
  );
}
