import type { LocationRecord } from "./roles.ts";

export function normalizeOrgCode(code: string): string {
  return code.trim().toUpperCase();
}

export function canSubmitSignup(
  fullName: string,
  locationId: string,
  orgConnected = false,
): boolean {
  return fullName.trim().length >= 2 && Boolean(locationId.trim()) && orgConnected;
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

export function parseOrgCodeLookup(data: unknown): OrgCodeLookup | null {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const orgId = typeof row.org_id === "string" ? row.org_id : "";
  const orgName = typeof row.org_name === "string" ? row.org_name.trim() : "";
  if (!orgId || !orgName) return null;
  const stores: LocationRecord[] = [];
  const rawStores = row.stores;
  if (Array.isArray(rawStores)) {
    for (const item of rawStores) {
      if (!item || typeof item !== "object") continue;
      const store = item as Record<string, unknown>;
      if (typeof store.id !== "string" || typeof store.name !== "string") continue;
      stores.push({ id: store.id, name: store.name, org_id: orgId });
    }
  }
  return {
    org_id: orgId,
    org_name: orgName,
    join_code: typeof row.join_code === "string" ? row.join_code : undefined,
    stores,
  };
}
