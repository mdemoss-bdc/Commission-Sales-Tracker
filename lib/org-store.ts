"use client";

import { useCallback, useSyncExternalStore } from "react";
import { initAuth, onAuthUserChange } from "@/lib/auth-session";
import {
  acceptStagedAsIs,
  adminUpdatePayTiers,
  approveDealRecord,
  clearCachedProfile,
  createLocation,
  deleteLocation,
  deleteUserByAdmin,
  ensureOwnProfile,
  createCustomRole,
  listCustomRoles,
  finalApproveDeals,
  forwardDealsToAdmin,
  listOrganizations,
  listProfiles,
  loadDealRows,
  managerOverrideRepReady,
  managerPushAllToAdmin,
  pushDraftsToEmployee,
  recallPendingPush,
  rejectDealRecord,
  rejectDealRecords,
  resolvePendingRepReview,
  returnDealsToManager,
  setOrganizationCode,
  submitModifiedStaged,
  updateProfileAssignment,
  adminSetUserLocation,
  setMyLocation,
  getAvailableOrgLocations,
  updateOwnFullName,
  updateOwnEmail,
} from "@/lib/org";
import { latestPeriodRows } from "@/lib/latest-submission";
import { isAwaitingRepReview, isPendingEmployeeReview, type ReviewResolution } from "@/lib/rep-review";
import { isStoredLocationFilter } from "@/lib/locations";
import { dealsForView as filterDealsForView, entryRepsFor, peopleForView as filterPeopleForView, visibleDeals, visiblePeople } from "@/lib/org-visibility";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { DealRow } from "@/lib/deal-records";
import type { EmployeePushPayload } from "@/lib/employee-push";
import { canManageOrg, type CustomRole, type LocationRecord, type OrganizationRecord, type UserProfile, type UserRole } from "@/lib/roles";
import { COMMISSION_TIERS, setRuntimePayTiers } from "@/lib/commission";
import type { CommissionTier } from "@/lib/types";

export type OrgSnapshot = {
  ready: boolean;
  profile: UserProfile | null;
  locations: LocationRecord[];
  people: UserProfile[];
  pending: DealRow[];
  pendingAdmin: DealRow[];
  stagedForRep: DealRow[];
  waitingOnRep: DealRow[];
  draftsForEntry: DealRow[];
  allDeals: DealRow[];
  locationFilterId: string | null;
  organization: OrganizationRecord | null;
  customRoles: CustomRole[];
};

const empty: OrgSnapshot = {
  ready: false,
  profile: null,
  locations: [],
  people: [],
  pending: [],
  pendingAdmin: [],
  stagedForRep: [],
  waitingOnRep: [],
  draftsForEntry: [],
  allDeals: [],
  locationFilterId: null,
  organization: null,
  customRoles: [],
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

function organizationForProfile(
  organizations: OrganizationRecord[],
  profile: UserProfile,
  locations: LocationRecord[],
): OrganizationRecord | null {
  if (profile.org_id) {
    const match = organizations.find((item) => item.id === profile.org_id);
    if (match) return match;
  }
  const locationOrgId = locations.find((item) => item.id === profile.location_id)?.org_id;
  if (locationOrgId) {
    const match = organizations.find((item) => item.id === locationOrgId);
    if (match) return match;
  }
  return organizations[0] ?? null;
}

export async function refreshOrg(): Promise<void> {
  if (!isSupabaseConfigured()) {
    clearCachedProfile();
    setRuntimePayTiers(null);
    snapshot = { ...empty, ready: true };
    emit();
    return;
  }
  await initAuth();
  const ensured = await ensureOwnProfile();
  if (ensured.status === "signed-out") {
    clearCachedProfile();
    setRuntimePayTiers(null);
    snapshot = { ...empty, ready: true, profile: null };
    emit();
    return;
  }
  if (ensured.status !== "ready") {
    console.error("Profile refresh failed:", ensured.status);
    snapshot = { ...snapshot, ready: true };
    emit();
    return;
  }
  const [locations, people, deals, organizations, customRoles] = await Promise.all([
    getAvailableOrgLocations(),
    listProfiles(),
    loadDealRows(),
    listOrganizations(),
    listCustomRoles(),
  ]);
  const listedSelf = people.find((person) => person.id === ensured.profile.id);
  const profile = listedSelf ?? ensured.profile;
  const visibleTeam = visiblePeople(profile, people);
  const rows = deals.status === "ready" ? visibleDeals(profile, deals.rows, people) : [];
  const locationFilterId = isStoredLocationFilter(
    snapshot.locationFilterId,
    locations.map((location) => location.id),
  )
    ? snapshot.locationFilterId
    : null;
  const organization = organizationForProfile(organizations, profile, locations);
  setRuntimePayTiers(organization?.pay_tiers);
  snapshot = {
    ready: true,
    profile,
    locations,
    people: visibleTeam,
    pending: latestPeriodRows(rows.filter((row) => row.status === "pending_manager_approval")),
    pendingAdmin: canManageOrg(profile.role)
      ? latestPeriodRows(rows.filter((row) => row.status === "pending_admin_approval"))
      : [],
    stagedForRep: latestPeriodRows(
      rows.filter((row) => isAwaitingRepReview(row.status) && row.rep_id === profile.id),
    ),
    waitingOnRep: latestPeriodRows(rows.filter((row) => isPendingEmployeeReview(row.status))),
    draftsForEntry: rows.filter((row) => row.status === "draft"),
    allDeals: rows,
    locationFilterId,
    organization,
    customRoles,
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
  if (typeof window !== "undefined") startLiveOrgSync();
}

let liveSyncStarted = false;
let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleOrgRefresh() {
  if (liveRefreshTimer != null) return;
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = null;
    void refreshOrg();
  }, 400);
}

