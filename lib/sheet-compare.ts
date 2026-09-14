import { assembleStagedState, isPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { findMonth, findSheet, monthLabel } from "./records.ts";
import {
  applyManagerValues,
  isAwaitingRepReview,
  resolutionForChoice,
  type ReviewItem,
  type ReviewResolution,
} from "./rep-review.ts";
import type { PaySheet, Sale } from "./types.ts";

export const SALE_COMPARE_FIELDS = [
  "stockNumber",
  "customerName",
  "dealType",
  "vehicleType",
  "tradeIn",
  "gross",
  "flat",
  "fi",
  "service",
] as const;

export type SaleCompareField = (typeof SALE_COMPARE_FIELDS)[number];

export type RowCompareKind = "matched" | "extra" | "missing";

export type ComparedSale = {
  sale: Sale;
  kind: RowCompareKind;
  fields: SaleCompareField[];
  counterpart: Sale | null;
};

export function saleMatchKey(sale: Sale): string {
  const stock = sale.stockNumber.trim().toLowerCase();
  if (stock) return `stock:${stock}`;
  return `id:${sale.id}`;
}

export function saleFieldValue(sale: Sale, field: SaleCompareField): string | number | boolean {
  return sale[field];
}

export function differingSaleFields(left: Sale | null | undefined, right: Sale | null | undefined): SaleCompareField[] {
  if (!left || !right) return [...SALE_COMPARE_FIELDS];
  return SALE_COMPARE_FIELDS.filter((field) => {
    if (field === "stockNumber" || field === "customerName") {
      return left[field].trim().toLowerCase() !== right[field].trim().toLowerCase();
    }
    return left[field] !== right[field];
  });
}

export function compareSaleRows(liveSales: Sale[], managerSales: Sale[]): { live: ComparedSale[]; manager: ComparedSale[] } {
  const liveByKey = new Map<string, Sale>();
  for (const sale of liveSales) {
    const key = saleMatchKey(sale);
    if (!liveByKey.has(key)) liveByKey.set(key, sale);
  }
  const managerByKey = new Map<string, Sale>();
  for (const sale of managerSales) {
    const key = saleMatchKey(sale);
    if (!managerByKey.has(key)) managerByKey.set(key, sale);
  }

  const live: ComparedSale[] = liveSales.map((sale) => {
    const counterpart = managerByKey.get(saleMatchKey(sale)) ?? managerSales.find((row) => row.id === sale.id) ?? null;
    if (!counterpart) return { sale, kind: "missing", fields: [...SALE_COMPARE_FIELDS], counterpart: null };
    const fields = differingSaleFields(sale, counterpart);
    return { sale, kind: "matched", fields, counterpart };
  });

  const manager: ComparedSale[] = managerSales.map((sale) => {
    const counterpart = liveByKey.get(saleMatchKey(sale)) ?? liveSales.find((row) => row.id === sale.id) ?? null;
    if (!counterpart) return { sale, kind: "extra", fields: [...SALE_COMPARE_FIELDS], counterpart: null };
    const fields = differingSaleFields(counterpart, sale);
    return { sale, kind: "matched", fields, counterpart };
  });

  return { live, manager };
}

export function stagedMonthFor(rows: DealRow[], monthId: string) {
  const pending = rows.filter((row) => isAwaitingRepReview(row.status) && isPayload(row.staged_data));
  return findMonth(assembleStagedState(pending), monthId) ?? null;
}

export function stagedSheetFor(rows: DealRow[], monthId: string, sheetId: string): PaySheet | null {
  const month = stagedMonthFor(rows, monthId);
  if (!month) return null;
  return findSheet(month, sheetId) ?? null;
}

export function reviewSheetTargets(items: ReviewItem[]): Array<{ monthId: string; sheetId: string; label: string }> {
  const seen = new Map<string, { monthId: string; sheetId: string; label: string }>();
  for (const item of items) {
    const payload = item.manager;
    if (!payload) continue;
    const sheetId = payload.sheetId || (payload.kind === "sheet" ? payload.entityId : "");
    const monthId = payload.monthId || "";
    if (!sheetId || !monthId) continue;
    const key = `${monthId}::${sheetId}`;
    if (seen.has(key)) continue;
    const title =
      payload.year && payload.month ? monthLabel(payload.year, payload.month) : "Open worksheet";
    seen.set(key, { monthId, sheetId, label: title });
  }
  return [...seen.values()];
}

export function itemBelongsToSheet(item: ReviewItem, monthId: string, sheetId: string): boolean {
  const payload = item.manager;
  if (!payload) return false;
  const itemSheet = payload.sheetId || (payload.kind === "sheet" ? payload.entityId : "");
  return payload.monthId === monthId && itemSheet === sheetId;
}

export function payloadForEditedSale(base: DealPayload | null, sale: Sale, fallback: Partial<DealPayload> = {}): DealPayload {
  return {
    kind: "sale",
    entityId: base?.entityId || sale.id,
    monthId: base?.monthId ?? fallback.monthId,
    year: base?.year ?? fallback.year,
    month: base?.month ?? fallback.month,
    sheetId: base?.sheetId ?? fallback.sheetId,
    startDay: base?.startDay ?? fallback.startDay,
    endDay: base?.endDay ?? fallback.endDay,
    sale,
  };
}

export function resolutionsFromEditedSheet(
  items: ReviewItem[],
  autoResolve: ReviewResolution[],
  editedSales: Sale[],
): ReviewResolution[] {
  const decisions: ReviewResolution[] = [...autoResolve];
  for (const item of items) {
    if (!item.manager || item.manager.kind !== "sale" || !item.manager.sale) {
      decisions.push(resolutionForChoice(item, item.kind === "addition" ? "accept" : "use_manager"));
      continue;
    }
    const originalId = item.manager.sale.id;
    const originalKey = saleMatchKey(item.manager.sale);
    const edited =
      editedSales.find((sale) => sale.id === originalId) ??
      editedSales.find((sale) => saleMatchKey(sale) === originalKey);
    if (!edited) {
      decisions.push(resolutionForChoice(item, "decline"));
      continue;
    }
    const manager = payloadForEditedSale(item.manager, edited);
    if (item.kind === "addition") {
      decisions.push({ id: item.id, action: "accept", live_data: manager, previous_data: {} });
      continue;
    }
    const liveData = item.mine ? applyManagerValues(item.mine, manager) : manager;
    decisions.push({
      id: item.id,
      action: "use_manager",
      live_id: item.liveId,
      live_data: liveData,
      previous_data: item.manager,
      discard_staged: Boolean(item.liveId && item.liveId !== item.id),
    });
  }
  return decisions;
}

export function leftoverEditedSales(items: ReviewItem[], editedSales: Sale[]): Sale[] {
  const knownIds = new Set<string>();
  const knownKeys = new Set<string>();
  for (const item of items) {
    if (!item.manager?.sale) continue;
    knownIds.add(item.manager.sale.id);
    knownKeys.add(saleMatchKey(item.manager.sale));
  }
  return editedSales.filter((sale) => {
    if (knownIds.has(sale.id) || knownKeys.has(saleMatchKey(sale))) return false;
    return Boolean(sale.stockNumber.trim() || sale.customerName.trim());
  });
}
