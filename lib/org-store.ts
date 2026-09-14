"use client";

import { useCallback, useSyncExternalStore } from "react";
import { initAuth, onAuthUserChange } from "@/lib/auth-session";
import {
  createLocation,
  ensureOwnProfile,
  listLocations,
  listProfiles,
  loadDealRows,
  reviewDeal,
  submitOwnDeals,
  updateProfileAssignment,
  clearCachedProfile,
} from "@/lib/org";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { DealRow } from "@/lib/deal-records";
import type { LocationRecord, UserProfile, UserRole } from "@/lib/roles";

export type OrgSnapshot = {
  ready: boolean;
  profile: UserProfile | null;
  locations: LocationRecord[];
  people: UserProfile[];
  pending: DealRow[];
};

const empty: OrgSnapshot = {
  ready: false,
  profile: null,
  locations: [],
  people: [],
  pending: [],
};

const listeners = new Set<() => void>();
let snapshot: OrgSnapshot = empty;
let started = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshOrg(): Promise<void> {
  if (!isSupabaseConfigured()) {
    clearCachedProfile();
    snapshot = { ...empty, ready: true };
    emit();
    return;
  }
  await initAuth();
  const ensured = await ensureOwnProfile();
  if (ensured.status !== "ready") {
    clearCachedProfile();
    snapshot = { ...empty, ready: true, profile: null };
    emit();
    return;
  }
  const [locations, people, deals] = await Promise.all([listLocations(), listProfiles(), loadDealRows()]);
  const pending =
    deals.status === "ready"
      ? deals.rows.filter((row) => row.status === "pending_manager_approval")
      : [];
  snapshot = {
    ready: true,
    profile: ensured.profile,
    locations,
    people,
    pending,
  };
  emit();
}

function boot() {
  if (started) return;
  started = true;
  onAuthUserChange(() => {
    void refreshOrg();
  });
  void refreshOrg();
}

export function useOrg() {
  boot();
  return useSyncExternalStore(subscribe, () => snapshot, () => empty);
}

export function useOrgActions() {
  const addLocation = useCallback(async (name: string) => {
    const error = await createLocation(name);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const assignPerson = useCallback(
    async (userId: string, patch: { role?: UserRole; location_id?: string | null }) => {
      const error = await updateProfileAssignment(userId, patch);
      if (!error) await refreshOrg();
      return error;
    },
    [],
  );

  const submitDeals = useCallback(async () => {
    const error = await submitOwnDeals();
    if (!error) await refreshOrg();
    return error;
  }, []);

  const decideDeal = useCallback(async (id: string, decision: "approved" | "rejected") => {
    const error = await reviewDeal(id, decision);
    if (!error) await refreshOrg();
    return error;
  }, []);

  return { addLocation, assignPerson, submitDeals, decideDeal };
}
