import type { LocationRecord } from "./roles.ts";

export function normalizeOrgCode(code: string): string {
  return code.trim().toUpperCase();
}

export const JOIN_DEALERSHIP_BANNER =
  "You are not currently linked to a dealership group. Enter your group join code to connect your account and submit deals.";

export function needsDealershipLink(
  profile?: { org_id?: string | null; location_id?: string | null } | null,
): boolean {
  if (!profile) return false;
  return !profile.org_id || !profile.location_id;
}

export function joinedDealershipMessage(orgName: string): string {
  return `Successfully joined ${orgName}!`;
}

export function parseJoinOrganizationResult(data: unknown): { org_name: string } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const orgName = typeof (row as { org_name?: unknown }).org_name === "string"
    ? (row as { org_name: string }).org_name.trim()
    : "";
  return orgName ? { org_name: orgName } : null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const isValidEmail = (val: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim().toLowerCase());

export function canSubmitSignup(
  fullName: string,
  locationId: string,
  orgConnected = false,
): boolean {
  return fullName.trim().length >= 2 && Boolean(locationId.trim()) && orgConnected;
}

export const DEALERSHIP_TAKEN_MESSAGE = "This dealership name is already registered.";

export function isValidOrgCode(code: string): boolean {
  return /^[A-Z0-9]{3,32}$/.test(normalizeOrgCode(code));
}

export function canSubmitNewDealership(orgName: string, fullName: string): boolean {
  return orgName.trim().length >= 2 && fullName.trim().length >= 2;
}

export const DEALERSHIP_JOIN_CODE_LENGTH = 6;
export const DEALERSHIP_JOIN_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const DEALERSHIP_CODE_COPIED_MESSAGE =
  "Dealership code copied! Share this with your managers and salespeople.";

export function generateDealershipJoinCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < DEALERSHIP_JOIN_CODE_LENGTH; index += 1) {
    const pick = Math.floor(random() * DEALERSHIP_JOIN_CODE_ALPHABET.length);
    code += DEALERSHIP_JOIN_CODE_ALPHABET[pick] ?? "A";
  }
  return code;
}

export function dealershipJoinCodeBanner(code: string): string {
  return `DEALERSHIP JOIN CODE: ${normalizeOrgCode(code)}`;
}

export function metadataSignupMode(
  meta: Record<string, unknown> | null | undefined,
): "join" | "new_dealership" | null {
  const value = meta?.signup_mode;
  if (value === "new_dealership" || value === "join") return value;
  return null;
}

export function metadataLocationId(meta: Record<string, unknown> | null | undefined): string | null {
  const value = meta?.location_id;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export type OrgCodeLookup = {
  org_id: string;
  org_name: string;
  join_code?: string;
  stores: LocationRecord[];
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storeFromRow(row: Record<string, unknown>, orgId: string): LocationRecord | null {
  const id = asText(row.id) || asText(row.location_id);
  const name = asText(row.name) || asText(row.location_name);
  if (!id || !name) return null;
  return { id, name, org_id: orgId || asText(row.org_id) || null };
}

function lookupFromObject(row: Record<string, unknown>): OrgCodeLookup | null {
  const orgId = asText(row.org_id);
  const orgName = asText(row.org_name);
  if (!orgId || !orgName) return null;
  const stores: LocationRecord[] = [];
  const rawStores = row.stores;
  if (Array.isArray(rawStores)) {
    for (const item of rawStores) {
      if (!item || typeof item !== "object") continue;
      const store = storeFromRow(item as Record<string, unknown>, orgId);
      if (store) stores.push(store);
    }
  } else {
    const store = storeFromRow(row, orgId);
    if (store) stores.push(store);
  }
  return {
    org_id: orgId,
    org_name: orgName,
    join_code: asText(row.join_code) || undefined,
    stores,
  };
}

export function parseOrgCodeLookup(data: unknown): OrgCodeLookup | null {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
      const only = value[0] as Record<string, unknown>;
      if (Array.isArray(only.stores) || (asText(only.org_id) && asText(only.org_name) && !asText(only.location_id))) {
        return lookupFromObject(only);
      }
    }
    const stores: LocationRecord[] = [];
    let orgId = "";
    let orgName = "";
    let joinCode: string | undefined;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (!orgId) orgId = asText(row.org_id);
      if (!orgName) orgName = asText(row.org_name);
      if (!joinCode) joinCode = asText(row.join_code) || undefined;
      const store = storeFromRow(row, orgId);
      if (store) stores.push(store);
    }
    if (!orgId || !orgName) return null;
    return { org_id: orgId, org_name: orgName, join_code: joinCode, stores };
  }
  if (!value || typeof value !== "object") return null;
  return lookupFromObject(value as Record<string, unknown>);
}