function startLiveOrgSync() {
  if (liveSyncStarted) return;
  liveSyncStarted = true;
  window.setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void refreshOrg();
  }, 8000);
  window.addEventListener("focus", () => {
    void refreshOrg();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshOrg();
  });
  const supabase = getSupabase();
  if (!supabase) return;
  supabase
    .channel("org-live-refresh")
    .on("postgres_changes", { event: "*", schema: "public", table: "deal_records" }, () => {
      scheduleOrgRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => {
      scheduleOrgRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "organizations" }, () => {
      scheduleOrgRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_roles" }, () => {
      scheduleOrgRefresh();
    })
    .subscribe();
}

export function invalidateOrgCache() {
  return refreshOrg();
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
    async (
      userId: string,
      patch: { role?: UserRole; location_id?: string | null; custom_role_id?: string | null; custom_role_name?: string | null },
    ) => {
      const error = await updateProfileAssignment(userId, patch);
      if (error) return error;
      applyPersonAssignment(userId, patch);
      await refreshOrg();
      return null;
    },
    [],
  );

  const assignPersonLocation = useCallback(async (userId: string, locationId: string | null) => {
    const error = await adminSetUserLocation(userId, locationId);
    if (error) return error;
    applyPersonAssignment(userId, { location_id: locationId });
    await refreshOrg();
    return null;
  }, []);

  const switchOwnLocation = useCallback(async (locationId: string) => {
    const error = await setMyLocation(locationId);
    if (error) return error;
    applyOwnActiveStore(locationId);
    await refreshOrg();
    return null;
  }, []);

  const addCustomRole = useCallback(async (name: string) => {
    const orgId = snapshot.organization?.id;
    if (!orgId) return "Re-run supabase/schema.sql in the SQL editor, then try again.";
    const result = await createCustomRole(orgId, name);
    if (result.error) return result.error;
    if (result.role) {
      snapshot = { ...snapshot, customRoles: [...snapshot.customRoles, result.role].sort((a, b) => a.name.localeCompare(b.name)) };
      emit();
    }
    await refreshOrg();
    return null;
  }, []);

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

  const updateOrganizationCode = useCallback(async (orgId: string, code: string) => {
    const error = await setOrganizationCode(orgId, code);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const savePayTiers = useCallback(async (tiers: CommissionTier[]) => {
    const orgId = snapshot.organization?.id;
    if (!orgId) return "Re-run supabase/schema.sql in the SQL editor, then try again.";
    const error = await adminUpdatePayTiers(orgId, tiers);
    if (error) return error;
    setRuntimePayTiers(tiers);
    snapshot = {
      ...snapshot,
      organization: snapshot.organization ? { ...snapshot.organization, pay_tiers: tiers } : snapshot.organization,
    };
    emit();
    await refreshOrg();
    return null;
  }, []);

  const pushToEmployee = useCallback(async (repId: string, payload?: EmployeePushPayload) => {
    const error = await pushDraftsToEmployee(repId, payload);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const recallPush = useCallback(async (repId: string) => {
    const error = await recallPendingPush(repId);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const resolveReview = useCallback(async (decisions: ReviewResolution[]) => {
    const error = await resolvePendingRepReview(decisions);
    if (!error) await invalidateOrgCache();
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

  const forwardSheet = useCallback(async (ids: string[]) => {
    const error = await forwardDealsToAdmin(ids);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const finalApproveSheet = useCallback(async (ids: string[]) => {
    const error = await finalApproveDeals(ids);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const returnSheetToManager = useCallback(async (ids: string[]) => {
    const error = await returnDealsToManager(ids);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const rejectDeal = useCallback(async (id: string, reason: string) => {
    const error = await rejectDealRecord(id, reason);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const rejectSheet = useCallback(async (ids: string[], reason: string) => {
    const error = await rejectDealRecords(ids, reason);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const authorizeRepReady = useCallback(async (repId: string) => {
    const error = await managerOverrideRepReady(repId);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const pushAllToAdmin = useCallback(async (locationId: string) => {
    const error = await managerPushAllToAdmin(locationId);
    if (!error) await refreshOrg();
    return error;
  }, []);

  return {
    addLocation,
    removeLocation,
    assignPerson,
    assignPersonLocation,
    switchOwnLocation,
    addCustomRole,
    deletePerson,
    updateOwnName,
    updateOwnProfileEmail,
    updateOrganizationCode,
    savePayTiers,
    pushToEmployee,
    recallPush,
    resolveReview,
    acceptAsIs,
    modifyAndSubmit,
    approveDeal,
    forwardSheet,
    finalApproveSheet,
    returnSheetToManager,
    rejectDeal,
    rejectSheet,
    authorizeRepReady,
    pushAllToAdmin,
  };
}

export function usePayTiers(): CommissionTier[] {
  const org = useOrg();
  const tiers = org.organization?.pay_tiers;
  return tiers && tiers.length > 0 ? tiers : COMMISSION_TIERS;
}

export function setLocationFilter(id: string | null) {
  if (snapshot.locationFilterId === id) return;
  snapshot = { ...snapshot, locationFilterId: id };
  emit();
}

export function applyPersonAssignment(
  userId: string,
  patch: { role?: UserRole; location_id?: string | null; custom_role_id?: string | null; custom_role_name?: string | null },
) {
  snapshot = {
    ...snapshot,
    people: snapshot.people.map((person) => (person.id === userId ? { ...person, ...patch } : person)),
    profile:
      snapshot.profile?.id === userId ? { ...snapshot.profile, ...patch } : snapshot.profile,
  };
  emit();
}

export function applyOwnActiveStore(locationId: string) {
  const profile = snapshot.profile;
  if (!profile) return;
  snapshot = {
    ...snapshot,
    locationFilterId: locationId,
    profile: { ...profile, location_id: locationId },
    people: snapshot.people.map((person) =>
      person.id === profile.id ? { ...person, location_id: locationId } : person,
    ),
  };
  emit();
}

export function applyPersonRole(userId: string, role: UserRole) {
  applyPersonAssignment(userId, { role });
}

export function dropPersonFromSnapshot(userId: string) {
  snapshot = {
    ...snapshot,
    people: snapshot.people.filter((person) => person.id !== userId),
    pending: snapshot.pending.filter((row) => row.rep_id !== userId && row.created_by !== userId),
    pendingAdmin: snapshot.pendingAdmin.filter((row) => row.rep_id !== userId && row.created_by !== userId),
    stagedForRep: snapshot.stagedForRep.filter((row) => row.rep_id !== userId),
    waitingOnRep: snapshot.waitingOnRep.filter((row) => row.rep_id !== userId),
    draftsForEntry: snapshot.draftsForEntry.filter((row) => row.rep_id !== userId && row.created_by !== userId),
    allDeals: snapshot.allDeals.filter((row) => row.rep_id !== userId && row.created_by !== userId),
  };
  emit();
}

export function peopleForView(org: OrgSnapshot): UserProfile[] {
  return filterPeopleForView(org.profile, org.people, org.locationFilterId);
}

export function dealsForView<T extends { rep_id: string; location_id: string | null }>(
  org: OrgSnapshot,
  rows: T[],
): T[] {
  return filterDealsForView(org.profile, rows, org.people, org.locationFilterId);
}

export { entryRepsFor };
