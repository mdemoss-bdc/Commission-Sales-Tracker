import {
  isAuthorizedAdminSheet,
  ADMIN_SHEET_FINAL_APPROVED,
  type AdminEmployeeSheet,
} from "./admin-employee-sheets.ts";
import { sheetMatchesRosterPeriod } from "./admin-roster.ts";
import type { ApprovalChainRecord } from "./approval-chain.ts";
import { assembleWorkingState, isActiveWorksheetDealRow, type DealRow } from "./deal-records.ts";
import {
  collectWorksheetDeals,
  extractDealsFromSheetData,
  pickRichestWorksheet,
  trackerFromPayTrackerFallbacks,
  trackerHasSales,
  trackerStateFromPayTrackerDocument,
  worksheetContentScore,
  type PayTrackerStateRow,
} from "./pay-tracker-state.ts";
import {
  activePayPeriod,
  matchesPeriodKey,
  mergeTrackerMonths,
  periodFromSheet,
  periodFromUnknown,
  periodsCompatible,
  pickMonthForPeriod,
  pickSheetsForPeriod,
  rangeFromPeriodIdentity,
  rangeForSplit,
  sheetHasPayrollContent,
  type PayPeriodIdentity,
} from "./pay-period.ts";
import { monthLabel } from "./records.ts";
import { sheetRangeLabel } from "./sheet-range.ts";
import type { MonthRecord, PaySheet, TrackerState } from "./types.ts";

export const PRINT_SHEET_LABEL = "Print Sheet";
export const PRINT_ALL_AUTHORIZED_LABEL = "Print All Authorized";
export const MARK_PAID_LABEL = "Mark Paid";
export const MARK_PAID_DONE_LABEL = "✓ Paid / Disbursed";
export const PAID_BADGE_LABEL = "PAID";
export const MARK_PAID_CONFIRM =
  "Are you sure you want to mark this pay sheet as PAID? This will lock the sheet and mark payroll disbursed.";

export const PRINTING_FINALIZED_CLASS = "printing-finalized";
export const PRINTING_FINALIZED_ALL_CLASS = "printing-finalized-all";
export const PRINT_ACTIVE_CLASS = "print-active";
export const PAGE_BREAK_CLASS = "page-break";
export const FINALIZED_PRINT_CARD_CLASS = "finalized-print-card";
export const FINALIZED_PRINT_BATCH_CLASS = "finalized-print-batch-card";
export const PRINT_SHEET_CONTAINER_CLASS = "print-sheet-container";

function identityForAdminSheet(sheet: AdminEmployeeSheet): PayPeriodIdentity {
  const fromMeta = periodFromUnknown(sheet.periodKey ?? sheet.monthId ?? sheet.sheetData);
  if (fromMeta.year && fromMeta.month && fromMeta.split !== "unknown") return fromMeta;
  const state = printStateFromAdminSheet(sheet) ?? sheet.state;
  const month =
    pickMonthForPeriod(state, fromMeta.year ? fromMeta : null) ??
    state?.months.find((row) => monthHasSalesSafe(row)) ??
    state?.months[0] ??
    null;
  if (!month) return fromMeta;
  const page =
    month.sheets.find((row) => (row.sales ?? []).length > 0) ??
    month.sheets[0] ??
    null;
  const fromSheet = periodFromSheet(page, month);
  if (fromSheet.split !== "unknown") return fromSheet;
  if (fromMeta.split !== "unknown") return { ...fromSheet, split: fromMeta.split, key: fromMeta.key ?? fromSheet.key };
  return fromSheet;
}

/** Prefer the sheet row's stored period (16th–end vs 1st–15th) over the calendar clock. */
export function periodFromAdminSheet(
  sheet: AdminEmployeeSheet | null | undefined,
  fallback: PayPeriodIdentity = activePayPeriod(),
): PayPeriodIdentity {
  if (!sheet) return fallback;
  const identity = identityForAdminSheet(sheet);
  if (identity.year && identity.month && identity.split !== "unknown") return identity;
  if (identity.year && identity.month) {
    return {
      ...fallback,
      year: identity.year,
      month: identity.month,
      key: identity.key ?? fallback.key,
      raw: identity.raw ?? fallback.raw,
    };
  }
  return fallback;
}

