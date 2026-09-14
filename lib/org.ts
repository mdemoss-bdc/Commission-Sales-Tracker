import { getSupabase } from "./supabase.ts";
import {
  DEAL_RECORD_SELECT,
  DEAL_RECORD_SELECT_MIN,
  DEAL_RECORD_SELECT_WITH_PROPOSED,
  DEAL_RECORDS_TABLE,
  LOCATION_SELECT,
  LOCATIONS_TABLE,
  USER_PROFILE_SELECT,
  USER_PROFILE_SELECT_MIN,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import { firstUserRole, isPipelineRecordStatus, type LocationRecord, type UserProfile, type UserRole } from "./roles.ts";
import { metadataFullName } from "./names.ts";
import { metadataLocationId } from "./signup.ts";
import { isPayload, rowKey, type DealPayload, type DealRow } from "./deal-records.ts";
import type { ReviewResolution } from "./rep-review.ts";

let cachedProfile: UserProfile | null = null;

export function getCachedProfile(): UserProfile | null {
  return cachedProfile;
}

export function clearCachedProfile() {
  cachedProfile = null;
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
    text.includes("list_signup_locations") ||
    (text.includes("404") && text.includes("rpc"))
  );
}

export function isMissingRelation(message: string, code?: string): boolean {
  return (
    isMissingTable(message, code) ||
    isMissingFunction(message, code) ||
    message.includes("ensure_own_profile") ||
    message.includes("update_user_role") ||
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
    message.includes("push_drafts_to_employee")
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

function asProfile(row: Record<string, unknown> | null | undefined): UserProfile | null {
  if (!row || typeof row.id !== "string") return null;
  const role = row.role === "admin" || row.role === "manager" || row.role === "rep" ? row.role : "rep";
  const email = typeof row.email === "string" ? row.email : "";
  const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
  return {
    id: row.id,
    email,
    full_name: fullName || null,
    role,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    roster_ready: row.roster_ready === true,
  };
}

function remember(profile: UserProfile): { status: "ready"; profile: UserProfile } {
  cachedProfile = profile;
  return { status: "ready", profile };
}

async function insertOwnProfile(role: UserRole): Promise<
  { status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user?.id) return { status: "signed-out" };
  const email = user.email ?? "";
  const fullName = metadataFullName(user.user_metadata) ?? email;
  const locationId = metadataLocationId(user.user_metadata);
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .insert({
      id: user.id,
      email,
      full_name: fullName,
      role,
      location_id: locationId,
    })
    .select("id,email,full_name,role,location_id")
    .single();
  if (!error) {
    const profile = asProfile(data as Record<string, unknown>);
    if (profile) return remember(profile);
  }
  if (error && isMissingRelation(error.message, error.code)) return { status: "setup" };
  if (error && isPermissionError(error.message, error.code)) return { status: "blocked" };
  if (error?.code === "23505") {
    const again = await supabase
      .from(USER_PROFILES_TABLE)
      .select("id,email,full_name,role,location_id")
      .eq("id", user.id)
      .maybeSingle();
    const profile = asProfile(again.data as Record<string, unknown> | null);
    if (profile) return remember(profile);
    if (role === "admin") return insertOwnProfile("rep");
  }
  return { status: "offline" };
}

async function createOwnProfileIfNeeded(): Promise<
  { status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
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

  const adminCheck = await supabase.from(USER_PROFILES_TABLE).select("id").eq("role", "admin").limit(1);
  if (adminCheck.error && isMissingRelation(adminCheck.error.message, adminCheck.error.code)) {
    return { status: "setup" };
  }
  if (adminCheck.error && isPermissionError(adminCheck.error.message, adminCheck.error.code)) {
    return { status: "blocked" };
  }

  return insertOwnProfile(firstUserRole((adminCheck.data?.length ?? 0) > 0));
}

export async function ensureOwnProfile(): Promise<
  { status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  const rpc = await Promise.race([
    supabase.rpc("ensure_own_profile"),
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
    if (profile) return remember(profile);
  } else if (isPermissionError(error.message, error.code)) {
    return { status: "blocked" };
  }
  return createOwnProfileIfNeeded();
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
    rows.push(location);
  }
  return rows;
}

export async function listLocations(): Promise<LocationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from(LOCATIONS_TABLE).select(LOCATION_SELECT).order("name");
  if (error) {
    console.error("locations select failed:", error.message);
    return [];
  }
  return asLocationRows(data);
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

export async function listProfiles(): Promise<UserProfile[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const selects: string[] = [USER_PROFILE_SELECT, USER_PROFILE_SELECT_MIN];
  for (const columns of selects) {
    const { data, error } = await supabase
      .from(USER_PROFILES_TABLE)
      .select(columns)
      .order("full_name")
      .order("email");
    if (!error && data) {
      return data
        .map((row) => asProfile(row as unknown as Record<string, unknown>))
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
  const { error } = await supabase.from(LOCATIONS_TABLE).insert({ name: trimmed });
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
  patch: { role?: UserRole; location_id?: string | null; full_name?: string | null },
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (patch.role) {
    const { error } = await supabase.rpc("update_user_role", {
      target_user_id: userId,
      new_role: patch.role,
    });
    if (error) return error.message;
  }
  const rest: { location_id?: string | null; full_name?: string | null } = {};
  if (patch.location_id !== undefined) rest.location_id = patch.location_id;
  if (patch.full_name !== undefined) rest.full_name = patch.full_name;
  if (Object.keys(rest).length === 0) return null;
  const { error } = await supabase.from(USER_PROFILES_TABLE).update(rest).eq("id", userId);
  return error ? error.message : null;
}

export async function updateOwnLocationId(locationId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = locationId.trim();
  if (!cleaned) return "Select a dealership store.";
  const { data, error } = await supabase.rpc("update_own_location_id", { p_location_id: cleaned });
  if (!error) {
    const raw = Array.isArray(data) ? data[0] : data;
    const profile = asProfile(raw as Record<string, unknown>);
    if (profile) remember(profile);
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
  const selects: string[] = [DEAL_RECORD_SELECT, DEAL_RECORD_SELECT_WITH_PROPOSED, DEAL_RECORD_SELECT_MIN];
  let lastError: { message: string; code?: string } | null = null;
  for (const columns of selects) {
    const { data, error } = await supabase.from(DEAL_RECORDS_TABLE).select(columns);
    if (!error) return { status: "ready", rows: (data ?? []) as unknown as DealRow[] };
    lastError = error;
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    if (isMissingTable(error.message, error.code)) return { status: "setup" };
    if (!isMissingColumn(error.message, error.code)) break;
  }
  if (lastError) console.error("deal_records select failed:", lastError.message);
  return { status: "ready", rows: [] };
}

function mapByKey(rows: DealRow[]): Map<string, DealRow> {
  const map = new Map<string, DealRow>();
  for (const row of rows) {
    const key = rowKey(row);
    if (key) map.set(key, row);
  }
  return map;
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
  const existingByKey = mapByKey(input.existing);
  const nextKeys = new Set(input.payloads.map((payload) => `${payload.kind}:${payload.entityId}`));
  for (const payload of input.payloads) {
    const current = existingByKey.get(`${payload.kind}:${payload.entityId}`);
    if (current && isPipelineRecordStatus(current.status) && current.status !== "draft") continue;
    const liveSame = current && isPayload(current.live_data) && JSON.stringify(current.live_data) === JSON.stringify(payload);
    if (current && (current.status === "approved" || current.status === "active") && liveSame) {
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
  for (const row of input.existing) {
    const key = rowKey(row);
    if (!key || row.rep_id !== input.repId || row.status !== "draft") continue;
    if (nextKeys.has(key)) continue;
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
  const existingByKey = mapByKey(input.existing.filter((row) => row.status === "staged" || row.status === "pending_rep_review"));
  for (const payload of input.payloads) {
    const current = existingByKey.get(`${payload.kind}:${payload.entityId}`);
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

export async function pushDraftsToEmployee(repId: string): Promise<string | null> {
  return rpcError("push_drafts_to_employee", { target_rep: repId });
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

async function sweepRemainingEmployeeReview(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const selects = ["id, status", "id"];
  let rows: Array<{ id: string; status?: string }> | null = null;
  for (const columns of selects) {
    const { data, error } = await supabase
      .from(DEAL_RECORDS_TABLE)
      .select(columns)
      .eq("rep_id", userId)
      .in("status", ["pending_rep_review", "staged"]);
    if (!error) {
      rows = ((data as unknown) as Array<{ id: string; status?: string }> | null) ?? [];
      break;
    }
    if (!isMissingColumn(error.message, error.code)) return error.message;
  }
  const now = new Date().toISOString();
  for (const row of rows ?? []) {
    const error = await updateDealRow(row.id, {
      status: "pending_manager_approval",
      reject_reason: null,
      updated_at: now,
    });
    if (error) return isMissingEnumValue(error) ? SCHEMA_RERUN : error;
  }
  return markRepRosterReady(userId);
}

export async function resolvePendingRepReview(decisions: ReviewResolution[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const userId = await currentUserId();
  if (!userId) return "Not signed in.";

  const currentDealsPayload = buildRepSubmitPayload(decisions);
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
    if (!error) return sweepRemainingEmployeeReview(userId);
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
    const sweepError = await sweepRemainingEmployeeReview(userId);
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

export async function forwardDealsToAdmin(ids: string[]): Promise<string | null> {
  return applyIdsRpc("forward_deals_to_admin", ids, async (targetIds) => {
    const now = new Date().toISOString();
    for (const id of targetIds) {
      const error = await updateDealRow(id, {
        status: "pending_admin_approval",
        reject_reason: null,
        updated_at: now,
      });
      if (error) return isMissingEnumValue(error) ? SCHEMA_RERUN : error;
    }
    return null;
  });
}

export async function finalApproveDeals(ids: string[]): Promise<string | null> {
  return applyIdsRpc("final_approve_deals", ids, async (targetIds) => {
    const now = new Date().toISOString();
    const empty = {};
    for (const id of targetIds) {
      const loaded = await loadDealRow(id);
      if (loaded.error) return loaded.error;
      const rec = loaded.row;
      if (!rec) continue;
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
  });
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
  const { error } = await supabase.rpc("manager_override_rep_ready", { target_rep: repId });
  if (!error) return null;
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
  if (loaded.status !== "ready") return SCHEMA_RERUN;
  const now = new Date().toISOString();
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
  }
  const { error } = await supabase.from(USER_PROFILES_TABLE).update({ roster_ready: true }).eq("id", repId);
  if (error && !isMissingColumn(error.message, error.code)) return error.message;
  return null;
}

export async function managerPushAllToAdmin(locationId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("manager_push_all_to_admin", { target_location: locationId });
  if (!error) return null;
  if (isMissingFunction(error.message, error.code) || isMissingRelation(error.message, error.code)) {
    return applyPushAllToAdmin(locationId);
  }
  if (isMissingEnumValue(error.message)) return SCHEMA_RERUN;
  console.error("manager_push_all_to_admin failed:", error.message);
  return error.message;
}

async function applyPushAllToAdmin(locationId: string): Promise<string | null> {
  const loaded = await loadDealRows();
  if (loaded.status !== "ready") return SCHEMA_RERUN;
  const now = new Date().toISOString();
  for (const row of loaded.rows) {
    if (row.location_id !== locationId || row.status !== "pending_manager_approval") continue;
    const error = await updateDealRow(row.id, {
      status: "pending_admin_approval",
      reject_reason: null,
      updated_at: now,
    });
    if (error) return isMissingEnumValue(error) ? SCHEMA_RERUN : error;
  }
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
