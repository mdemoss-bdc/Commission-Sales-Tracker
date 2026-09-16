import { activePeriodMonth } from "./admin-print.ts";
import { EMPTY_TRACKER, itemizedApprovalDiffs, reviewDeltaDisplay } from "./approval-chain.ts";
import { assembleWorkingState, isActiveWorksheetDealRow, type DealRow } from "./deal-records.ts";
import { pickRichestWorksheet } from "./pay-tracker-state.ts";
import { findMonth, findSheet } from "./records.ts";
import {
  compareExtras,
  compareSaleRows,
  extrasFromSheet,
  type ComparedSale,
  type ExtraPayHighlights,
} from "./sheet-compare.ts";
import { summarizeAll } from "./summaries.ts";
import type { MonthRecord, PaySheet, Sale, TrackerState, VehicleTypeOption } from "./types.ts";

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
  const baselineMonth = findMonth(baseline, month.id) ?? baseline.months[0] ?? null;
  if (!baselineMonth) return null;
  return findSheet(baselineMonth, sheet.id) ?? baselineMonth.sheets[0] ?? null;
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
}): ManagerReviewView {
  const baseline = input.baseline ?? EMPTY_TRACKER;
  const draft = managerReviewDraftState({
    preferred: input.draft,
    dealRows: input.dealRows,
    baseline,
  });
  const month = activePeriodMonth(draft) ?? activePeriodMonth(baseline);
  const sheets = month?.sheets ?? [];
  const vehicleTypes = [
    ...(draft.vehicleTypes ?? []),
    ...(baseline.vehicleTypes ?? []).filter(
      (type) => !(draft.vehicleTypes ?? []).some((row) => row.id === type.id),
    ),
  ];
  const sheetNotes: ManagerReviewNote[] = [];
  if (month) {
    for (const sheet of sheets) {
      sheetNotes.push(...comparedSalesForReview(matchingBaselineSheet(baseline, month, sheet), sheet).notes);
    }
  }
  return {
    baseline,
    draft,
    month,
    sheets,
    vehicleTypes,
    payDelta: reviewDeltaDisplay(summarizeAll(baseline).pay, summarizeAll(draft).pay),
    notes: compactManagerReviewNotes(sheetNotes, managerReviewChangeNotes(baseline, draft)),
    addedCount: sheetNotes.filter((note) => note.kind === "added").length,
    editedCount: sheetNotes.filter((note) => note.kind === "edited").length,
    removedCount: sheetNotes.filter((note) => note.kind === "removed").length,
  };
}