export function sheetForEmployee(
  sheets: AdminEmployeeSheet[] | null | undefined,
  employeeId: string,
  period?: PayPeriodIdentity | null,
): AdminEmployeeSheet | null {
  const mine = (sheets ?? []).filter((row) => row.employeeId === employeeId);
  if (mine.length === 0) return null;
  if (period) {
    const matched = mine.filter((row) => sheetMatchesRosterPeriod(row, period));
    if (matched.length === 0) return null;
    return (
      matched
        .slice()
        .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0] ?? null
    );
  }
  return (
    mine
      .slice()
      .sort((left, right) => {
        const leftDeals = extractDealsFromSheetData(left.sheetData).length + (trackerHasSales(left.state) ? 100 : 0);
        const rightDeals = extractDealsFromSheetData(right.sheetData).length + (trackerHasSales(right.state) ? 100 : 0);
        if (rightDeals !== leftDeals) return rightDeals - leftDeals;
        return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      })[0] ?? null
  );
}

function monthHasSalesSafe(month: MonthRecord | null | undefined): boolean {
  return Boolean(month?.sheets.some((sheet) => sheetHasPayrollContent(sheet) || (sheet.sales ?? []).length > 0));
}

export const NO_CAR_DEALS_EMPTY_NOTE = "No car deals logged for this period";

export function paySheetHasRenderableContent(sheet: PaySheet | null | undefined): boolean {
  return sheetHasPayrollContent(sheet);
}

export function trackerHasRenderableContent(state: TrackerState | null | undefined): boolean {
  return Boolean(state?.months.some((month) => month.sheets.some(sheetHasPayrollContent)));
}

/** Build a printable month/sheet skeleton for the preferred period when deals are empty but extras exist. */
export function ensurePrintablePeriodMonth(
  state: TrackerState | null | undefined,
  period: PayPeriodIdentity,
  now = new Date(),
): MonthRecord | null {
  const existing = pickMonthForPeriod(state, period, now);
  if (existing) {
    const pages = pickSheetsForPeriod(existing, period);
    if (pages.length > 0) return existing;
    if (existing.sheets.length > 0) return existing;
  }
  if (!period.year || !period.month) return existing;
  const split = period.split === "unknown" ? (now.getDate() >= 16 ? "part2" : "part1") : period.split;
  const range = rangeForSplit(split === "full" ? "full" : split, period.year, period.month);
  const seedSheet: PaySheet = {
    id: period.key ?? `sheet-${split}`,
    startDay: range.startDay,
    endDay: range.endDay,
    sales: [],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 0,
    bonuses: [],
  };
  if (existing) {
    return { ...existing, sheets: [...existing.sheets, seedSheet] };
  }
  return {
    id: period.key ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    year: period.year,
    month: period.month,
    sheets: [seedSheet],
  };
}

export function shouldShowFinalizedPrintPreview(input: {
  isAdmin: boolean;
  rosterStatus?: string | null;
  sheet?: Pick<AdminEmployeeSheet, "status" | "isPaid"> | null;
  chainStatus?: string | null;
}): boolean {
  if (!input.isAdmin) return false;
  if (input.rosterStatus === "finalized") return true;
  if (isAuthorizedAdminSheet(input.sheet?.status, input.sheet?.isPaid)) return true;
  const chain = input.chainStatus ?? "";
  return (
    chain === "admin_final_approved" ||
    chain === "approved_final" ||
    chain === "manager_approved" ||
    chain === "paid"
  );
}

export const FINALIZED_FALLBACK_DEAL_STATUSES = [
  "active",
  "approved",
  "pending_admin_approval",
  "admin_final_approved",
  "manager_approved",
  "approved_final",
  "paid",
  "pending_manager_approval",
  "rep_authorized_no_changes",
  "rep_accepted_no_changes",
  "rep_modified",
  "admin_pushed",
  "awaiting_review",
] as const;

