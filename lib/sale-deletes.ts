import { isPayload, rowKey, type DealPayload, type DealRow } from "./deal-records.ts";
import { isSyntheticPayTrackerDealId } from "./pay-tracker-state.ts";
import type { TrackerState } from "./types.ts";

export const DELETED_SALES_STORAGE_PREFIX = "pay-tracker:deleted-sales";

const remembered = new Map<string, Set<string>>();

function ownerKey(ownerId: string | null | undefined): string {
  return ownerId?.trim() || "local";
}

export function deletedSalesStorageKey(ownerId: string | null | undefined): string {
  const owner = ownerKey(ownerId);
  return owner === "local" ? DELETED_SALES_STORAGE_PREFIX : `${DELETED_SALES_STORAGE_PREFIX}:${owner}`;
}

function readStoredIds(ownerId: string | null | undefined): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(deletedSalesStorageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeStoredIds(ownerId: string | null | undefined, ids: Iterable<string>): void {
  if (typeof window === "undefined") return;
  const unique = [...new Set(ids)];
  const key = deletedSalesStorageKey(ownerId);
  if (unique.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(unique));
}

function setForOwner(ownerId: string | null | undefined): Set<string> {
  const key = ownerKey(ownerId);
  let current = remembered.get(key);
  if (!current) {
    current = new Set(readStoredIds(ownerId));
    remembered.set(key, current);
  }
  return current;
}

export function listDeletedSaleIds(ownerId: string | null | undefined): Set<string> {
  const current = setForOwner(ownerId);
  for (const id of readStoredIds(ownerId)) current.add(id);
  return new Set(current);
}

export function rememberDeletedSaleIds(
  saleIds: Iterable<string>,
  ownerId: string | null | undefined,
): Set<string> {
  const current = setForOwner(ownerId);
  for (const id of saleIds) {
    if (id) current.add(id);
  }
  writeStoredIds(ownerId, current);
  return new Set(current);
}

export function payloadSaleId(payload: unknown): string | null {
  if (!isPayload(payload) || payload.kind !== "sale") return null;
  return payload.sale?.id || payload.entityId || null;
}

export function dealRowHoldsSale(row: Pick<DealRow, "id" | "live_data" | "staged_data" | "proposed_data">, saleId: string): boolean {
  if (!saleId) return false;
  if (row.id === saleId) return true;
  return (
    payloadSaleId(row.live_data) === saleId ||
    payloadSaleId(row.staged_data) === saleId ||
    payloadSaleId(row.proposed_data) === saleId
  );
}

export function dealRowHoldsDeletedSale(
  row: Pick<DealRow, "id" | "live_data" | "staged_data" | "proposed_data">,
  deletedIds: Set<string>,
): boolean {
  if (deletedIds.size === 0) return false;
  if (deletedIds.has(row.id)) return true;
  const liveId = payloadSaleId(row.live_data);
  if (liveId && deletedIds.has(liveId)) return true;
  const stagedId = payloadSaleId(row.staged_data);
  if (stagedId && deletedIds.has(stagedId)) return true;
  const proposedId = payloadSaleId(row.proposed_data);
  if (proposedId && deletedIds.has(proposedId)) return true;
  return false;
}

export function omitDeletedSaleRows<T extends Pick<DealRow, "id" | "live_data" | "staged_data" | "proposed_data">>(
  rows: T[],
  deletedIds: Set<string>,
): T[] {
  if (deletedIds.size === 0) return rows;
  return rows.filter((row) => !dealRowHoldsDeletedSale(row, deletedIds));
}

export function stripDeletedSalesFromState(state: TrackerState, deletedIds: Iterable<string>): TrackerState {
  const ids = deletedIds instanceof Set ? deletedIds : new Set(deletedIds);
  if (ids.size === 0) return state;
  return {
    ...state,
    months: (state.months ?? []).map((month) => ({
      ...month,
      sheets: (month.sheets ?? []).map((sheet) => ({
        ...sheet,
        sales: (sheet.sales ?? []).filter((sale) => !ids.has(sale.id)),
      })),
    })),
  };
}

export function omitDeletedSalePayloads(payloads: DealPayload[], deletedIds: Set<string>): DealPayload[] {
  if (deletedIds.size === 0) return payloads;
  return payloads.filter((payload) => {
    if (payload.kind !== "sale") return true;
    const id = payload.sale?.id || payload.entityId;
    return !id || !deletedIds.has(id);
  });
}

export function leftoverDealRowsToDelete(input: {
  existing: DealRow[];
  payloads: DealPayload[];
  repId: string;
}): DealRow[] {
  const nextKeys = new Set(input.payloads.map((payload) => `${payload.kind}:${payload.entityId}`));
  return input.existing.filter((row) => {
    if (row.rep_id !== input.repId) return false;
    if (isSyntheticPayTrackerDealId(row.id)) return false;
    const key = rowKey(row);
    if (!key || nextKeys.has(key)) return false;
    if (key.startsWith("sale:")) return true;
    return row.status === "approved" || row.status === "active";
  });
}

export function saleIdsFromSheet(sales: Array<{ id: string }> | null | undefined): string[] {
  return (sales ?? []).map((sale) => sale.id).filter(Boolean);
}
