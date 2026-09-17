import { assembleStagedState, isPayload, managerPushPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { sheetVacationPay, vacationPayAmount } from "./commission.ts";
import { managerBufferTotalsFromDocument } from "./pay-tracker-state.ts";
import { findMonth, findSheet, mapMonth, mapSheet, monthLabel } from "./records.ts";
import {
  applyManagerValues,
  classifyReviewItems,
  isAwaitingRepReview,
  resolutionForChoice,
  type ReviewItem,
  type ReviewResolution,
} from "./rep-review.ts";
import { emptyTotals, summarizeAll, summarizeSheet } from "./summaries.ts";
import type { ExtraPay, PaySheet, Sale, Totals, TrackerState, VehicleTypeOption } from "./types.ts";
import { explicitBonuses } from "./worksheet-persist.ts";

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

export type ExtraPaySnapshot = {
  vacationHours: number;
  vacationRate: number;
  vacationPay: number;
  bonuses: ExtraPay[];
};

export type ExtraPayHighlights = {
  hours: boolean;
  rate: boolean;
  pay: boolean;
  bonusIds: Set<string>;
};

export function extrasFromSheet(sheet: PaySheet | null | undefined): ExtraPaySnapshot {
  return {
    vacationHours: sheet?.vacationHours ?? 0,
    vacationRate: sheet?.vacationRate ?? 0,
    vacationPay: sheet ? sheetVacationPay(sheet) : 0,
    bonuses: explicitBonuses(sheet?.bonuses),
  };
}

export function extrasFromPayload(payload: DealPayload | null | undefined): ExtraPaySnapshot {
  const hours = payload?.vacationHours ?? payload?.vacation_hours ?? 0;
  const rate = payload?.vacationRate ?? payload?.vacation_rate ?? 0;
  const fallback = payload?.vacationPay ?? payload?.vacation_pay ?? 0;
  return {
    vacationHours: hours,
    vacationRate: rate,
    vacationPay: vacationPayAmount(hours, rate, fallback),
    bonuses: explicitBonuses(payload?.bonuses),
  };
}

export function mergeVehicleTypes(live: VehicleTypeOption[], pushed: VehicleTypeOption[]): VehicleTypeOption[] {
  const merged = [...live];
  for (const type of pushed) {
    const label = type.label.trim().toLowerCase();
    if (merged.some((row) => row.id === type.id || row.label.trim().toLowerCase() === label)) continue;
    merged.push(type);
  }
  return merged;
}

export function bonusMatchKey(bonus: ExtraPay): string {
  const label = bonus.label.trim().toLowerCase();
  if (label) return `label:${label}`;
  return `id:${bonus.id}`;
}

export function compareExtras(live: ExtraPaySnapshot, pushed: ExtraPaySnapshot): {
  live: ExtraPayHighlights;
  pushed: ExtraPayHighlights;
} {
  const livePay = vacationPayAmount(live.vacationHours, live.vacationRate, live.vacationPay);
  const pushedPay = vacationPayAmount(pushed.vacationHours, pushed.vacationRate, pushed.vacationPay);
  const hours = live.vacationHours !== pushed.vacationHours;
  const rate = live.vacationRate !== pushed.vacationRate;
  const pay = livePay !== pushedPay;
  const liveByKey = new Map(live.bonuses.map((bonus) => [bonusMatchKey(bonus), bonus]));
  const pushedByKey = new Map(pushed.bonuses.map((bonus) => [bonusMatchKey(bonus), bonus]));
  const liveBonusIds = new Set<string>();
  const pushedBonusIds = new Set<string>();
  for (const bonus of live.bonuses) {
    const match = pushedByKey.get(bonusMatchKey(bonus)) ?? pushed.bonuses.find((row) => row.id === bonus.id);
    if (!match || match.amount !== bonus.amount || match.label.trim() !== bonus.label.trim()) {
      liveBonusIds.add(bonus.id);
    }
  }
  for (const bonus of pushed.bonuses) {
    const match = liveByKey.get(bonusMatchKey(bonus)) ?? live.bonuses.find((row) => row.id === bonus.id);
    if (!match || match.amount !== bonus.amount || match.label.trim() !== bonus.label.trim()) {
      pushedBonusIds.add(bonus.id);
    }
  }
  return {
    live: { hours, rate, pay, bonusIds: liveBonusIds },
    pushed: { hours, rate, pay, bonusIds: pushedBonusIds },
  };
}

export function stagedVehicleTypes(rows: DealRow[]): VehicleTypeOption[] {
  const pending = rows.filter((row) => isAwaitingRepReview(row.status) && Boolean(managerPushPayload(row)));
  return assembleStagedState(pending).vehicleTypes ?? [];
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
  const pending = rows.filter((row) => isAwaitingRepReview(row.status) && Boolean(managerPushPayload(row)));
  return findMonth(assembleStagedState(pending), monthId) ?? null;
}

export function stagedSheetFor(rows: DealRow[], monthId: string, sheetId: string): PaySheet | null {
  const month = stagedMonthFor(rows, monthId);
  if (!month) return null;
  return findSheet(month, sheetId) ?? null;
}

export function emptyPaySheet(sheetId: string): PaySheet {
  return {
    id: sheetId,
    startDay: 1,
    endDay: 15,
    sales: [],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 0,
    bonuses: [],
  };
}

export function sheetFromTracker(
  state: TrackerState | null | undefined,
  monthId: string,
  sheetId: string,
): PaySheet | null {
  if (!state) return null;
  const month = findMonth(state, monthId) ?? state.months[0] ?? null;
  if (!month) return null;
  const exact = findSheet(month, sheetId);
  if (exact && (exact.sales ?? []).length > 0) return exact;
  const withSales =
    month.sheets.find((sheet) => (sheet.sales ?? []).length > 0) ??
    state.months.flatMap((item) => item.sheets).find((sheet) => (sheet.sales ?? []).length > 0);
  return withSales ?? exact ?? month.sheets[0] ?? null;
}

export function paySheetFromParts(
  sheetId: string,
  sales: Sale[],
  extras: ExtraPaySnapshot,
  range?: { startDay?: number; endDay?: number },
): PaySheet {
  return {
    id: sheetId,
    startDay: range?.startDay ?? 1,
    endDay: range?.endDay ?? 15,
    sales,
    vacationHours: extras.vacationHours,
    vacationRate: extras.vacationRate,
    vacationPay: extras.vacationPay,
    bonuses: extras.bonuses,
  };
}

export function managerSheetHasEdits(sheet: PaySheet | null | undefined): boolean {
  if (!sheet) return false;
  return (sheet.sales ?? []).length > 0 || (sheet.bonuses ?? []).length > 0 || Boolean(sheet.vacationHours);
}

export function resolvedStagedSheetFor(rows: DealRow[], monthId: string, sheetId: string): PaySheet | null {
  const pending = rows.filter((row) => isAwaitingRepReview(row.status) && Boolean(managerPushPayload(row)));
  if (pending.length === 0) return null;
  const staged = assembleStagedState(pending);
  const month = findMonth(staged, monthId) ?? staged.months[0] ?? null;
  if (!month) return stagedSheetFor(pending, monthId, sheetId);
  const exact = findSheet(month, sheetId);
  if (exact && managerSheetHasEdits(exact)) return exact;
  const withContent =
    month.sheets.find((sheet) => managerSheetHasEdits(sheet)) ??
    staged.months.flatMap((item) => item.sheets).find((sheet) => managerSheetHasEdits(sheet));
  return withContent ?? null;
}

export function coalesceBufferTotals(
  ...groups: Array<Pick<Totals, "units" | "trades" | "gross" | "pay"> | null | undefined>
): Pick<Totals, "units" | "trades" | "gross" | "pay"> {
  const result = { units: 0, trades: 0, gross: 0, pay: 0 };
  for (const group of groups) {
    if (!group) continue;
    if (!result.units && group.units) result.units = group.units;
    if (!result.trades && group.trades) result.trades = group.trades;
    if (!result.gross && group.gross) result.gross = group.gross;
    if (!result.pay && group.pay) result.pay = group.pay;
  }
  return result;
}

export function managerBufferTotalsFromRows(rows: DealRow[], monthId?: string, sheetId?: string): Totals {
  const sheet = resolvedStagedSheetFor(rows, monthId || "", sheetId || "");
  const fromSheet = summarizeSheet(sheet);
  const fromAll = summarizeAll(assembleStagedState(rows));
  let fromPayload = emptyTotals();
  for (const row of rows) {
    const data = managerPushPayload(row) ?? row.staged_data;
    if (!data || typeof data !== "object") continue;
    const extracted = managerBufferTotalsFromDocument(data);
    if (extracted.units || extracted.trades || extracted.gross || extracted.pay) {
      fromPayload = extracted;
      break;
    }
  }
  const picked = coalesceBufferTotals(fromSheet, fromAll, fromPayload);
  return { ...fromSheet, ...fromAll, ...picked };
}

export type ReviewSheetTarget = {
  monthId: string;
  sheetId: string;
  label: string;
  year?: number;
  month?: number;
};

export function reviewSheetTargets(items: ReviewItem[]): ReviewSheetTarget[] {
  const seen = new Map<string, ReviewSheetTarget>();
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
    seen.set(key, {
      monthId,
      sheetId,
      label: title,
      year: payload.year,
      month: payload.month,
    });
  }
  return [...seen.values()];
}

