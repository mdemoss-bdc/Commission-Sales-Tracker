"use client";

import { useCallback, useSyncExternalStore } from "react";
import { initAuth, onAuthUserChange } from "@/lib/auth-session";
import {
  acceptStagedAsIs,
  approveDealRecord,
  clearCachedProfile,
  createLocation,
  ensureOwnProfile,
  listLocations,
  listProfiles,
  loadDealRows,
  pushDraftsToEmployee,
  rejectDealRecord,
  submitModifiedStaged,
  updateProfileAssignment,
} from "@/lib/org";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { DealRow } from "@/lib/deal-records";
import type { LocationRecord, UserProfile, UserRole } from "@/lib/roles";
import { canManageOrg } from "@/lib/roles";

export type OrgSnapshot = {
  ready: boolean;
  profile: UserProfile | null;
  locations: LocationRecord[];
  people: UserProfile[];
  pending: DealRow[];
  stagedForRep: DealRow[];
  draftsForEntry: DealRow[];
  allDeals: DealRow[];
};

const empty: OrgSnapshot = {
  ready: false,
  profile: null,
  locations: [],
  people: [],
  pending: [],
  stagedForRep: [],
  draftsForEntry: [],
  allDeals: [],
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

function visiblePeople(profile: UserProfile, people: UserProfile[]): UserProfile[] {
  if (canManageOrg(profile.role)) return people;
  if (profile.role === "manager") {
    return people.filter(
      (person) => person.location_id && person.location_id === profile.location_id,
    );
  }
  return people.filter((person) => person.id === profile.id);
}

function visibleDeals(profile: UserProfile, rows: DealRow[]): DealRow[] {
  if (canManageOrg(profile.role)) return rows;
  if (profile.role === "manager") {
    return rows.filter((row) => row.location_id && row.location_id === profile.location_id);
  }
  return rows.filter((row) => row.rep_id === profile.id);
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
  const rows = deals.status === "ready" ? visibleDeals(ensured.profile, deals.rows) : [];
  snapshot = {
    ready: true,
    profile: ensured.profile,
    locations,
    people: visiblePeople(ensured.profile, people),
    pending: rows.filter((row) => row.status === "pending_manager_approval"),
    stagedForRep: rows.filter((row) => row.status === "staged" && row.rep_id === ensured.profile.id),
    draftsForEntry: rows.filter((row) => row.status === "draft"),
    allDeals: rows,
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

  const pushToEmployee = useCallback(async (repId: string) => {
    const error = await pushDraftsToEmployee(repId);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const acceptAsIs = useCallback(async () => {
    const error = await acceptStagedAsIs();
    if (!error) await refreshOrg();
    return error;
  }, []);

  const modifyAndSubmit = useCallback(async () => {
    const error = await submitModifiedStaged();
    if (!error) await refreshOrg();
    return error;
  }, []);

  const approveDeal = useCallback(async (id: string) => {
    const error = await approveDealRecord(id);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const rejectDeal = useCallback(async (id: string, reason: string) => {
    const error = await rejectDealRecord(id, reason);
    if (!error) await refreshOrg();
    return error;
  }, []);

  return {
    addLocation,
    assignPerson,
    pushToEmployee,
    acceptAsIs,
    modifyAndSubmit,
    approveDeal,
    rejectDeal,
  };
}

export function entryRepsFor(profile: UserProfile | null, people: UserProfile[]): UserProfile[] {
  if (!profile) return [];
  return people.filter((person) => {
    if (person.role !== "rep") return false;
    if (canManageOrg(profile.role)) return true;
    return (
      profile.role === "manager" &&
      Boolean(profile.location_id) &&
      person.location_id === profile.location_id
    );
  });
}