export function filterFinalizedFallbackDealRows(
  rows: DealRow[] | null | undefined,
  employeeId: string,
): DealRow[] {
  const allowed = new Set<string>(FINALIZED_FALLBACK_DEAL_STATUSES);
  return (rows ?? []).filter(
    (row) =>
      row.rep_id === employeeId &&
      (allowed.has(row.status) || isActiveWorksheetDealRow(row)),
  );
}

export function placeholderAdminSheet(employeeId: string, sheet?: AdminEmployeeSheet | null): AdminEmployeeSheet {
  return (
    sheet ?? {
      employeeId,
      orgId: null,
      locationId: null,
      monthId: null,
      periodKey: null,
      sheetData: {},
      status: ADMIN_SHEET_FINAL_APPROVED,
      createdBy: null,
      createdAt: null,
      updatedAt: null,
      paidAt: null,
      isPaid: false,
      state: null,
    }
  );
}

export function adminSheetNeedsFallback(sheet: AdminEmployeeSheet | null | undefined): boolean {
  if (!sheet) return true;
  if (extractDealsFromSheetData(sheet.sheetData).length > 0) return false;
  const state = printStateFromAdminSheet(sheet);
  if (state && (trackerHasSales(state) || worksheetContentScore(state) > 0 || trackerHasRenderableContent(state))) {
    return false;
  }
  if (sheet.sheetData && typeof sheet.sheetData === "object" && !Array.isArray(sheet.sheetData)) {
    const data = sheet.sheetData as Record<string, unknown>;
    const vacation =
      (typeof data.vacation_hours === "number" && data.vacation_hours > 0) ||
      (typeof data.vacationHours === "number" && data.vacationHours > 0) ||
      (typeof data.vacation_pay === "number" && data.vacation_pay > 0) ||
      (typeof data.vacationPay === "number" && data.vacationPay > 0) ||
      (typeof data.hourly_rate === "number" && data.hourly_rate > 0);
    const bonuses = Array.isArray(data.bonuses) && data.bonuses.length > 0;
    if (vacation || bonuses) return false;
  }
  return true;
}

export function hydrateAdminModalWorksheet(input: {
  sheet?: AdminEmployeeSheet | null;
  employeeId: string;
  overlay?: TrackerState | null;
  dealRows?: DealRow[] | null;
  chain?: Pick<ApprovalChainRecord, "adminBaseline" | "repDraft"> | null;
  tracker?: PayTrackerStateRow | null;
  period?: PayPeriodIdentity | null;
}): AdminEmployeeSheet {
  const preferred = input.period ?? periodFromUnknown(input.sheet?.monthId ?? input.sheet?.sheetData) ?? activePayPeriod();
  const base = placeholderAdminSheet(input.employeeId, input.sheet ?? null);
  const employeeRows = filterFinalizedFallbackDealRows(input.dealRows, input.employeeId);
  const periodRows = preferDealRowsForPeriod(employeeRows, preferred);
  const fromDeals = periodRows.length ? assembleWorkingState(periodRows) : null;
  const trackerState = trackerFromPayTrackerFallbacks(input.tracker);
  const merged = mergeTrackerMonths([
    printStateFromAdminSheet(base),
    base.state,
    trackerState,
    fromDeals,
    input.overlay ?? null,
    input.chain?.repDraft ?? null,
    input.chain?.adminBaseline ?? null,
    pickRichestWorksheet([trackerState, fromDeals, input.overlay ?? null, input.chain?.repDraft ?? null]),
  ]);
  const richest = pickRichestWorksheet([merged, trackerState, fromDeals, printStateFromAdminSheet(base)]);
  const deals = [
    ...extractDealsFromSheetData(base.sheetData),
    ...collectWorksheetDeals(richest),
    ...collectWorksheetDeals(fromDeals),
    ...collectWorksheetDeals(merged),
  ].filter((sale, index, list) => list.findIndex((item) => item.id === sale.id) === index);
  const envelope =
    base.sheetData && typeof base.sheetData === "object" && !Array.isArray(base.sheetData)
      ? (base.sheetData as Record<string, unknown>)
      : {};
  const range = rangeFromPeriodIdentity(preferred);
  const rebuiltFromDeals = deals.length
    ? trackerStateFromPayTrackerDocument({
        ...envelope,
        deals,
        records: deals,
        month_id: preferred.key ?? base.monthId ?? envelope.month_id ?? envelope.monthId ?? null,
        period_id: preferred.key,
        year: preferred.year,
        month: preferred.month,
        startDay: range?.startDay,
        endDay: range?.endDay,
      })
    : null;
  const rebuiltFromExtras =
    !deals.length &&
    (Number(envelope.vacation_hours ?? envelope.vacationHours ?? 0) > 0 ||
      Number(envelope.vacation_pay ?? envelope.vacationPay ?? 0) > 0 ||
      Number(envelope.hourly_rate ?? envelope.vacationRate ?? 0) > 0 ||
      (Array.isArray(envelope.bonuses) && envelope.bonuses.length > 0))
      ? trackerStateFromPayTrackerDocument({
          ...envelope,
          deals: [],
          records: [],
          month_id: preferred.key ?? base.monthId ?? envelope.month_id ?? envelope.monthId ?? null,
          period_id: preferred.key,
          year: preferred.year,
          month: preferred.month,
          startDay: range?.startDay,
          endDay: range?.endDay,
        })
      : null;
  const rebuilt =
    (merged && (trackerHasSales(merged) || trackerHasRenderableContent(merged)) ? merged : null) ??
    (richest && (trackerHasSales(richest) || trackerHasRenderableContent(richest)) ? richest : null) ??
    rebuiltFromDeals ??
    rebuiltFromExtras ??
    merged ??
    richest;
  const monthId =
    preferred.key ??
    base.monthId ??
    pickMonthForPeriod(rebuilt, preferred)?.id ??
    rebuilt?.months[0]?.id ??
    null;
  return {
    ...base,
    monthId,
    state: rebuilt,
    sheetData: {
      ...envelope,
      deals,
      records: deals,
      month_id: monthId,
      period_id: preferred.key,
    },
  };
}

