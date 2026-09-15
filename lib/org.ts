import { getSupabase } from "./supabase.ts";
import {
  CUSTOM_ROLES_TABLE,
  DEAL_RECORD_SELECT,
  DEAL_RECORD_SELECT_MIN,
  DEAL_RECORD_SELECT_WITH_PROPOSED,
  DEAL_RECORDS_TABLE,
  LOCATION_SELECT,
  LOCATION_SELECT_MIN,
  LOCATIONS_TABLE,
  ORGANIZATION_SELECT,
  ORGANIZATION_SELECT_MIN,
  ORGANIZATIONS_TABLE,
  USER_PROFILE_SELECT,
  USER_PROFILE_SELECT_MIN,
  USER_PROFILE_SELECT_ORG,
  USER_PROFILE_SELECT_READY,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import { isPipelineRecordStatus, isProtectedAdminEmail, resolvedProfileRole, signupRole, type CustomRole, type LocationRecord, type OrganizationRecord, type UserProfile, type UserRole } from "./roles.ts";
import { isMissingAuthSession, refreshAuthSession, getSessionUser } from "./auth-session.ts";
import { metadataFullName } from "./names.ts";
import { DEALERSHIP_TAKEN_MESSAGE, generateDealershipJoinCode, metadataLocationId, metadataSignupMode, normalizeOrgCode, parseJoinOrganizationResult, parseOrgCodeLookup, type OrgCodeLookup } from "./signup.ts";
import { normalizePayTiers, serializePayTiers } from "./commission.ts";
import type { CommissionTier } from "./types.ts";
import { isPayload, payloadKey, rowKey, type DealPayload, type DealRow } from "./deal-records.ts";
import {
  rowSubmissionMatchKey,
  rowUpdatedAt,
  submissionMatchKey,
  supersededPipelineIds,
} from "./latest-submission.ts";
import type { ReviewResolution } from "./rep-review.ts";
import { buildEmployeePushPayload, type EmployeePushPayload } from "./employee-push.ts";

let cachedProfile: UserProfile | null = null;

export function getCachedProfile(): UserProfile | null {
  return cachedProfile;
}

export function clearCachedProfile() {
  cachedProfile = null;
}

export function usableCachedProfile(
  cached: UserProfile | null,
  userId: string | null | undefined,
): UserProfile | null {
  if (!cached || !userId || cached.id !== userId) return null;
  return cached;
}

function cachedForCurrentUser(): UserProfile | null {
  return usableCachedProfile(cachedProfile, getSessionUser()?.id);
}

export function isMissingTable(message: string, code?: string): boolean {
  return (
    code === "PGRST205" ||
    message.includes("Could not find the table") ||
    (message.includes("schema cache") && message.toLowerCase().includes("table"))
  );
}

export function isMissingFunction(message: string, code?: string): boolean {
  const text = message.toLowerCase();
  return (
    code === "PGRST202" ||
    code === "PGRST404" ||
    text.includes("could not find the function") ||
    message.includes("lookup_stores_by_org_code") ||
    message.includes("join_organization_by_code") ||
    (text.includes("404") && text.includes("rpc"))
  );
}

export function isMissingRelation(message: string, code?: string): boolean {
  return (
    isMissingTable(message, code) ||
    isMissingFunction(message, code) ||
    message.includes("ensure_own_profile") ||
    message.includes("update_user_role") ||
    message.includes("admin_set_user_role") ||
    message.includes("admin_set_user_assignment") ||
    message.includes("admin_set_user_location") ||
    message.includes("get_available_org_locations") ||
    message.includes("set_my_location") ||
    message.includes("custom_roles") ||
    message.includes("update_own_full_name") ||
    message.includes("update_own_location_id") ||
    message.includes("update_own_email") ||
    message.includes("delete_user_by_admin") ||
    message.includes("resolve_pending_rep_review") ||
    message.includes("submit_rep_review_to_manager") ||
    message.includes("rep_submit_to_manager") ||
    message.includes("forward_deals_to_admin") ||
    message.includes("final_approve_deals") ||
    message.includes("return_deals_to_manager") ||
    message.includes("manager_override_rep_ready") ||
    message.includes("manager_push_all_to_admin") ||
    message.includes("push_drafts_to_employee") ||
    message.includes("recall_pending_push") ||
    message.includes("lookup_stores_by_org_code") ||
    message.includes("join_organization_by_code") ||
    message.includes("set_organization_code") ||
    message.includes("register_new_dealership_admin") ||
    message.includes("admin_update_pay_tiers") ||
    message.includes("notify_reps_on_pay_push") ||
    message.includes("mark_notification_read") ||
    message.includes("user_notifications")
  );
}

export function isMissingColumn(message: string, code?: string): boolean {
  const text = message.toLowerCase();
  return (
    code === "PGRST204" ||
    /could not find the '.+' column/i.test(message) ||
    (text.includes("column") && text.includes("does not exist")) ||
    (text.includes("schema cache") && text.includes("column"))
  );
}

const SCHEMA_RERUN = "Re-run supabase/schema.sql in the SQL editor, then try again.";

export function isPermissionError(message: string, code?: string): boolean {
  const text = message.toLowerCase();
  return (
    code === "42501" ||
    code === "PGRST301" ||
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("jwt")
  );
}

function asProfile(row: Record<string, unknown> | null | undefined, customRoles: CustomRole[] = []): UserProfile | null {
  if (!row || typeof row.id !== "string") return null;
  const email = typeof row.email === "string" ? row.email : "";
  const role = resolvedProfileRole(email, typeof row.role === "string" ? row.role : null);
  const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
  const customRoleId = typeof row.custom_role_id === "string" ? row.custom_role_id : null;
  const customRoleName = customRoleId
    ? customRoles.find((item) => item.id === customRoleId)?.name ?? null
    : null;
  return {
    id: row.id,
    email,
    full_name: fullName || null,
    role,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    roster_ready: row.roster_ready === true,
    org_id: typeof row.org_id === "string" ? row.org_id : null,
    custom_role_id: customRoleId,
    custom_role_name: customRoleName,
  };
}

function remember(profile: UserProfile): { status: "ready"; profile: UserProfile } {
  const userId = getSessionUser()?.id;
  if (!userId || profile.id === userId) cachedProfile = profile;
  return { status: "ready", profile };
}

async function insertOwnProfile(
  role: UserRole,
  selectedLocationId?: string | null,
): Promise<{ status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  await refreshAuthSession();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user?.id) return { status: "signed-out" };
  const email = user.email ?? "";
  const fullName = metadataFullName(user.user_metadata) ?? email;
  const locationId = selectedLocationId?.trim() || metadataLocationId(user.user_metadata);
  const signupMode = metadataSignupMode(user.user_metadata);
  const assignedRole =
    isProtectedAdminEmail(email) || signupMode === "new_dealership" ? "admin" : "rep";
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .insert({
      id: user.id,
      email,
      full_name: fullName,
      role: assignedRole,
      location_id: locationId,
    })
    .select("id,email,full_name,role,location_id")
    .single();
  if (!error) {
    const profile = asProfile(data as Record<string, unknown>);
    if (profile) return remember(profile);
  }
  if (error && isMissingRelation(error.message, error.code)) {
    console.error("user_profiles insert failed:", error.message);
    const cached = cachedForCurrentUser();
    if (cached) return remember(cached);
    return { status: "setup" };
  }
  if (error && isPermissionError(error.message, error.code)) {
    console.error("user_profiles insert blocked:", error.message);
    const cached = cachedForCurrentUser();
    if (cached) return remember(cached);
  }
  if (error?.code === "23505") {
    const again = await supabase
      .from(USER_PROFILES_TABLE)
      .select("id,email,full_name,role,location_id")
      .eq("id", user.id)
      .maybeSingle();
    const profile = asProfile(again.data as Record<string, unknown> | null);
    if (profile) return remember(profile);
    if (role === "admin") return insertOwnProfile("rep", locationId);
  }
  if (error) console.error("user_profiles insert failed:", error.message);
  const cached = cachedForCurrentUser();
  if (cached) return remember(cached);
  return { status: "offline" };
}

