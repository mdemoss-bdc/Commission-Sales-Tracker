import { getSupabase } from "./supabase.ts";
import {
  DEAL_RECORDS_TABLE,
  LOCATIONS_TABLE,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import type { LocationRecord, UserProfile, UserRole } from "./roles.ts";
import { isPayload, rowKey, type DealPayload, type DealRow } from "./deal-records.ts";

let cachedProfile: UserProfile | null = null;

export function getCachedProfile(): UserProfile | null {
  return cachedProfile;
}

export function clearCachedProfile() {
  cachedProfile = null;
}

export function isMissingRelation(message: string, code?: string): boolean {
  return (
    code === "PGRST205" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    message.includes("Could not find the table") ||
    message.includes("Could not find the function") ||
    message.includes("schema cache") ||
    message.includes("ensure_own_profile")
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
  return {
    id: row.id,
    email: typeof row.email === "string" ? row.email : "",
    full_name: typeof row.full_name === "string" ? row.full_name : null,
    role,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
  };
}

export async function ensureOwnProfile(): Promise<
  { status: "ready"; profile: UserProfile } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  const { data, error } = await supabase.rpc("ensure_own_profile");
  if (error) {
    if (isMissingRelation(error.message, error.code)) return { status: "setup" };
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    return { status: "offline" };
  }
  const raw = Array.isArray(data) ? data[0] : data;
  const profile = asProfile(raw as Record<string, unknown>);
  if (!profile) return { status: "offline" };
  cachedProfile = profile;
  return { status: "ready", profile };
}

export async function listLocations(): Promise<LocationRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from(LOCATIONS_TABLE).select("id,name,created_at").order("name");
  if (error || !data) return [];
  return data as LocationRecord[];
}

export async function listProfiles(): Promise<UserProfile[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select("id,email,full_name,role,location_id")
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

export async function updateProfileAssignment(
  userId: string,
  patch: { role?: UserRole; location_id?: string | null; full_name?: string | null },
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (patch.role === "admin") return "There can only be one admin.";
  const { error } = await supabase.from(USER_PROFILES_TABLE).update(patch).eq("id", userId);
  return error ? error.message : null;
}

export async function loadDealRows(): Promise<
  { status: "ready"; rows: DealRow[] } | { status: "setup" | "offline" | "blocked" | "signed-out" }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "signed-out" };
  const { data, error } = await supabase
    .from(DEAL_RECORDS_TABLE)
    .select("id,rep_id,location_id,created_by,status,staged_data,live_data,proposed_data,rep_notes,reject_reason");
  if (error) {
    if (isMissingRelation(error.message, error.code)) return { status: "setup" };
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    return { status: "offline" };
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
    if (current?.status === "draft" || current?.status === "staged" || current?.status === "pending_manager_approval") {
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
        proposed_data: {},
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
    if (current?.status === "staged" || current?.status === "pending_manager_approval") continue;
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
        proposed_data: {},
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
  const existingByKey = mapByKey(input.existing.filter((row) => row.status === "staged"));
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
  return error ? error.message : null;
}

export async function pushDraftsToEmployee(repId: string): Promise<string | null> {
  return rpcError("push_drafts_to_employee", { target_rep: repId });
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
