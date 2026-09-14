import { getSupabase } from "./supabase.ts";
import {
  DEAL_RECORD_SELECT,
  DEAL_RECORDS_TABLE,
  LOCATION_SELECT,
  LOCATIONS_TABLE,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import { firstUserRole, type LocationRecord, type UserProfile, type UserRole } from "./roles.ts";
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
    message.includes("push_drafts_to_employee")
  );
}

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
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id,email,full_name,role,location_id")
    .order("full_name")
    .order("email");
  if (error || !data) return [];
  return data.map((row) => asProfile(row as Record<string, unknown>)).filter((row): row is UserProfile => row !== null);
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
  const { data, error } = await supabase.from(DEAL_RECORDS_TABLE).select(DEAL_RECORD_SELECT);
  if (error) {
    console.error("deal_records select failed:", error.message);
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    if (isMissingTable(error.message, error.code)) return { status: "setup" };
    return { status: "ready", rows: [] };
  }
  return { status: "ready", rows: (data ?? []) as DealRow[] };
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
    if (current?.status === "draft" || current?.status === "staged" || current?.status === "pending_rep_review" || current?.status === "pending_manager_approval") {
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
    if (current?.status === "staged" || current?.status === "pending_rep_review" || current?.status === "pending_manager_approval") continue;
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

export async function resolvePendingRepReview(decisions: ReviewResolution[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("resolve_pending_rep_review", { decisions });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    return applyReviewResolutions(decisions);
  }
  console.error("resolve_pending_rep_review failed:", error.message);
  return error.message;
}

async function applyReviewResolutions(decisions: ReviewResolution[]): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const empty = {};
  for (const decision of decisions) {
    const { data, error } = await supabase
      .from(DEAL_RECORDS_TABLE)
      .select(DEAL_RECORD_SELECT)
      .eq("id", decision.id)
      .maybeSingle();
    if (error) return error.message;
    const rec = data as DealRow | null;
    if (!rec) continue;
    const liveId = decision.live_id && decision.live_id !== rec.id ? decision.live_id : null;
    const resolved = decision.live_data ?? rec.staged_data;
    if (decision.action === "decline" || decision.action === "keep_mine") {
      if (liveId) {
        const { error: liveError } = await supabase
          .from(DEAL_RECORDS_TABLE)
          .update({
            staged_data: empty,
            status: "active",
            reject_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", liveId);
        if (liveError) return liveError.message;
      }
      if (!isPayload(rec.live_data)) {
        const { error: deleteError } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", rec.id);
        if (deleteError) return deleteError.message;
      } else {
        const { error: clearError } = await supabase
          .from(DEAL_RECORDS_TABLE)
          .update({
            staged_data: empty,
            status: "active",
            reject_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", rec.id);
        if (clearError) return clearError.message;
      }
      continue;
    }
    if (liveId) {
      const { error: liveError } = await supabase
        .from(DEAL_RECORDS_TABLE)
        .update({
          live_data: resolved,
          staged_data: empty,
          status: "active",
          reject_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", liveId);
      if (liveError) {
        if (isMissingRelation(liveError.message, liveError.code)) {
          return "Run supabase/schema.sql in the SQL editor so employee review can merge into live records.";
        }
        return liveError.message;
      }
      if (!isPayload(rec.live_data)) {
        const { error: deleteError } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", rec.id);
        if (deleteError) return deleteError.message;
      } else {
        const { error: clearError } = await supabase
          .from(DEAL_RECORDS_TABLE)
          .update({
            staged_data: empty,
            status: "active",
            reject_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", rec.id);
        if (clearError) return clearError.message;
      }
      continue;
    }
    const { error: updateError } = await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({
        live_data: resolved,
        staged_data: empty,
        status: "active",
        reject_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rec.id);
    if (updateError) {
      if (isMissingRelation(updateError.message, updateError.code)) {
        return "Run supabase/schema.sql in the SQL editor so employee review can merge into live records.";
      }
      return updateError.message;
    }
  }
  return null;
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
