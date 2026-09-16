"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { initAuth, onAuthUserChange, getSessionUser } from "@/lib/auth-session";
import {
  acceptStagedAsIs,
  adminUpdatePayTiers,
  joinOrganizationByCode,
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
  loadPayTrackerStateRows,
  acceptPushNoChanges,
  submitRepDraftToManager,
  managerApproveToAdmin,
  managerDenyChanges,
  managerOverrideRepReady,
  managerPushAllToAdmin,
  pushDraftsToEmployee,
  recallPendingPush,
  rejectDealRecord,
  rejectDealRecords,
  resolvePendingRepReview,
  insertPendingManagerPayloads,
  flagPendingReviewDispute,
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
import {
  PAY_PLAN_PUSH_MESSAGE,
  PAY_PLAN_PUSH_TITLE,
  PAY_SHEET_LOCKED_MESSAGE,
  PAY_SHEET_PUSH_TITLE,
  notifyRepOnSheetPush,
  notifyRepsOnPayPush,
} from "@/lib/notifications";
import { isAwaitingRepReview, isPendingEmployeeReview, type ReviewResolution } from "@/lib/rep-review";
import { disputePushedSheetSubmit } from "@/lib/sheet-compare";
import { isStoredLocationFilter } from "@/lib/locations";
import { dealsForView as filterDealsForView, entryRepsFor, peopleForView as filterPeopleForView, visibleDeals, visiblePeople } from "@/lib/org-visibility";
import { onAuthCacheTransition } from "@/lib/auth-cache";
import { clearSessionPreferenceKeys } from "@/lib/storage";
import type { DealRow } from "@/lib/deal-records";
import { buildEmployeePushPayload, type EmployeePushPayload } from "@/lib/employee-push";
import { canManageOrg, profileMatchesSession, type CustomRole, type LocationRecord, type OrganizationRecord, type UserProfile, type UserRole } from "@/lib/roles";
import { COMMISSION_TIERS, setRuntimePayTiers } from "@/lib/commission";
import type { CommissionTier, TrackerState } from "@/lib/types";
import { chainFromPayTrackerRow, type ApprovalChainRecord } from "@/lib/approval-chain";
import { loadAdminEmployeeSheets, markAdminEmployeeSheetPaid, ADMIN_SHEET_PAID, type AdminEmployeeSheet } from "@/lib/admin-employee-sheets";
import { activePayPeriod, type PayPeriodIdentity } from "@/lib/pay-period";
import {
  emptyTrackerForPeriod,
  sheetMatchesRosterPeriod,
  adminPeriodRosterStatus,
} from "@/lib/admin-roster";

export type OrgSnapshot = {
  ready: boolean;
  isLoadingProfile: boolean;
  profile: UserProfile | null;
  locations: LocationRecord[];
  people: UserProfile[];
  pending: DealRow[];
  pendingAdmin: DealRow[];
  stagedForRep: DealRow[];
  waitingOnRep: DealRow[];
  draftsForEntry: DealRow[];
  allDeals: DealRow[];
  approvalChains: ApprovalChainRecord[];
  adminSheets: AdminEmployeeSheet[];
  locationFilterId: string | null;
  adminRosterPeriod: PayPeriodIdentity;
  organization: OrganizationRecord | null;
  customRoles: CustomRole[];
};

const empty: OrgSnapshot = {
  ready: false,
  isLoadingProfile: false,
  profile: null,
  locations: [],
  people: [],
  pending: [],
  pendingAdmin: [],
  stagedForRep: [],
  waitingOnRep: [],
  draftsForEntry: [],
  allDeals: [],
  approvalChains: [],
  adminSheets: [],
  locationFilterId: null,
  adminRosterPeriod: activePayPeriod(),
  organization: null,
  customRoles: [],
};

const listeners = new Set<() => void>();
let snapshot: OrgSnapshot = empty;
let started = false;
let orgLoadGen = 0;

function emit() {
  for (const listener of listeners) listener();
}

export function resetOrgForAuthEvent(event: "SIGNED_IN" | "SIGNED_OUT") {
  orgLoadGen += 1;
  clearCachedProfile();
  setRuntimePayTiers(null);
  clearSessionPreferenceKeys();
  snapshot =
    event === "SIGNED_OUT"
      ? { ...empty, ready: true, isLoadingProfile: false, profile: null }
      : { ...empty, ready: false, isLoadingProfile: true, profile: null };
  emit();
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
  const gen = ++orgLoadGen;
  const expectedUserId = getSessionUser()?.id ?? null;
  if (!isSupabaseConfigured()) {
    clearCachedProfile();
    setRuntimePayTiers(null);
    if (gen !== orgLoadGen) return;
    snapshot = { ...empty, ready: true, isLoadingProfile: false };
    emit();
    return;
  }
  await initAuth();
  if (gen !== orgLoadGen) return;
  const sessionUserId = getSessionUser()?.id ?? expectedUserId;
  const ensured = await ensureOwnProfile();
  if (gen !== orgLoadGen) return;
  if (ensured.status === "signed-out" || !sessionUserId) {
    clearCachedProfile();
    setRuntimePayTiers(null);
    snapshot = { ...empty, ready: true, isLoadingProfile: false, profile: null };
    emit();
    return;
  }
  if (ensured.status !== "ready" || ensured.profile.id !== sessionUserId) {
    console.error("Profile refresh failed:", ensured.status);
    snapshot = { ...empty, ready: true, isLoadingProfile: false, profile: null };
    emit();
    return;
  }
  const [locations, people, deals, organizations, customRoles, trackerRows] = await Promise.all([
    getAvailableOrgLocations(),
    listProfiles(),
    loadDealRows(),
    listOrganizations(),
    listCustomRoles(),
    loadPayTrackerStateRows(),
  ]);
  if (gen !== orgLoadGen) return;
  const listedSelf = people.find((person) => person.id === ensured.profile.id);
  const profile = listedSelf ?? ensured.profile;
  if (profile.id !== sessionUserId) {
    snapshot = { ...empty, ready: true, isLoadingProfile: false, profile: null };
    emit();
    return;
  }
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
  const adminSheets = canManageOrg(profile.role) ? await loadAdminEmployeeSheets() : [];
  if (gen !== orgLoadGen) return;
  snapshot = {
    ready: true,
    isLoadingProfile: false,
    profile,
    locations,
    people: visibleTeam,
    pending: latestPeriodRows(
      rows.filter(
        (row) =>
          row.status === "pending_manager_approval" ||
          row.status === "rep_modified" ||
          row.status === "rep_accepted_no_changes",
      ),
    ),
    pendingAdmin: canManageOrg(profile.role)
      ? latestPeriodRows(
          rows.filter((row) => row.status === "pending_admin_approval" || row.status === "manager_approved"),
        )
      : [],
    stagedForRep: latestPeriodRows(
      rows.filter((row) => isAwaitingRepReview(row.status) && row.rep_id === profile.id),
    ),
    waitingOnRep: latestPeriodRows(rows.filter((row) => isPendingEmployeeReview(row.status))),
    draftsForEntry: rows.filter((row) => row.status === "draft"),
    allDeals: rows,
    approvalChains: trackerRows.map(chainFromPayTrackerRow),
    adminSheets,
    locationFilterId,
    adminRosterPeriod: snapshot.adminRosterPeriod?.key ? snapshot.adminRosterPeriod : activePayPeriod(),
    organization,
    customRoles,
  };
  emit();
}

function boot() {
  if (started) return;
  started = true;
  onAuthCacheTransition((event) => {
    resetOrgForAuthEvent(event);
  });
  onAuthUserChange((user) => {
    const userId = user?.id ?? null;
    if (userId && !profileMatchesSession(snapshot.profile, userId)) {
      orgLoadGen += 1;
      clearCachedProfile();
      snapshot = { ...empty, ready: false, isLoadingProfile: true, profile: null };
      emit();
    }
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
      const previous = snapshot.people.find((person) => person.id === userId);
      applyPersonAssignment(userId, patch);
      const error = await updateProfileAssignment(userId, patch);
      if (error) {
        if (previous) {
          applyPersonAssignment(userId, {
            role: previous.role,
            location_id: previous.location_id,
            custom_role_id: previous.custom_role_id ?? null,
            custom_role_name: previous.custom_role_name ?? null,
          });
        }
        return error;
      }
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

  const joinDealership = useCallback(async (code: string, locationId: string) => {
    const result = await joinOrganizationByCode(code, locationId);
    if ("error" in result) return result;
    applyJoinedDealership({ org_id: result.orgId || null, location_id: result.locationId });
    await refreshOrg();
    if (!snapshot.profile?.location_id) {
      applyJoinedDealership({ org_id: result.orgId || null, location_id: result.locationId });
    }
    return result;
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
    const targetLocationId = snapshot.locationFilterId || snapshot.profile?.location_id || null;
    await notifyRepsOnPayPush({
      locationId: targetLocationId,
      title: PAY_PLAN_PUSH_TITLE,
      message: PAY_PLAN_PUSH_MESSAGE,
    });
    await refreshOrg();
    return null;
  }, []);

  const pushToEmployee = useCallback(async (repId: string, payload?: EmployeePushPayload) => {
    const error = await pushDraftsToEmployee(repId, payload);
    if (!error) {
      const targetLocationId =
        snapshot.people.find((person) => person.id === repId)?.location_id ||
        snapshot.profile?.location_id ||
        null;
      await notifyRepOnSheetPush({
        userId: repId,
        locationId: targetLocationId,
      });
      await refreshOrg();
    }
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

  const acceptPushedSheet = useCallback(async (monthId: string, sheetId: string) => {
    void monthId;
    void sheetId;
    const error = await acceptPushNoChanges();
    if (error) return error;
    const { dismissSheetPushNotifications } = await import("@/lib/notification-store");
    await dismissSheetPushNotifications();
    await invalidateOrgCache();
    return null;
  }, []);

  const submitChangesToManager = useCallback(async (state: TrackerState) => {
    const error = await submitRepDraftToManager(state);
    if (error) return error;
    const { dismissSheetPushNotifications } = await import("@/lib/notification-store");
    await dismissSheetPushNotifications();
    await invalidateOrgCache();
    return null;
  }, []);

  const approveAndPushToAdmin = useCallback(async (repId: string, displayedState?: TrackerState | null) => {
    const error = await managerApproveToAdmin(repId, displayedState);
    if (!error) await refreshOrg();
    return error;
  }, []);

  const denyChanges = useCallback(async (repId: string, reason: string) => {
    const error = await managerDenyChanges(repId, reason);
    if (!error) {
      const targetLocationId =
        snapshot.people.find((person) => person.id === repId)?.location_id ||
        snapshot.profile?.location_id ||
        null;
      await notifyRepOnSheetPush({
        userId: repId,
        locationId: targetLocationId,
        title: "Sheet changes rejected",
        message: reason.trim()
          ? `Your manager rejected the submitted changes: ${reason.trim()}`
          : "Your manager rejected the submitted changes. Fix the sheet and re-submit.",
      });
      await refreshOrg();
    }
    return error;
  }, []);

  const flagReviewDispute = useCallback(async (note: string, monthId: string, sheetId: string) => {
    const mine = snapshot.profile
      ? snapshot.allDeals.filter((row) => row.rep_id === snapshot.profile?.id)
      : [];
    const dispute = disputePushedSheetSubmit(mine, monthId, sheetId);
    const noteError = await flagPendingReviewDispute(note, dispute.ids);
    if (noteError) return noteError;
    const error = await resolvePendingRepReview(dispute.decisions);
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
    if (!error) {
      await notifyRepsOnPayPush({
        locationId: locationId || null,
        title: PAY_SHEET_PUSH_TITLE,
        message: PAY_SHEET_LOCKED_MESSAGE,
      });
      await refreshOrg();
    }
    return error;
  }, []);

  const markSheetPaid = useCallback(async (repId: string) => {
    const error = await markAdminEmployeeSheetPaid(repId);
    if (error) return error;
    patchAdminSheetPaid(repId);
    await refreshOrg();
    return null;
  }, []);

  const pushAllPaySheetsToEmployees = useCallback(
    async (input: { locationId: string; period: PayPeriodIdentity; employeeIds: string[] }) => {
      let pushed = 0;
      for (const employeeId of input.employeeIds) {
        const sheet = snapshot.adminSheets.find((row) => row.employeeId === employeeId) ?? null;
        if (!sheetMatchesRosterPeriod(sheet, input.period)) continue;
        const status = adminPeriodRosterStatus({
          sheet,
          chain: snapshot.approvalChains.find((row) => row.employeeId === employeeId) ?? null,
          period: input.period,
        });
        if (status === "paid" || status === "not_started") continue;
        const state =
          sheet?.state && (sheet.state.months?.length ?? 0) > 0
            ? sheet.state
            : emptyTrackerForPeriod(input.period);
        const payload = buildEmployeePushPayload(state);
        const error = await pushDraftsToEmployee(employeeId, payload);
        if (error) return { error, pushed };
        const targetLocationId =
          snapshot.people.find((person) => person.id === employeeId)?.location_id || input.locationId || null;
        await notifyRepOnSheetPush({
          userId: employeeId,
          locationId: targetLocationId,
        });
        pushed += 1;
      }
      await refreshOrg();
      return { error: null as string | null, pushed };
    },
    [],
  );

  return {
    addLocation,
    removeLocation,
    assignPerson,
    assignPersonLocation,
    switchOwnLocation,
    joinDealership,
    addCustomRole,
    deletePerson,
    updateOwnName,
    updateOwnProfileEmail,
    updateOrganizationCode,
    savePayTiers,
    pushToEmployee,
    recallPush,
    resolveReview,
    acceptPushedSheet,
    submitChangesToManager,
    approveAndPushToAdmin,
    denyChanges,
    flagReviewDispute,
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
    markSheetPaid,
    pushAllPaySheetsToEmployees,
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

export function setAdminRosterPeriod(period: PayPeriodIdentity) {
  if (
    snapshot.adminRosterPeriod?.key === period.key &&
    snapshot.adminRosterPeriod?.split === period.split &&
    snapshot.adminRosterPeriod?.year === period.year &&
    snapshot.adminRosterPeriod?.month === period.month
  ) {
    return;
  }
  snapshot = { ...snapshot, adminRosterPeriod: period };
  emit();
}

export function getAdminRosterPeriod(): PayPeriodIdentity {
  return snapshot.adminRosterPeriod ?? activePayPeriod();
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

export function applyJoinedDealership(patch: { org_id: string | null; location_id: string }) {
  const profile = snapshot.profile;
  if (!profile) return;
  snapshot = {
    ...snapshot,
    locationFilterId: patch.location_id,
    profile: {
      ...profile,
      org_id: patch.org_id || profile.org_id,
      location_id: patch.location_id,
    },
    people: snapshot.people.map((person) =>
      person.id === profile.id
        ? { ...person, org_id: patch.org_id || person.org_id, location_id: patch.location_id }
        : person,
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
    approvalChains: snapshot.approvalChains.filter((row) => row.employeeId !== userId),
    adminSheets: snapshot.adminSheets.filter((row) => row.employeeId !== userId),
  };
  emit();
}

/** Immediately reflect a successful Mark Paid in the roster without waiting on refresh. */
export function patchAdminSheetPaid(employeeId: string, paidAt = new Date().toISOString()) {
  const existing = snapshot.adminSheets.find((row) => row.employeeId === employeeId);
  const next: AdminEmployeeSheet = existing
    ? {
        ...existing,
        status: ADMIN_SHEET_PAID,
        isPaid: true,
        paidAt: existing.paidAt ?? paidAt,
        updatedAt: paidAt,
      }
    : {
        employeeId,
        orgId: snapshot.profile?.org_id ?? null,
        locationId: snapshot.people.find((person) => person.id === employeeId)?.location_id ?? null,
        monthId: null,
        sheetData: {},
        status: ADMIN_SHEET_PAID,
        createdBy: snapshot.profile?.id ?? null,
        createdAt: paidAt,
        updatedAt: paidAt,
        paidAt,
        isPaid: true,
        state: null,
      };
  snapshot = {
    ...snapshot,
    adminSheets: existing
      ? snapshot.adminSheets.map((row) => (row.employeeId === employeeId ? next : row))
      : [next, ...snapshot.adminSheets],
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
