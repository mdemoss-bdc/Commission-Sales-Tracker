import { EMPTY_TRACKER, itemizedApprovalDiffs, reviewDeltaDisplay } from "./approval-chain.ts";
import { assembleWorkingState, isActiveWorksheetDealRow, type DealRow } from "./deal-records.ts";
import { pickRichestWorksheet } from "./pay-tracker-state.ts";
import {
  activePayPeriod,
  periodFromUnknown,
  pickMonthForPeriod,
  pickSheetsForPeriod,
  periodFromSheet,
  periodsCompatible,
  rangeForSplit,
  sheetHasPayrollContent,
  type PayPeriodIdentity,
} from "./pay-period.ts";
import { findMonth, findSheet } from "./records.ts";
import {
  compareExtras,
  compareSaleRows,
  extrasFromSheet,
  type ComparedSale,
  type ExtraPayHighlights,
} from "./sheet-compare.ts";
import { summarizeSheet } from "./summaries.ts";
import type { MonthRecord, PaySheet, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import { roundMoney } from "./commission.ts";

export type ManagerReviewChangeKind = "added" | "edited" | "removed";

export type ManagerReviewNote = {
  kind: ManagerReviewChangeKind;
  summary: string;
};

export type ManagerReviewSheetDiff = {
  sales: Sale[];
  compared: ComparedSale[];
  extras: ExtraPayHighlights;
  notes: ManagerReviewNote[];
};

export function matchingBaselineSheet(
  baseline: TrackerState | null | undefined,
  month: MonthRecord,
  sheet: PaySheet,
): PaySheet | null {
  if (!baseline) return null;
  const period = periodFromSheet(sheet, month);
  const baselineMonth =
    findMonth(baseline, month.id) ??
    pickMonthForPeriod(baseline, period) ??
    baseline.months.find((row) => row.year === month.year && row.month === month.month) ??
    baseline.months[0] ??
    null;
  if (!baselineMonth) return null;
  return (
    findSheet(baselineMonth, sheet.id) ??
    pickSheetsForPeriod(baselineMonth, period)[0] ??
    baselineMonth.sheets[0] ??
    null
  );
}

export function comparedSalesForReview(
  baselineSheet: PaySheet | null | undefined,
  draftSheet: PaySheet,
): ManagerReviewSheetDiff {
  const live = baselineSheet?.sales ?? [];
  const draft = draftSheet.sales ?? [];
  const compared = compareSaleRows(live, draft);
  const removed = compared.live.filter((row) => row.kind === "missing");
  const extras = compareExtras(extrasFromSheet(baselineSheet), extrasFromSheet(draftSheet)).pushed;
  const notes: ManagerReviewNote[] = [];
  for (const row of compared.manager) {
    if (row.kind === "extra") {
      notes.push({
        kind: "added",
        summary: `Added Stock #${row.sale.stockNumber || "—"} ${row.sale.customerName || ""}`.trim(),
      });
    } else if (row.kind === "matched" && row.fields.length > 0) {
      notes.push({
        kind: "edited",
        summary: `Stock #${row.sale.stockNumber || "—"} updated (${row.fields.join(", ")})`,
      });
    }
  }
  for (const row of removed) {
    notes.push({
      kind: "removed",
      summary: `Removed Stock #${row.sale.stockNumber || "—"} ${row.sale.customerName || ""}`.trim(),
    });
  }
  if (extras.hours || extras.rate || extras.pay) {
    notes.push({ kind: "edited", summary: "Vacation hours or hourly rate changed" });
  }
  if (extras.bonusIds.size > 0) {
    notes.push({ kind: "edited", summary: "Spiff / bonus amounts changed" });
  }
  return {
    sales: [...draft, ...removed.map((row) => row.sale)],
    compared: [...compared.manager, ...removed],
    extras,
    notes,
  };
}

export function managerReviewDraftState(input: {
  preferred?: TrackerState | null;
  dealRows?: DealRow[] | null;
  baseline?: TrackerState | null;
}): TrackerState {
  const activeRows = (input.dealRows ?? []).filter(isActiveWorksheetDealRow);
  return (
    pickRichestWorksheet([
      input.preferred,
      activeRows.length ? assembleWorkingState(activeRows) : null,
      input.baseline,
    ]) ?? EMPTY_TRACKER
  );
}

export function managerReviewChangeNotes(baseline: TrackerState, draft: TrackerState): string[] {
  return itemizedApprovalDiffs(baseline, draft)
    .filter((line) => line.kind !== "total")
    .map((line) => line.summary);
}

export function compactManagerReviewNotes(notes: ManagerReviewNote[], fallback: string[]): string[] {
  const compact = notes.map((note) => note.summary);
  return compact.length > 0 ? compact : fallback;
}

/**
 * Pay totals for the same sheets shown in the review print table —
 * never summarizeAll() across other half-months or ghost deal rows.
 */
export function reviewSheetPayTotals(input: {
  month: MonthRecord | null;
  sheets: PaySheet[];
  baseline: TrackerState;
}): { employeePay: number; adminPay: number } {
  let employeePay = 0;
  let adminPay = 0;
  for (const sheet of input.sheets) {
    employeePay += summarizeSheet(sheet).pay;
    const baselineSheet = input.month ? matchingBaselineSheet(input.baseline, input.month, sheet) : null;
    adminPay += summarizeSheet(baselineSheet).pay;
  }
  return {
    employeePay: roundMoney(employeePay),
    adminPay: roundMoney(adminPay),
  };
}

/** Sheets for the review period only — no fallback to other months' ghost deals. */
export function reviewSheetsForPeriod(
  month: MonthRecord | null | undefined,
  preferred: PayPeriodIdentity,
): PaySheet[] {
  const sheets = month?.sheets ?? [];
  if (!month || sheets.length === 0) return [];
  const matching = sheets.filter((sheet) => periodsCompatible(periodFromSheet(sheet, month), preferred));
  const withContent = matching.filter(sheetHasPayrollContent);
  if (withContent.length > 0) return withContent;
  if (matching.length > 0) return matching;
  // Same calendar month only: prefer any content sheet in that month for this half.
  const sameMonthContent = sheets.filter(sheetHasPayrollContent);
  if (sameMonthContent.length > 0 && month.year === preferred.year && month.month === preferred.month) {
    return sameMonthContent;
  }
  return [];
}

function emptyReviewSheet(period: PayPeriodIdentity): PaySheet {
  const year = period.year ?? new Date().getFullYear();
  const month = period.month ?? new Date().getMonth() + 1;
  const split = period.split === "part2" || period.split === "full" ? period.split : "part1";
  const range = rangeForSplit(split, year, month);
  return {
    id: period.key ?? `sheet-${split}`,
    startDay: range.startDay,
    endDay: range.endDay,
    sales: [],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 0,
    bonuses: [],
  };
}

export type ManagerReviewView = {
  baseline: TrackerState;
  draft: TrackerState;
  month: MonthRecord | null;
  sheets: PaySheet[];
  vehicleTypes: VehicleTypeOption[];
  payDelta: ReturnType<typeof reviewDeltaDisplay>;
  notes: string[];
  addedCount: number;
  editedCount: number;
  removedCount: number;
};

export function buildManagerReviewView(input: {
  baseline?: TrackerState | null;
  draft?: TrackerState | null;
  dealRows?: DealRow[] | null;
  /** Prefer the chain / submission period so delta matches the printed sheet. */
  period?: PayPeriodIdentity | string | null;
}): ManagerReviewView {
  const baseline = input.baseline ?? EMPTY_TRACKER;
  const draft = managerReviewDraftState({
    preferred: input.draft,
    dealRows: input.dealRows,
    baseline,
  });
  const preferred =
    (typeof input.period === "string" && input.period.trim()
      ? periodFromUnknown(input.period)
      : input.period && typeof input.period === "object"
        ? input.period
        : null) ??
    periodFromUnknown(
      draft.months.find((month) => month.sheets.some(sheetHasPayrollContent))?.id ??
        baseline.months.find((month) => month.sheets.some(sheetHasPayrollContent))?.id ??
        "",
    );
  const period =
    preferred.key || (preferred.year && preferred.month)
      ? preferred
      : activePayPeriod();

  const monthId = period.key ?? period.raw ?? null;
  const month =
    (monthId
      ? draft.months.find((row) => row.id === monthId) ??
        baseline.months.find((row) => row.id === monthId)
      : null) ??
    (period.year && period.month
      ? draft.months.find((row) => row.year === period.year && row.month === period.month) ??
        baseline.months.find((row) => row.year === period.year && row.month === period.month)
      : null) ??
    pickMonthForPeriod(draft, period) ??
    pickMonthForPeriod(baseline, period) ??
    null;

  let sheets = reviewSheetsForPeriod(month, period);
  if (sheets.length === 0 && month) {
    // Still show the period shell so vacation-only rows on a soft-matched half are counted.
    const sameMonth = (month.sheets ?? []).filter(
      (sheet) =>
        sheetHasPayrollContent(sheet) &&
        periodFromSheet(sheet, month).year === period.year &&
        periodFromSheet(sheet, month).month === period.month,
    );
    sheets = sameMonth.length > 0 ? sameMonth : [emptyReviewSheet(period)];
  } else if (sheets.length === 0) {
    sheets = [emptyReviewSheet(period)];
  }

  const vehicleTypes = [
    ...(draft.vehicleTypes ?? []),
    ...(baseline.vehicleTypes ?? []).filter(
      (type) => !(draft.vehicleTypes ?? []).some((row) => row.id === type.id),
    ),
  ];
  const sheetNotes: ManagerReviewNote[] = [];
  if (month) {
    for (const sheet of sheets) {
      if (sheet.id === emptyReviewSheet(period).id && (sheet.sales ?? []).length === 0) continue;
      sheetNotes.push(...comparedSalesForReview(matchingBaselineSheet(baseline, month, sheet), sheet).notes);
    }
  }
  const { employeePay, adminPay } = reviewSheetPayTotals({ month, sheets, baseline });
  return {
    baseline,
    draft,
    month,
    sheets,
    vehicleTypes,
    payDelta: reviewDeltaDisplay(adminPay, employeePay),
    notes: compactManagerReviewNotes(sheetNotes, managerReviewChangeNotes(baseline, draft)),
    addedCount: sheetNotes.filter((note) => note.kind === "added").length,
    editedCount: sheetNotes.filter((note) => note.kind === "edited").length,
    removedCount: sheetNotes.filter((note) => note.kind === "removed").length,
  };
}