function preferDealRowsForPeriod(rows: DealRow[], period: PayPeriodIdentity): DealRow[] {
  if (rows.length === 0) return rows;
  const matching = rows.filter((row) => {
    const identity = periodFromUnknown(row.staged_data ?? row.live_data ?? row.proposed_data);
    if (!identity.year && !identity.month && identity.split === "unknown") return true;
    return periodsCompatible(identity, period);
  });
  if (matching.length > 0 && matching.some((row) => Boolean(workingPayloadHasSale(row)))) return matching;
  return rows;
}

function workingPayloadHasSale(row: DealRow): boolean {
  const payload = row.staged_data ?? row.live_data ?? row.proposed_data;
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  return data.kind === "sale" || Boolean(data.sale);
}

export function hydrateFinalizedWorksheet(
  sheet: AdminEmployeeSheet | null,
  sources: Array<TrackerState | null | undefined> = [],
): AdminEmployeeSheet | null {
  if (!sheet) return null;
  return hydrateAdminModalWorksheet({
    sheet,
    employeeId: sheet.employeeId,
    overlay: pickRichestWorksheet(sources),
  });
}

export function printStateFromAdminSheet(sheet: AdminEmployeeSheet | null): TrackerState | null {
  if (!sheet) return null;
  if (sheet.state && (worksheetContentScore(sheet.state) > 0 || trackerHasSales(sheet.state))) {
    return sheet.state;
  }
  const fromDocument = trackerStateFromPayTrackerDocument(sheet.sheetData);
  if (fromDocument && (worksheetContentScore(fromDocument) > 0 || trackerHasSales(fromDocument))) {
    return fromDocument;
  }
  const deals = extractDealsFromSheetData(sheet.sheetData);
  if (deals.length === 0) return sheet.state ?? fromDocument;
  const envelope =
    sheet.sheetData && typeof sheet.sheetData === "object" && !Array.isArray(sheet.sheetData)
      ? (sheet.sheetData as Record<string, unknown>)
      : {};
  return (
    trackerStateFromPayTrackerDocument({
      ...envelope,
      deals,
      records: deals,
      month_id: sheet.monthId ?? envelope.month_id ?? envelope.monthId ?? null,
    }) ?? sheet.state ?? fromDocument
  );
}