export function reviewTargetsFromRows(rows: DealRow[]): ReviewSheetTarget[] {
  const classified = classifyReviewItems(rows);
  const seen = new Map<string, ReviewSheetTarget>();
  for (const target of reviewSheetTargets(classified.items)) {
    seen.set(`${target.monthId}::${target.sheetId}`, target);
  }
  const pending = rows.filter((row) => isAwaitingRepReview(row.status) && Boolean(managerPushPayload(row)));
  const staged = assembleStagedState(pending);
  for (const month of staged.months ?? []) {
    for (const sheet of month.sheets ?? []) {
      const key = `${month.id}::${sheet.id}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        monthId: month.id,
        sheetId: sheet.id,
        label: monthLabel(month.year, month.month),
        year: month.year,
        month: month.month,
      });
    }
  }
  return [...seen.values()];
}

export function hasActiveRepPush(rows: DealRow[]): boolean {
  return rows.some((row) => isAwaitingRepReview(row.status) && Boolean(managerPushPayload(row)));
}

export function fallbackReviewTarget(
  state: { months?: Array<{ id: string; year: number; month: number; sheets: Array<{ id: string }> }> },
  monthId?: string | null,
): ReviewSheetTarget {
  const months = state.months ?? [];
  const month = (monthId ? months.find((row) => row.id === monthId) : undefined) ?? months[0];
  const sheet = month?.sheets?.[0];
  if (month && sheet) {
    return {
      monthId: month.id,
      sheetId: sheet.id,
      label: monthLabel(month.year, month.month),
      year: month.year,
      month: month.month,
    };
  }
  return {
    monthId: monthId || "pending-month",
    sheetId: "pending-sheet",
    label: "Pushed pay sheet",
  };
}

export function resolveReviewTarget(
  targets: ReviewSheetTarget[],
  state: { months?: Array<{ id: string; year: number; month: number; sheets: Array<{ id: string }> }> },
  monthId?: string | null,
): ReviewSheetTarget {
  if (monthId) {
    const match = targets.find((target) => target.monthId === monthId);
    if (match) return match;
  }
  return targets[0] ?? fallbackReviewTarget(state, monthId);
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

export function payloadForEditedSheet(
  base: DealPayload | null,
  extras: ExtraPaySnapshot,
  fallback: Partial<DealPayload> = {},
): DealPayload {
  const vacationPay = vacationPayAmount(extras.vacationHours, extras.vacationRate, extras.vacationPay);
  const sheetId = base?.sheetId || base?.entityId || fallback.sheetId || fallback.entityId || "";
  return {
    kind: "sheet",
    entityId: base?.entityId || sheetId,
    monthId: base?.monthId ?? fallback.monthId,
    year: base?.year ?? fallback.year,
    month: base?.month ?? fallback.month,
    sheetId,
    startDay: base?.startDay ?? fallback.startDay,
    endDay: base?.endDay ?? fallback.endDay,
    vacationHours: extras.vacationHours,
    vacationRate: extras.vacationRate,
    vacationPay,
    vacation_hours: extras.vacationHours,
    vacation_rate: extras.vacationRate,
    vacation_pay: vacationPay,
    bonuses: extras.bonuses,
  };
}

export function leftoverEditedSheet(
  items: ReviewItem[],
  extras: ExtraPaySnapshot,
  fallback: Partial<DealPayload> = {},
): DealPayload | null {
  if (items.some((item) => item.manager?.kind === "sheet")) return null;
  return payloadForEditedSheet(null, extras, fallback);
}

export function resolutionsFromEditedSheet(
  items: ReviewItem[],
  autoResolve: ReviewResolution[],
  editedSales: Sale[],
  editedExtras?: ExtraPaySnapshot | null,
): ReviewResolution[] {
  const handledIds = new Set(items.map((item) => item.id));
  const decisions: ReviewResolution[] = autoResolve.filter((decision) => !handledIds.has(decision.id));
  for (const item of items) {
    if (item.manager?.kind === "sheet" && editedExtras) {
      const manager = payloadForEditedSheet(item.manager, editedExtras);
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
      continue;
    }
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

export function acceptPushedSheetSubmit(
  rows: DealRow[],
  monthId: string,
  sheetId: string,
): { decisions: ReviewResolution[]; leftovers: DealPayload[] } {
  const classified = classifyReviewItems(rows);
  const items = classified.items.filter(
    (item) => itemBelongsToSheet(item, monthId, sheetId) || item.manager?.kind === "vehicle_type",
  );
  const pushedSheet = stagedSheetFor(rows, monthId, sheetId);
  const pushedMonth = stagedMonthFor(rows, monthId);
  const editedSales = pushedSheet?.sales.length
    ? pushedSheet.sales
    : items.map((item) => item.manager?.sale).filter((sale): sale is Sale => Boolean(sale));
  const extras = extrasFromSheet(pushedSheet);
  const fallback: Partial<DealPayload> = {
    monthId,
    sheetId,
    entityId: sheetId,
    year: pushedMonth?.year,
    month: pushedMonth?.month,
    startDay: pushedSheet?.startDay,
    endDay: pushedSheet?.endDay,
  };
  const leftoverSheet = leftoverEditedSheet(items, extras, fallback);
  return {
    decisions: resolutionsFromEditedSheet(items, classified.autoResolve, editedSales, extras),
    leftovers: [
      ...leftoverEditedSales(items, editedSales).map((sale) => payloadForEditedSale(null, sale, fallback)),
      ...(leftoverSheet ? [leftoverSheet] : []),
    ],
  };
}

export function disputePushedSheetSubmit(
  rows: DealRow[],
  monthId: string,
  sheetId: string,
): { decisions: ReviewResolution[]; ids: string[] } {
  const classified = classifyReviewItems(rows);
  const items = classified.items.filter(
    (item) => itemBelongsToSheet(item, monthId, sheetId) || item.manager?.kind === "vehicle_type",
  );
  const handledIds = new Set(items.map((item) => item.id));
  const decisions: ReviewResolution[] = classified.autoResolve.filter((decision) => !handledIds.has(decision.id));
  for (const item of items) {
    decisions.push(resolutionForChoice(item, item.kind === "addition" ? "decline" : "keep_mine"));
  }
  const ids = [
    ...items.map((item) => item.id),
    ...rows.filter((row) => isAwaitingRepReview(row.status)).map((row) => row.id),
  ];
  return { decisions, ids: [...new Set(ids)] };
}

function copyPaySheet(sheet: PaySheet, sheetId: string): PaySheet {
  return {
    ...sheet,
    id: sheetId,
    sales: [...(sheet.sales ?? [])],
    bonuses: [...explicitBonuses(sheet.bonuses)],
  };
}

export function applyManagerSheetToState(
  state: TrackerState,
  monthId: string,
  sheetId: string,
  managerSheet: PaySheet,
  meta?: { year?: number; month?: number },
): TrackerState {
  const nextSheet = copyPaySheet(managerSheet, sheetId);
  if (!findMonth(state, monthId)) {
    return {
      ...state,
      months: [
        ...state.months,
        {
          id: monthId,
          year: meta?.year ?? 0,
          month: meta?.month ?? 1,
          sheets: [nextSheet],
        },
      ],
    };
  }
  const month = findMonth(state, monthId);
  if (month && !findSheet(month, sheetId)) {
    return mapMonth(state, monthId, (current) => ({
      ...current,
      sheets: [...current.sheets, nextSheet],
    }));
  }
  return mapSheet(state, monthId, sheetId, () => nextSheet);
}
