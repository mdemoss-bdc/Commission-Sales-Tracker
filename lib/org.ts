import { getSupabase } from "./supabase.ts";
import {
  DEAL_RECORDS_TABLE,
  LOCATIONS_TABLE,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import type { LocationRecord, UserProfile, UserRole } from "./roles.ts";
import { nextRepStatus, type DealPayload, type DealRow } from "./deal-records.ts";

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
    .select("id,rep_id,location_id,created_by,status,staged_data,live_data,rep_notes");
  if (error) {
    if (isMissingRelation(error.message, error.code)) return { status: "setup" };
    if (isPermissionError(error.message, error.code)) return { status: "blocked" };
    return { status: "offline" };
  }
  return { status: "ready", rows: (data ?? []) as DealRow[] };
}

export async function syncDealPayloads(input: {
  repId: string;
  locationId: string | null;
  createdBy: string;
  payloads: DealPayload[];
  existing: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const existingByKey = new Map<string, DealRow>();
  for (const row of input.existing) {
    const payload = (row.staged_data && "kind" in row.staged_data && row.staged_data.kind
      ? row.staged_data
      : row.live_data) as DealPayload | undefined;
    if (payload?.kind && payload.entityId) {
      existingByKey.set(`${payload.kind}:${payload.entityId}`, row);
    }
  }
  const nextKeys = new Set(input.payloads.map((payload) => `${payload.kind}:${payload.entityId}`));
  for (const payload of input.payloads) {
    const key = `${payload.kind}:${payload.entityId}`;
    const current = existingByKey.get(key);
    const status = nextRepStatus(current?.status);
    if (current) {
      const { error } = await supabase
        .from(DEAL_RECORDS_TABLE)
        .update({
          staged_data: payload,
          status,
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
        status,
        staged_data: payload,
        live_data: {},
      });
      if (error) return error.message;
    }
  }
  const removed = input.existing.filter((row) => {
    const payload = (row.staged_data && "kind" in row.staged_data && row.staged_data.kind
      ? row.staged_data
      : row.live_data) as DealPayload | undefined;
    if (!payload?.kind || !payload.entityId) return false;
    if (row.rep_id !== input.repId) return false;
    return !nextKeys.has(`${payload.kind}:${payload.entityId}`);
  });
  for (const row of removed) {
    const { error } = await supabase.from(DEAL_RECORDS_TABLE).delete().eq("id", row.id);
    if (error) return error.message;
  }
  return null;
}

export async function submitOwnDeals(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return "Not signed in.";
  const { error } = await supabase
    .from(DEAL_RECORDS_TABLE)
    .update({ status: "pending_manager_approval", updated_at: new Date().toISOString() })
    .eq("rep_id", userId)
    .in("status", ["staged", "rejected", "active"]);
  return error ? error.message : null;
}

export async function reviewDeal(id: string, decision: "approved" | "rejected"): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { data, error: loadError } = await supabase
    .from(DEAL_RECORDS_TABLE)
    .select("id,staged_data,live_data")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return loadError.message;
  if (!data) return "That deal was not found.";
  const live = decision === "approved" ? data.staged_data || data.live_data : data.live_data;
  const { error } = await supabase
    .from(DEAL_RECORDS_TABLE)
    .update({
      status: decision,
      live_data: live ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return error ? error.message : null;
}