export function previewSheetWithFallback(
  sheet: AdminEmployeeSheet | null,
  overlay: TrackerState | null | undefined,
  extras?: {
    dealRows?: DealRow[] | null;
    chain?: Pick<ApprovalChainRecord, "adminBaseline" | "repDraft"> | null;
    tracker?: PayTrackerStateRow | null;
    employeeId?: string;
    period?: PayPeriodIdentity | null;
  },
): AdminEmployeeSheet | null {
  const employeeId = extras?.employeeId || sheet?.employeeId;
  if (!sheet && !employeeId) return null;
  return hydrateAdminModalWorksheet({
    sheet,
    employeeId: employeeId ?? "",
    overlay,
    dealRows: extras?.dealRows,
    chain: extras?.chain,
    tracker: extras?.tracker,
    period: extras?.period,
  });
}

export function authorizedAdminSheetsForLocation(input: {
  sheets: AdminEmployeeSheet[] | null | undefined;
  people: Array<{ id: string; location_id: string | null }>;
  locationId: string | null;
  period?: PayPeriodIdentity | null;
}): AdminEmployeeSheet[] {
  if (!input.locationId) return [];
  return (input.sheets ?? []).filter((sheet) => {
    if (!isAuthorizedAdminSheet(sheet.status, sheet.isPaid)) return false;
    const person = input.people.find((row) => row.id === sheet.employeeId);
    const locationId = sheet.locationId || person?.location_id || null;
    if (locationId !== input.locationId) return false;
    if (!input.period) return true;
    return sheetMatchesRosterPeriod(sheet, input.period);
  });
}

export function activePeriodMonth(
  state: TrackerState | null | undefined,
  now = new Date(),
  period?: PayPeriodIdentity | null,
): MonthRecord | null {
  return pickMonthForPeriod(state, period ?? activePayPeriod(now), now);
}

export function activePeriodSheets(
  state: TrackerState | null | undefined,
  now = new Date(),
  period?: PayPeriodIdentity | null,
): PaySheet[] {
  return pickSheetsForPeriod(activePeriodMonth(state, now, period), period ?? activePayPeriod(now));
}

export function printPeriodLabel(month: MonthRecord | null | undefined, period?: PayPeriodIdentity | null): string {
  if (!month) return "Pay period";
  const stamp = monthLabel(month.year, month.month);
  const sheet = pickSheetsForPeriod(month, period)[0] ?? month.sheets.find((row) => (row.sales ?? []).length > 0) ?? month.sheets[0];
  if (!sheet) return stamp;
  return `${stamp} · ${sheetRangeLabel(sheet.startDay, sheet.endDay, month.year, month.month)}`;
}

export function shouldPrintCard(mode: "one" | "all", cardEmployeeId: string, targetEmployeeId?: string): boolean {
  return mode === "all" || cardEmployeeId === targetEmployeeId;
}

export function formatPaidAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function printCardSelector(mode: "one" | "all"): string {
  return mode === "all" ? `.${FINALIZED_PRINT_BATCH_CLASS}` : `.${FINALIZED_PRINT_CARD_CLASS}`;
}

export function printFinalizedSheets(mode: "one" | "all", employeeId?: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const root = document.documentElement;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(printCardSelector(mode)));
  const active = cards.filter((card) =>
    shouldPrintCard(mode, card.getAttribute("data-employee-id") ?? "", employeeId),
  );
  if (active.length === 0) return false;

  root.classList.add(PRINTING_FINALIZED_CLASS);
  root.classList.toggle(PRINTING_FINALIZED_ALL_CLASS, mode === "all");
  for (const card of cards) {
    const on = active.includes(card);
    card.classList.toggle(PRINT_ACTIVE_CLASS, on);
    card.classList.remove(PAGE_BREAK_CLASS);
  }
  if (mode === "all") {
    active.forEach((card, index) => {
      if (index < active.length - 1) card.classList.add(PAGE_BREAK_CLASS);
    });
  }

  const cleanup = () => {
    root.classList.remove(PRINTING_FINALIZED_CLASS, PRINTING_FINALIZED_ALL_CLASS);
    for (const card of cards) {
      card.classList.remove(PRINT_ACTIVE_CLASS, PAGE_BREAK_CLASS);
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1500);
  return true;
}
