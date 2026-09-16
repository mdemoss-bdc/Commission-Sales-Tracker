import {
  isAuthorizedAdminSheet,
  type AdminEmployeeSheet,
} from "./admin-employee-sheets.ts";
import type { ApprovalChainRecord } from "./approval-chain.ts";
import { assembleWorkingState, isActiveWorksheetDealRow, type DealRow } from "./deal-records.ts";
import { extractDealsFromSheetData, pickRichestWorksheet, trackerHasSales, trackerStateFromPayTrackerDocument, worksheetContentScore } from "./pay-tracker-state.ts";
import { currentMonth, currentYear, sortMonths } from "./records.ts";
import type { MonthRecord, PaySheet, TrackerState } from "./types.ts";

export const PRINT_SHEET_LABEL = "Print Sheet";
export const PRINT_ALL_AUTHORIZED_LABEL = "Print All Authorized";
export const MARK_PAID_LABEL = "Mark Paid";
export const PAID_BADGE_LABEL = "PAID";
export const MARK_PAID_CONFIRM =
  "Are you sure you want to mark this pay sheet as PAID? This will lock the sheet and mark payroll disbursed.";

export const PRINTING_FINALIZED_CLASS = "printing-finalized";
export const PRINT_ACTIVE_CLASS = "print-active";
export const PAGE_BREAK_CLASS = "page-break";
export const FINALIZED_PRINT_CARD_CLASS = "finalized-print-card";

export function sheetForEmployee(
  sheets: AdminEmployeeSheet[] | null | undefined,
  employeeId: string,
): AdminEmployeeSheet | null {
  return (sheets ?? []).find((row) => row.employeeId === employeeId) ?? null;
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

export function finalizedPrintSources(input: {
  overlay?: TrackerState | null;
  dealRows?: DealRow[] | null;
  chain?: Pick<ApprovalChainRecord, "adminBaseline" | "repDraft"> | null;
}): Array<TrackerState | null> {
  const activeRows = (input.dealRows ?? []).filter(isActiveWorksheetDealRow);
  return [
    input.overlay ?? null,
    activeRows.length ? assembleWorkingState(activeRows) : null,
    input.chain?.repDraft ?? null,
    input.chain?.adminBaseline ?? null,
  ];
}

export function hydrateFinalizedWorksheet(
  sheet: AdminEmployeeSheet | null,
  sources: Array<TrackerState | null | undefined> = [],
): AdminEmployeeSheet | null {
  if (!sheet) return null;
  const fromSheet = printStateFromAdminSheet(sheet);
  if (fromSheet && (worksheetContentScore(fromSheet) > 0 || trackerHasSales(fromSheet))) {
    return { ...sheet, state: fromSheet };
  }
  if (worksheetContentScore(sheet.state) > 0) return sheet;
  const richest = pickRichestWorksheet(sources);
  if (!richest) return fromSheet ? { ...sheet, state: fromSheet } : sheet;
  return { ...sheet, state: richest };
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
  },
): AdminEmployeeSheet | null {
  return hydrateFinalizedWorksheet(
    sheet,
    finalizedPrintSources({
      overlay,
      dealRows: extras?.dealRows,
      chain: extras?.chain,
    }),
  );
}

export function authorizedAdminSheetsForLocation(input: {
  sheets: AdminEmployeeSheet[] | null | undefined;
  people: Array<{ id: string; location_id: string | null }>;
  locationId: string | null;
}): AdminEmployeeSheet[] {
  if (!input.locationId) return [];
  return (input.sheets ?? []).filter((sheet) => {
    if (!isAuthorizedAdminSheet(sheet.status, sheet.isPaid)) return false;
    const person = input.people.find((row) => row.id === sheet.employeeId);
    const locationId = sheet.locationId || person?.location_id || null;
    return locationId === input.locationId;
  });
}

export function activePeriodMonth(
  state: TrackerState | null | undefined,
  now = new Date(),
): MonthRecord | null {
  const months = sortMonths(state?.months ?? []);
  if (months.length === 0) return null;
  const year = currentYear(now);
  const month = currentMonth(now);
  return months.find((row) => row.year === year && row.month === month) ?? months[0] ?? null;
}

export function activePeriodSheets(
  state: TrackerState | null | undefined,
  now = new Date(),
): PaySheet[] {
  return activePeriodMonth(state, now)?.sheets ?? [];
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

export function printFinalizedSheets(mode: "one" | "all", employeeId?: string): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const root = document.documentElement;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(`.${FINALIZED_PRINT_CARD_CLASS}`));
  const active = cards.filter((card) =>
    shouldPrintCard(mode, card.getAttribute("data-employee-id") ?? "", employeeId),
  );
  if (active.length === 0) return false;

  root.classList.add(PRINTING_FINALIZED_CLASS);
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
    root.classList.remove(PRINTING_FINALIZED_CLASS);
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