async function createOwnProfileIfNeeded(
  selectedLocationId?: string | null,
): Promise<{ status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  await refreshAuthSession();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user?.id) return { status: "signed-out" };

  const existing = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id,email,full_name,role,location_id")
    .eq("id", user.id)
    .maybeSingle();
  if (existing.error && isMissingRelation(existing.error.message, existing.error.code)) {
    return { status: "setup" };
  }
  const already = asProfile(existing.data as Record<string, unknown> | null);
  if (already) return remember(already);

  const locationId = selectedLocationId?.trim() || metadataLocationId(user.user_metadata);
  const signupMode = metadataSignupMode(user.user_metadata);
  const role = signupMode === "new_dealership" ? "admin" : signupRole();
  return insertOwnProfile(role, locationId);
}

export async function ensureOwnProfile(selectedLocationId?: string | null): Promise<
  { status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  await refreshAuthSession();
  const userId = getSessionUser()?.id ?? null;
  if (!userId) {
    clearCachedProfile();
    return { status: "signed-out" };
  }
  if (cachedProfile && cachedProfile.id !== userId) clearCachedProfile();
  const rpcArgs = selectedLocationId?.trim() ? { selected_location_id: selectedLocationId.trim() } : undefined;
  const rpc = await Promise.race([
    rpcArgs ? supabase.rpc("ensure_own_profile", rpcArgs) : supabase.rpc("ensure_own_profile"),
    new Promise<{ data: null; error: { message: string; code: string } }>((resolve) => {
      setTimeout(
        () => resolve({ data: null, error: { message: "ensure_own_profile timed out", code: "TIMEOUT" } }),
        4000,
      );
    }),
  ]);
  const { data, error } = rpc;
  if (!error) {
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = asProfile(raw as Record<string, unknown>);
    if (profile && profile.id === userId) return remember(profile);
  } else if (error) {
    const unsigned =
      isMissingAuthSession(error) || error.message.toLowerCase().includes("not signed in");
    if (!unsigned) console.error("ensure_own_profile failed:", error.message);
    const cached = cachedForCurrentUser();
    if (cached) return remember(cached);
  }
  return createOwnProfileIfNeeded(selectedLocationId);
}

function asLocationRows(data: unknown): LocationRecord[] {
  if (!Array.isArray(data)) return [];
  const rows: LocationRecord[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    const location: LocationRecord = { id: record.id, name: record.name };
    if (typeof record.created_at === "string") location.created_at = record.created_at;
    if (typeof record.org_id === "string") location.org_id = record.org_id;
    rows.push(location);
  }
  return rows;
}

export async function getAvailableOrgLocations(): Promise<LocationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const rpc = await supabase.rpc("get_available_org_locations");
  if (!rpc.error) return asLocationRows(rpc.data);
  if (!isMissingRelation(rpc.error.message, rpc.error.code)) {
    console.error("get_available_org_locations:", rpc.error.message);
  }
  for (const columns of [LOCATION_SELECT, LOCATION_SELECT_MIN]) {
    const { data, error } = await supabase.from(LOCATIONS_TABLE).select(columns).order("name");
    if (!error) return asLocationRows(data);
    if (error && !isMissingColumn(error.message, error.code)) {
      console.error("locations select failed:", error.message);
      return [];
    }
  }
  return [];
}

export async function listLocations(): Promise<LocationRecord[]> {
  return getAvailableOrgLocations();
}

export async function listSignupLocations(): Promise<LocationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const rpc = await supabase.rpc("list_signup_locations");
  if (!rpc.error) return asLocationRows(rpc.data);
  console.error("list_signup_locations:", rpc.error.message);
  const { data, error } = await supabase.from(LOCATIONS_TABLE).select(LOCATION_SELECT).order("name");
  if (error) {
    console.error("locations select failed:", error.message);
    return [];
  }
  return asLocationRows(data);
}

