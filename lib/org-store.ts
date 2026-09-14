"use client";

import { useCallback, useSyncExternalStore } from "react";
import { initAuth, onAuthUserChange } from "@/lib/auth-session";
import {
  acceptStagedAsIs,
  approveDealRecord,
  clearCachedProfile,
  createLocation,
  deleteLocation,
  deleteUserByAdmin,
  ensureOwnProfile,
  listLocations,
  listProfiles,
  loadDealRows,
  pushDraftsToEmployee,
  rejectDealRecord,
  submitModifiedStaged,
  updateProfileAssignment,
  updateOwnFullName,
  updateOwnEmail,
} from "@/lib/org";
import { matchesLocationFilter, isStoredLocationFilter } from "@/lib/locations";
import { entryRepsFor, visibleDeals, visiblePeople } from "@/lib/org-visibility";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { DealRow } from "@/lib/deal-records";
import type { LocationRecord, UserProfile, UserRole } from "@/lib/roles";

export type OrgSnapshot = {
  ready: boolean;
  profile: UserProfile | null;
  locations: LocationRecord[];
  people: UserProfile[];
  pending: DealRow[];
  stagedForRep: DealRow[];
  draftsForEntry: DealRow[];
  allDeals: DealRow[];
  locationFilterId: string | null;
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
  locationFilterId: null,
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
  const rows = deals.status === "ready" ? visibleDeals(ensured.profile, deals.rows) : [];
  const locationFilterId = isStoredLocationFilter(
    snapshot.locationFilterId,
    locations.map((location) => location.id),
  )
    ? snapshot.locationFilterId
    : null;
  snapshot = {
    ready: true,
    profile: ensured.profile,
    locations,
    people: visiblePeople(ensured.profile, people),
    pending: rows.filter((row) => row.status === "pending_manager_approval"),
    stagedForRep: rows.filter((row) => row.status === "staged" && row.rep_id === ensured.profile.id),
    draftsForEntry: rows.filter((row) => row.status === "draft"),
    allDeals: rows,
    locationFilterId,
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

  const removeLocation = useCallback(async (id: string) => {
    const error = await deleteLocation(id);
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

  const deletePerson = useCallback(async (userId: string) => {
    const error = await deleteUserByAdmin(userId);
    if (error) return error;
    dropPersonFromSnapshot(userId);
    void refreshOrg();
    return null;
  }, []);

  const updateOwnName = useCallback(async (fullName: string) => {
    const error = await updateOwnFullName(fullName);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const updateOwnProfileEmail = useCallback(async (email: string) => {
    const error = await updateOwnEmail(email);
    if (!error) await refreshOrg();
    return error;
  }, []);

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
    removeLocation,
    assignPerson,
    deletePerson,
    updateOwnName,
    updateOwnProfileEmail,
    pushToEmployee,
    acceptAsIs,
    modifyAndSubmit,
    approveDeal,
    rejectDeal,
  };
}

export function setLocationFilter(id: string | null) {
  if (snapshot.locationFilterId === id) return;
  snapshot = { ...snapshot, locationFilterId: id };
  emit();
}

export function dropPersonFromSnapshot(userId: string) {
  snapshot = {
    ...snapshot,
    people: snapshot.people.filter((person) => person.id !== userId),
    pending: snapshot.pending.filter((row) => row.rep_id !== userId && row.created_by !== userId),
    stagedForRep: snapshot.stagedForRep.filter((row) => row.rep_id !== userId),
    draftsForEntry: snapshot.draftsForEntry.filter((row) => row.rep_id !== userId && row.created_by !== userId),
    allDeals: snapshot.allDeals.filter((row) => row.rep_id !== userId && row.created_by !== userId),
  };
  emit();
}

export function peopleForView(org: OrgSnapshot): UserProfile[] {
  return org.people.filter((person) => matchesLocationFilter(person.location_id, org.locationFilterId));
}

export function dealsForView<T extends { location_id: string | null }>(org: OrgSnapshot, rows: T[]): T[] {
  return rows.filter((row) => matchesLocationFilter(row.location_id, org.locationFilterId));
}

export { entryRepsFor };