function asOrganization(row: Record<string, unknown> | null | undefined): OrganizationRecord | null {
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  const joinCode = typeof row.join_code === "string" ? row.join_code.trim().toUpperCase() : "";
  if (!joinCode) return null;
  return {
    id: row.id,
    name: row.name,
    join_code: joinCode,
    pay_tiers: normalizePayTiers(row.pay_tiers),
  };
}

export async function listOrganizations(): Promise<OrganizationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  for (const columns of [ORGANIZATION_SELECT, ORGANIZATION_SELECT_MIN]) {
    const { data, error } = await supabase.from(ORGANIZATIONS_TABLE).select(columns).order("created_at");
    if (!error) {
      const rows: OrganizationRecord[] = [];
      if (!Array.isArray(data)) return rows;
      for (const item of data) {
        const org = asOrganization(item as unknown as Record<string, unknown>);
        if (org) rows.push(org);
      }
      return rows;
    }
    if (error && !isMissingColumn(error.message, error.code)) {
      console.error("organizations select failed:", error.message);
      return [];
    }
  }
  return [];
}

export async function lookupStoresByOrgCode(inputCode: string): Promise<OrgCodeLookup | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("lookup_stores_by_org_code", {
    input_code: normalizeOrgCode(inputCode),
  });
  if (error) {
    console.error("lookup_stores_by_org_code failed:", error.message);
    return null;
  }
  return parseOrgCodeLookup(data);
}

export async function joinOrganizationByCode(
  code: string,
  selectedStoreId: string,
): Promise<{ orgName: string; orgId: string; locationId: string } | { error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Not signed in." };
  const { data, error } = await supabase.rpc("join_organization_by_code", {
    input_code: code.trim().toUpperCase(),
    target_location_id: selectedStoreId,
  });
  if (error) {
    if (isMissingRelation(error.message, error.code)) return { error: SCHEMA_RERUN };
    return { error: error.message };
  }
  const parsed = parseJoinOrganizationResult(data);
  const locationId = parsed?.location_id || selectedStoreId.trim();
  const orgId = parsed?.org_id ?? "";
  if (!parsed || !locationId) return { error: "Could not join that dealership group." };
  if (cachedProfile) {
    cachedProfile = {
      ...cachedProfile,
      org_id: orgId || cachedProfile.org_id,
      location_id: locationId,
    };
  }
  return { orgName: parsed.org_name, orgId: orgId || cachedProfile?.org_id || "", locationId };
}

export async function setOrganizationCode(targetOrgId: string, newCode: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("set_organization_code", {
    target_org_id: targetOrgId,
    new_code: newCode.trim().toUpperCase(),
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) return SCHEMA_RERUN;
  return error.message;
}

export type DealershipRegisterResult = { error: string | null; field?: "org_name" };

export async function registerNewDealershipAdmin(input: {
  orgName: string;
  adminFullName: string;
}): Promise<DealershipRegisterResult> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Not signed in." };
  const payload = {
    org_name: input.orgName.trim(),
    admin_full_name: input.adminFullName.trim(),
  };
  const { data, error } = await supabase.rpc("register_new_dealership_admin", payload);
  if (error && isMissingFunction(error.message, error.code)) {
    const fallback = await supabase.rpc("register_new_dealership_admin", {
      ...payload,
      org_code: generateDealershipJoinCode(),
    });
    if (!fallback.error) {
      const raw = Array.isArray(fallback.data) ? fallback.data[0] : fallback.data;
      const profile = asProfile(raw as Record<string, unknown>);
      if (profile) remember(profile);
      return { error: null };
    }
    if (isMissingRelation(fallback.error.message, fallback.error.code)) return { error: SCHEMA_RERUN };
    const taken =
      fallback.error.message.toLowerCase().includes("already registered") ||
      fallback.error.message.toLowerCase().includes("already in use");
    if (taken) return { error: DEALERSHIP_TAKEN_MESSAGE, field: "org_name" };
    return { error: fallback.error.message };
  }
  if (!error) {
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = asProfile(raw as Record<string, unknown>);
    if (profile) remember(profile);
    return { error: null };
  }
  if (isMissingRelation(error.message, error.code)) return { error: SCHEMA_RERUN };
  const taken =
    error.message.toLowerCase().includes("already registered") ||
    error.message.toLowerCase().includes("already in use");
  if (taken) return { error: DEALERSHIP_TAKEN_MESSAGE, field: "org_name" };
  return { error: error.message };
}

export async function adminUpdatePayTiers(targetOrgId: string, tiers: CommissionTier[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("admin_update_pay_tiers", {
    target_org_id: targetOrgId,
    new_tiers: serializePayTiers(tiers),
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) return SCHEMA_RERUN;
  return error.message;
}

export async function listCustomRoles(): Promise<CustomRole[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .select("id,org_id,name")
    .order("name");
  if (error) {
    if (!isMissingRelation(error.message, error.code) && !isMissingTable(error.message, error.code)) {
      console.error("custom_roles select failed:", error.message);
    }
    return [];
  }
  if (!Array.isArray(data)) return [];
  const rows: CustomRole[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.org_id !== "string" || typeof record.name !== "string") continue;
    rows.push({ id: record.id, org_id: record.org_id, name: record.name.trim() });
  }
  return rows;
}

export async function createCustomRole(orgId: string, name: string): Promise<{ role?: CustomRole; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Not signed in." };
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length < 2) return { error: "Enter a role name." };
  if (!orgId) return { error: SCHEMA_RERUN };
  const { data, error } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .insert({ org_id: orgId, name: cleaned })
    .select("id,org_id,name")
    .single();
  if (error) {
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return { error: SCHEMA_RERUN };
    }
    if (error.code === "23505" || error.message.toLowerCase().includes("duplicate")) {
      return { error: "That role already exists." };
    }
    return { error: error.message };
  }
  if (!data || typeof data !== "object") return { error: "Could not add that role." };
  const record = data as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.org_id !== "string" || typeof record.name !== "string") {
    return { error: "Could not add that role." };
  }
  return { role: { id: record.id, org_id: record.org_id, name: record.name }, error: null };
}

export async function listProfiles(): Promise<UserProfile[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const customRoles = await listCustomRoles();
  const selects: string[] = [USER_PROFILE_SELECT, USER_PROFILE_SELECT_ORG, USER_PROFILE_SELECT_READY, USER_PROFILE_SELECT_MIN];
  for (const columns of selects) {
    const { data, error } = await supabase
      .from(USER_PROFILES_TABLE)
      .select(columns)
      .order("full_name")
      .order("email");
    if (!error && data) {
      return data
        .map((row) => asProfile(row as unknown as Record<string, unknown>, customRoles))
        .filter((row): row is UserProfile => row !== null);
    }
    if (error && !isMissingColumn(error.message, error.code)) {
      console.error("user_profiles select failed:", error.message);
      return [];
    }
  }
  return [];
}

export async function createLocation(name: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const orgId = cachedProfile?.org_id ?? null;
  const { error } = await supabase.from(LOCATIONS_TABLE).insert(orgId ? { name: trimmed, org_id: orgId } : { name: trimmed });
  return error ? error.message : null;
}

export async function deleteLocation(id: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.from(LOCATIONS_TABLE).delete().eq("id", id);
  return error ? error.message : null;
}

export async function deleteUserByAdmin(targetUserId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (!targetUserId) return "User not found.";
  const { error } = await supabase.rpc("delete_user_by_admin", {
    target_user_id: targetUserId,
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    return "Run supabase/schema.sql in the SQL editor so account deletion is available.";
  }
  return error.message;
}

export async function updateProfileAssignment(
  userId: string,
  patch: { role?: UserRole; location_id?: string | null; full_name?: string | null; custom_role_id?: string | null },
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  let nextRole = patch.role;
  let nextLocationId = patch.location_id;
  if (nextRole === undefined || nextLocationId === undefined) {
    const people = await listProfiles();
    const current = people.find((person) => person.id === userId);
    if (!current) return "User not found.";
    nextRole = nextRole ?? current.role;
    nextLocationId = nextLocationId !== undefined ? nextLocationId : current.location_id;
  }
  if (!nextRole) return "User not found.";
  const { error } = await supabase.rpc("admin_set_user_assignment", {
    target_user_id: userId,
    new_role: nextRole,
    target_location_id: nextLocationId,
  });
  if (error) {
    if (isMissingRelation(error.message, error.code)) {
      const roleResult = await supabase.rpc("admin_set_user_role", {
        target_user_id: userId,
        new_role: nextRole,
      });
      if (roleResult.error) {
        if (isMissingRelation(roleResult.error.message, roleResult.error.code)) {
          const fallback = await supabase.rpc("update_user_role", {
            target_user_id: userId,
            new_role: nextRole,
          });
          if (fallback.error) return fallback.error.message;
        } else {
          return roleResult.error.message;
        }
      }
      const { error: locError } = await supabase
        .from(USER_PROFILES_TABLE)
        .update({ location_id: nextLocationId })
        .eq("id", userId);
      if (locError) return locError.message;
    } else {
      return error.message;
    }
  }
  if (patch.custom_role_id !== undefined) {
    const { error: customError } = await supabase
      .from(USER_PROFILES_TABLE)
      .update({ custom_role_id: patch.custom_role_id })
      .eq("id", userId);
    if (customError && !isMissingColumn(customError.message, customError.code)) {
      return customError.message;
    }
  }
  if (patch.full_name === undefined) return null;
  const { error: nameError } = await supabase
    .from(USER_PROFILES_TABLE)
    .update({ full_name: patch.full_name })
    .eq("id", userId);
  return nameError ? nameError.message : null;
}

function rememberReturnedProfile(data: unknown) {
  const raw = Array.isArray(data) ? data[0] : data;
  const profile = asProfile(raw as Record<string, unknown>);
  if (profile) remember(profile);
}

export async function setMyLocation(newLocationId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = newLocationId.trim();
  if (!cleaned) return "Select a dealership store.";
  const { data, error } = await supabase.rpc("set_my_location", { new_location_id: cleaned });
  if (!error) {
    rememberReturnedProfile(data);
    return null;
  }
  if (isMissingRelation(error.message, error.code)) {
    return updateOwnLocationId(cleaned);
  }
  return error.message;
}

export async function adminSetUserLocation(
  targetUserId: string,
  targetLocationId: string | null,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (!targetUserId) return "User not found.";
  const { error } = await supabase.rpc("admin_set_user_location", {
    target_user_id: targetUserId,
    target_location_id: targetLocationId,
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    return updateProfileAssignment(targetUserId, { location_id: targetLocationId });
  }
  return error.message;
}

export async function updateOwnLocationId(locationId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = locationId.trim();
  if (!cleaned) return "Select a dealership store.";
  const { data, error } = await supabase.rpc("update_own_location_id", { p_location_id: cleaned });
  if (!error) {
    rememberReturnedProfile(data);
    return null;
  }
  if (isMissingRelation(error.message, error.code)) {
    const { error: updateError } = await supabase
      .from(USER_PROFILES_TABLE)
      .update({ location_id: cleaned })
      .eq("id", (await supabase.auth.getSession()).data.session?.user.id ?? "");
    return updateError ? updateError.message : null;
  }
  return error.message;
}

export async function updateOwnEmail(email: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return "Enter a valid email address.";
  const { data, error } = await supabase.rpc("update_own_email", { new_email: cleaned });
  if (!error) {
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = asProfile(raw as Record<string, unknown>);
    if (profile) remember(profile);
    return null;
  }
  if (isMissingRelation(error.message, error.code)) {
    const { error: updateError } = await supabase
      .from(USER_PROFILES_TABLE)
      .update({ email: cleaned })
      .eq("id", (await supabase.auth.getSession()).data.session?.user.id ?? "");
    return updateError ? updateError.message : null;
  }
  return error.message;
}

export async function updateOwnFullName(fullName: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = fullName.trim();
  if (!cleaned) return "Enter your full name.";
  const { data, error } = await supabase.rpc("update_own_full_name", { new_name: cleaned });
  if (!error) {
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = asProfile(raw as Record<string, unknown>);
    if (profile) remember(profile);
    return null;
  }
  if (isMissingRelation(error.message, error.code)) {
    const { error: updateError } = await supabase
      .from(USER_PROFILES_TABLE)
      .update({ full_name: cleaned })
      .eq("id", (await supabase.auth.getSession()).data.session?.user.id ?? "");
    return updateError ? updateError.message : null;
  }
  return error.message;
}

export async function loadDealRows(): Promise<
  { status: "ready"; rows: DealRow[] } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  await refreshAuthSession();
  const selects: string[] = [DEAL_RECORD_SELECT, DEAL_RECORD_SELECT_WITH_PROPOSED, DEAL_RECORD_SELECT_MIN];
  let lastError: { message: string; code?: string } | null = null;
  for (const columns of selects) {
    const { data, error } = await supabase.from(DEAL_RECORDS_TABLE).select(columns);
    if (!error) return { status: "ready", rows: (data ?? []) as unknown as DealRow[] };
    lastError = error;
    if (isMissingColumn(error.message, error.code)) continue;
    break;
  }
  if (lastError) console.error("deal_records select failed:", lastError.message, lastError.code ?? "");
  return { status: "offline" };
}

function mapByKey(rows: DealRow[]): Map<string, DealRow> {
  const map = new Map<string, DealRow>();
  for (const row of rows) {
    const key = rowKey(row);
    if (key) map.set(key, row);
  }
  return map;
}

function matchKeyForRow(row: DealRow): string | null {
  return rowSubmissionMatchKey(row) ?? rowKey(row);
}

function pipelineRank(row: DealRow): number {
  if (row.status === "draft") return 2;
  if (isPipelineRecordStatus(row.status)) return 1;
  return 0;
}

function mapByMatchKey(rows: DealRow[]): Map<string, DealRow> {
  const map = new Map<string, DealRow>();
  for (const row of rows) {
    const key = matchKeyForRow(row);
    if (!key) continue;
    const current = map.get(key);
    if (!current) {
      map.set(key, row);
      continue;
    }
    const rank = pipelineRank(row);
    const currentRank = pipelineRank(current);
    if (rank > currentRank || (rank === currentRank && rowUpdatedAt(row) >= rowUpdatedAt(current))) {
      map.set(key, row);
    }
  }
  return map;
}

const SUPERSEDED_REASON = "Superseded by a newer submission";

function submittedKeepIds(decisions: ReviewResolution[]): string[] {
  return decisions
    .filter((decision) => decision.action !== "decline")
    .map((decision) => (decision.live_id && decision.live_id !== decision.id ? decision.live_id : decision.id));
}

export async function syncLivePayloads(input: {
  repId: string;
  locationId: string | null;
  createdBy: string;
  payloads: DealPayload[];
  existing: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const existingByKey = mapByKey(input.existing);
  const nextKeys = new Set(input.payloads.map((payload) => `${payload.kind}:${payload.entityId}`));
  for (const payload of input.payloads) {
    const current = existingByKey.get(`${payload.kind}:${payload.entityId}`);
    if (current && isPipelineRecordStatus(current.status)) {
      continue;
    }
    if (current) {
      const { error } = await supabase
        .from(DEAL_RECORDS_TABLE)
        .update({
          live_data: payload,
          status: "approved",
          location_id: input.locationId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);
      if (error) return error.message;
    } else {
      const { error } = await supabase.from(DEAL_RECORDS_TABLE).insert({
        rep_id: input.repId,
        location_id: input.locationId,
        created_by: input.createdBy,
        status: "approved",
        staged_data: {},
        live_data: payload,
      });
      if (error) return error.message;
    }
  }
  for (const row of input.existing) {
    const key = rowKey(row);
    if (!key || row.rep_id !== input.repId) continue;
    if (row.status !== "approved" && row.status !== "active") continue;
    if (nextKeys.has(key)) continue;
    const { error } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", row.id);
    if (error) return error.message;
  }
  return null;
}

export async function syncDraftPayloads(input: {
  repId: string;
  locationId: string | null;
  createdBy: string;
  payloads: DealPayload[];
  existing: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const mine = input.existing.filter((row) => row.rep_id === input.repId);
  const existingByMatch = mapByMatchKey(mine);
  const nextKeys = new Set(input.payloads.map((payload) => submissionMatchKey(payload) ?? payloadKey(payload)));
  for (const payload of input.payloads) {
    const match = submissionMatchKey(payload) ?? payloadKey(payload);
    const current = existingByMatch.get(match);
    if (current && isPipelineRecordStatus(current.status) && current.status !== "draft") {
      const { error } = await supabase.from(DEAL_RECORDS_TABLE).insert({
        rep_id: input.repId,
        location_id: input.locationId,
        created_by: input.createdBy,
        status: "draft",
        staged_data: payload,
        live_data: {},
      });
      if (error) return error.message;
      continue;
    }
    if (current) {
      const { error } = await supabase
        .from(DEAL_RECORDS_TABLE)
        .update({
          staged_data: payload,
          status: "draft",
          location_id: input.locationId,
          created_by: input.createdBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);
      if (error) return error.message;
    } else {
      const { error } = await supabase.from(DEAL_RECORDS_TABLE).insert({
        rep_id: input.repId,
        location_id: input.locationId,
        created_by: input.createdBy,
        status: "draft",
        staged_data: payload,
        live_data: {},
      });
      if (error) return error.message;
    }
  }
  for (const row of mine) {
    if (row.status !== "draft") continue;
    const key = matchKeyForRow(row);
    if (!key || nextKeys.has(key)) continue;
    if (isPayload(row.live_data)) {
      const { error } = await supabase
        .from(DEAL_RECORDS_TABLE)
        .update({
          staged_data: {},
          status: "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) return error.message;
    } else {
      const { error } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", row.id);
      if (error) return error.message;
    }
  }
  return null;
}

export async function syncStagedEdits(input: {
  repId: string;
  payloads: DealPayload[];
  existing: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const existingByMatch = mapByMatchKey(
    input.existing.filter((row) => row.status === "staged" || row.status === "pending_rep_review"),
  );
  for (const payload of input.payloads) {
    const current = existingByMatch.get(submissionMatchKey(payload) ?? payloadKey(payload));
    if (!current) continue;
    const { error } = await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({ staged_data: payload, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) return error.message;
  }
  return null;
}

async function rpcError(name: string, args?: Record<string, unknown>): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = args ? await supabase.rpc(name, args) : await supabase.rpc(name);
  if (!error) return null;
  console.error(`${name} failed:`, error.message);
  return error.message;
}

function dealRowsUnavailable(loaded: Awaited<ReturnType<typeof loadDealRows>>): string {
  if (loaded.status === "signed-out") return "Not signed in.";
  return "Cloud save is retrying. Try again in a moment.";
}

async function loadRepDealRows(repId: string): Promise<{ rows: DealRow[]; error: string | null }> {
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return { rows: [], error: dealRowsUnavailable(loaded) };
  return { rows: loaded.rows.filter((row) => row.rep_id === repId), error: null };
}

async function archiveDealIds(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const now = new Date().toISOString();
  const empty = {};
  for (const id of ids) {
    const { error: deleteError } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", id);
    if (!deleteError) continue;
    const archiveError = await updateDealRow(id, {
      status: "rejected",
      reject_reason: SUPERSEDED_REASON,
      staged_data: empty,
      proposed_data: empty,
      previous_data: empty,
      updated_at: now,
    });
    if (archiveError) return isMissingEnumValue(archiveError) ? SCHEMA_RERUN : archiveError;
  }
  return null;
}

export async function archiveSupersededForRep(repId: string, keepIds: string[]): Promise<string | null> {
  if (keepIds.length === 0) return null;
  const loaded = await loadRepDealRows(repId);
  if (loaded.error) return loaded.error;
  return archiveDealIds(supersededPipelineIds(loaded.rows, keepIds));
}

async function promoteDraftsToEmployeeReview(ids: string[]): Promise<string | null> {
  const now = new Date().toISOString();
  for (const id of ids) {
    const loaded = await loadDealRow(id);
    if (loaded.error) return loaded.error;
    const rec = loaded.row;
    if (!rec) continue;
    const error = await updateDealRow(id, {
      status: "pending_rep_review",
      proposed_data: isPayload(rec.staged_data) ? rec.staged_data : rec.proposed_data ?? {},
      reject_reason: null,
      updated_at: now,
    });
    if (error) {
      if (isMissingEnumValue(error)) {
        const stagedError = await updateDealRow(id, {
          status: "staged",
          proposed_data: isPayload(rec.staged_data) ? rec.staged_data : rec.proposed_data ?? {},
          reject_reason: null,
          updated_at: now,
        });
        if (stagedError) return stagedError;
        continue;
      }
      return error;
    }
  }
  return null;
}

export async function pushDraftsToEmployee(
  repId: string,
  payload?: EmployeePushPayload,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return dealRowsUnavailable(loaded);
  const keepIds = loaded.rows.filter((row) => row.rep_id === repId && row.status === "draft").map((row) => row.id);
  const packet = payload ?? buildEmployeePushPayload({ months: [], vehicleTypes: [] });
  const { error } = await supabase.rpc("push_drafts_to_employee", {
    target_rep: repId,
    payload: packet,
  });
  if (!error) return null;
  console.error("push_drafts_to_employee failed:", error.message);
  const missing = isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code);
  if (!missing) return error.message;

  const fallback = await rpcError("push_drafts_to_employee", { target_rep: repId });
  if (fallback) {
    if (!(isMissingFunction(fallback) || isMissingRelation(fallback))) return fallback;
    const promoteError = await promoteDraftsToEmployeeReview(keepIds);
    if (promoteError) return promoteError;
    return archiveSupersededForRep(repId, keepIds);
  }
  return archiveSupersededForRep(repId, keepIds);
}

export async function recallPendingPush(repId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("recall_pending_push", { target_rep: repId });
  if (!error) return null;
  console.error("recall_pending_push failed:", error.message);
  const missing = isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code);
  if (!missing) return error.message;

  const now = new Date().toISOString();
  const loaded = await loadRepDealRows(repId);
  if (loaded.error) return loaded.error;
  for (const row of loaded.rows) {
    if (row.status !== "pending_rep_review" && row.status !== "staged") continue;
    const updateError = await updateDealRow(row.id, {
      status: "draft",
      reject_reason: null,
      updated_at: now,
    });
    if (updateError) return isMissingEnumValue(updateError) ? SCHEMA_RERUN : updateError;
  }
  return null;
}

function isMissingEnumValue(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("invalid input value for enum") || text.includes("pending_admin_approval");
}

async function updateDealRow(id: string, patch: Record<string, unknown>): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.from(DEAL_RECORDS_TABLE).update(patch).eq("id", id);
  if (!error) return null;
  if (isMissingColumn(error.message, error.code) && "previous_data" in patch) {
    const rest = { ...patch };
    delete rest.previous_data;
    const retry = await supabase.from(DEAL_RECORDS_TABLE).update(rest).eq("id", id);
    if (!retry.error) return null;
    return retry.error.message;
  }
  if (isMissingEnumValue(error.message)) return SCHEMA_RERUN;
  return error.message;
}

async function loadDealRow(id: string): Promise<{ row: DealRow | null; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { row: null, error: "Not signed in." };
  const selects: string[] = [DEAL_RECORD_SELECT, DEAL_RECORD_SELECT_WITH_PROPOSED, DEAL_RECORD_SELECT_MIN];
  for (const columns of selects) {
    const { data, error } = await supabase.from(DEAL_RECORDS_TABLE).select(columns).eq("id", id).maybeSingle();
    if (!error) return { row: (data as unknown as DealRow | null) ?? null, error: null };
    if (!isMissingColumn(error.message, error.code)) return { row: null, error: error.message };
  }
  return { row: null, error: "Could not load deal." };
}

export function buildRepSubmitPayload(decisions: ReviewResolution[]) {
  return {
    decisions,
    deals: decisions.map((decision) => ({
      id: decision.id,
      action: decision.action,
      live_id: decision.live_id ?? null,
      live_data: decision.live_data ?? null,
      previous_data: decision.previous_data ?? null,
      discard_staged: Boolean(decision.discard_staged),
    })),
  };
}

async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function markRepRosterReady(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.from(USER_PROFILES_TABLE).update({ roster_ready: true }).eq("id", userId);
  if (!error) return null;
  if (isMissingColumn(error.message, error.code) || isMissingRelation(error.message, error.code)) return null;
  return error.message;
}

async function sweepRemainingEmployeeReview(userId: string, keepIds: string[] = []): Promise<string | null> {
  if (keepIds.length > 0) {
    const archiveError = await archiveSupersededForRep(userId, keepIds);
    if (archiveError) return archiveError;
  } else {
    const loaded = await loadRepDealRows(userId);
    if (loaded.error) return loaded.error;
    const leftover = loaded.rows.filter((row) => row.status === "pending_rep_review" || row.status === "staged");
    const leftoverError = await archiveDealIds(leftover.map((row) => row.id));
    if (leftoverError) return leftoverError;
  }
  return markRepRosterReady(userId);
}

export async function resolvePendingRepReview(decisions: ReviewResolution[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const userId = await currentUserId();
  if (!userId) return "Not signed in.";

  const currentDealsPayload = buildRepSubmitPayload(decisions);
  const keepIds = submittedKeepIds(decisions);
  const attempts = [
    {
      name: "rep_submit_to_manager",
      run: () =>
        supabase.rpc("rep_submit_to_manager", {
          target_rep: userId,
          updated_deals: currentDealsPayload,
        }),
    },
    {
      name: "submit_rep_review_to_manager",
      run: () => supabase.rpc("submit_rep_review_to_manager", { decisions }),
    },
  ];

  for (const attempt of attempts) {
    const { error } = await attempt.run();
    if (!error) return sweepRemainingEmployeeReview(userId, keepIds);
    const missing = isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code);
    if (!missing) {
      console.error(`${attempt.name} failed:`, error.message);
    }
  }

  return applyReviewResolutions(decisions);
}

export async function finalizeRepSubmit(): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return "Not signed in.";
  return sweepRemainingEmployeeReview(userId);
}

export async function insertPendingManagerPayloads(payloads: DealPayload[]): Promise<string | null> {
  if (payloads.length === 0) return null;
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const userId = await currentUserId();
  if (!userId) return "Not signed in.";
  const profile = getCachedProfile();
  for (const payload of payloads) {
    const { error } = await supabase.from(DEAL_RECORDS_TABLE).insert({
      rep_id: userId,
      location_id: profile?.location_id ?? null,
      created_by: userId,
      status: "pending_manager_approval",
      staged_data: payload,
      live_data: {},
      proposed_data: {},
      previous_data: {},
      reject_reason: null,
    });
    if (error) {
      if (isMissingEnumValue(error.message)) return SCHEMA_RERUN;
      return error.message;
    }
  }
  return markRepRosterReady(userId);
}

async function applyReviewResolutions(decisions: ReviewResolution[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const empty = {};
  const now = new Date().toISOString();
  let submitted = false;
  for (const decision of decisions) {
    const loaded = await loadDealRow(decision.id);
    if (loaded.error) return loaded.error;
    const rec = loaded.row;
    if (!rec) continue;
    const liveId = decision.live_id && decision.live_id !== rec.id ? decision.live_id : null;
    const resolved = decision.live_data ?? rec.staged_data;
    if (decision.action === "decline") {
      if (liveId) {
        const liveError = await updateDealRow(liveId, {
          staged_data: empty,
          proposed_data: empty,
          previous_data: empty,
          status: "active",
          reject_reason: null,
          updated_at: now,
        });
        if (liveError) return liveError;
      }
      if (!isPayload(rec.live_data)) {
        const { error: deleteError } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", rec.id);
        if (deleteError) return deleteError.message;
      } else {
        const clearError = await updateDealRow(rec.id, {
          staged_data: empty,
          proposed_data: empty,
          previous_data: empty,
          status: "active",
          reject_reason: null,
          updated_at: now,
        });
        if (clearError) return clearError;
      }
      continue;
    }

    const prior = decision.action === "accept" ? empty : rec.staged_data ?? empty;
    const approvalPatch = {
      staged_data: resolved,
      proposed_data: prior,
      previous_data: prior,
      status: "pending_manager_approval",
      reject_reason: null,
      updated_at: now,
    };

    if (liveId) {
      const liveError = await updateDealRow(liveId, approvalPatch);
      if (liveError) {
        if (isMissingEnumValue(liveError)) return SCHEMA_RERUN;
        return liveError;
      }
      if (!isPayload(rec.live_data)) {
        const { error: deleteError } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", rec.id);
        if (deleteError) return deleteError.message;
      } else {
        const clearError = await updateDealRow(rec.id, {
          staged_data: empty,
          proposed_data: empty,
          previous_data: empty,
          status: "active",
          reject_reason: null,
          updated_at: now,
        });
        if (clearError) return clearError;
      }
      submitted = true;
      continue;
    }

    const updateError = await updateDealRow(rec.id, approvalPatch);
    if (updateError) {
      if (isMissingEnumValue(updateError)) return SCHEMA_RERUN;
      return updateError;
    }
    submitted = true;
  }
  const userId = await currentUserId();
  if (userId) {
    const sweepError = await sweepRemainingEmployeeReview(userId, submittedKeepIds(decisions));
    if (sweepError) return sweepError;
  } else if (submitted) {
    return "Not signed in.";
  }
  return null;
}

async function applyIdsRpc(
  name: string,
  ids: string[],
  fallback: (ids: string[]) => Promise<string | null>,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (ids.length === 0) return null;
  const { error } = await supabase.rpc(name, { target_ids: ids });
  if (!error) return null;
  if (isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code)) {
    return fallback(ids);
  }
  if (isMissingEnumValue(error.message)) return SCHEMA_RERUN;
  console.error(`${name} failed:`, error.message);
  return error.message;
}

async function lockDealIdsLive(ids: string[]): Promise<string | null> {
  const empty = {};
  const now = new Date().toISOString();
  for (const id of ids) {
    const loaded = await loadDealRow(id);
    if (loaded.error) return loaded.error;
    const rec = loaded.row;
    if (!rec) continue;
    if (rec.status !== "pending_manager_approval" && rec.status !== "pending_admin_approval") continue;
    const live = isPayload(rec.staged_data) ? rec.staged_data : rec.live_data;
    const error = await updateDealRow(id, {
      live_data: live,
      staged_data: empty,
      proposed_data: empty,
      previous_data: empty,
      status: "active",
      reject_reason: null,
      updated_at: now,
    });
    if (error) return error;
  }
  return null;
}

export async function forwardDealsToAdmin(ids: string[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (ids.length === 0) return null;
  const { error } = await supabase.rpc("forward_deals_to_admin", { target_ids: ids });
  if (error && !(isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code))) {
    console.error("forward_deals_to_admin failed:", error.message);
  }
  return lockDealIdsLive(ids);
}

export async function finalApproveDeals(ids: string[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (ids.length === 0) return null;
  const { error } = await supabase.rpc("final_approve_deals", { target_ids: ids });
  if (error && !(isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code))) {
    console.error("final_approve_deals failed:", error.message);
  }
  return lockDealIdsLive(ids);
}

export async function returnDealsToManager(ids: string[]): Promise<string | null> {
  return applyIdsRpc("return_deals_to_manager", ids, async (targetIds) => {
    const now = new Date().toISOString();
    for (const id of targetIds) {
      const error = await updateDealRow(id, { status: "pending_manager_approval", updated_at: now });
      if (error) return error;
    }
    return null;
  });
}

export async function acceptStagedAsIs(): Promise<string | null> {
  return rpcError("accept_staged_as_is");
}

export async function submitModifiedStaged(): Promise<string | null> {
  return rpcError("submit_modified_staged");
}

export async function approveDealRecord(id: string): Promise<string | null> {
  return rpcError("approve_deal_record", { target_id: id });
}

export async function rejectDealRecord(id: string, reason: string): Promise<string | null> {
  return rpcError("reject_deal_record", { target_id: id, reason });
}

export async function rejectDealRecords(ids: string[], reason: string): Promise<string | null> {
  for (const id of ids) {
    const error = await rejectDealRecord(id, reason);
    if (error) return error;
  }
  return null;
}

export async function managerOverrideRepReady(repId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return dealRowsUnavailable(loaded);
  const keepIds = loaded.rows
    .filter(
      (row) =>
        row.rep_id === repId &&
        (row.status === "draft" ||
          row.status === "staged" ||
          row.status === "pending_rep_review" ||
          row.status === "rejected"),
    )
    .map((row) => row.id);
  const { error } = await supabase.rpc("manager_override_rep_ready", { target_rep: repId });
  if (!error) {
    const archiveError = await archiveSupersededForRep(repId, keepIds);
    if (archiveError) return archiveError;
    return null;
  }
  if (isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code)) {
    return applyManagerOverride(repId);
  }
  console.error("manager_override_rep_ready failed:", error.message);
  return error.message.includes("schema.sql") ? SCHEMA_RERUN : error.message;
}

async function applyManagerOverride(repId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return dealRowsUnavailable(loaded);
  const now = new Date().toISOString();
  const keepIds: string[] = [];
  for (const row of loaded.rows) {
    if (row.rep_id !== repId) continue;
    if (
      row.status !== "draft" &&
      row.status !== "staged" &&
      row.status !== "pending_rep_review" &&
      row.status !== "rejected"
    ) {
      continue;
    }
    const staged = isPayload(row.staged_data) ? row.staged_data : row.live_data;
    const error = await updateDealRow(row.id, {
      staged_data: staged,
      previous_data: isPayload(row.previous_data) ? row.previous_data : staged,
      proposed_data: isPayload(row.proposed_data) ? row.proposed_data : staged,
      status: "pending_manager_approval",
      reject_reason: null,
      updated_at: now,
    });
    if (error) return isMissingEnumValue(error) ? SCHEMA_RERUN : error;
    keepIds.push(row.id);
  }
  const archiveError = await archiveSupersededForRep(repId, keepIds);
  if (archiveError) return archiveError;
  const { error } = await supabase.from(USER_PROFILES_TABLE).update({ roster_ready: true }).eq("id", repId);
  if (error && !isMissingColumn(error.message, error.code)) return error.message;
  return null;
}

export async function managerPushAllToAdmin(locationId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("manager_push_all_to_admin", { target_location: locationId });
  if (error) {
    const missing =
      isMissingFunction(error.message, error.code) ||
      isMissingRelation(error.message, error.code) ||
      isMissingEnumValue(error.message);
    const notReady = error.message.toLowerCase().includes("must be ready");
    if (!missing && notReady) return error.message;
    if (!missing) console.error("manager_push_all_to_admin failed:", error.message);
  }
  return applyPushAllToAdmin(locationId);
}

async function applyPushAllToAdmin(locationId: string): Promise<string | null> {
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return dealRowsUnavailable(loaded);
  const ids = loaded.rows
    .filter(
      (row) =>
        row.location_id === locationId &&
        (row.status === "pending_manager_approval" || row.status === "pending_admin_approval"),
    )
    .map((row) => row.id);
  const lockError = await lockDealIdsLive(ids);
  if (lockError) return lockError;
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase
      .from(USER_PROFILES_TABLE)
      .update({ roster_ready: false })
      .eq("location_id", locationId)
      .eq("role", "rep");
    if (error && !isMissingColumn(error.message, error.code)) return error.message;
  }
  return null;
}
