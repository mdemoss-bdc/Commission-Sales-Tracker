import {
  ADMIN_SHEET_DRAFT,
  ADMIN_SHEET_PUSHED,
  isAuthorizedAdminSheet,
  isPaidAdminSheet,
  type AdminEmployeeSheet,
} from "./admin-employee-sheets.ts";
import {
  MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL,
  PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL,
  rosterToneFromChain,
  type ApprovalChainRecord,
} from "./approval-chain.ts";
import {
  matchesPeriodKey,
  payPeriodKey,
  periodFromUnknown,
  periodsCompatible,
  rangeForSplit,
  type PayPeriodIdentity,
  type PayPeriodSplit,
} from "./pay-period.ts";
import { monthLabel } from "./records.ts";
import { daysInMonth } from "./sheet-range.ts";
import { MONTH_NAMES, type MonthRecord, type PaySheet, type TrackerState } from "./types.ts";
import { extractDealsFromSheetData, trackerHasSales, worksheetContentScore } from "./pay-tracker-state.ts";

export const ADMIN_ROSTER_NOT_STARTED_LABEL = "Not Started";
export const ADMIN_ROSTER_UNPUSHED_LABEL = "Unpushed";
export const ADMIN_ROSTER_PAID_LABEL = "PAID";
export const ADMIN_ROSTER_NO_SUBMISSION_LABEL = "No submission for this period";
export const PUSH_ALL_PAY_SHEETS_LABEL = "Push All Pay Sheets to Employees";
export const SAVE_ADMIN_DRAFT_LABEL = "Save Draft";
export const ADMIN_DRAFT_SAVED_TOAST = "Draft saved to admin ledger";
export const ADMIN_ROSTER_ADD_YEAR_LABEL = "+ Year";

export type AdminRosterPeriodStatus = "paid" | "finalized" | "awaiting" | "unpushed" | "not_started";
export type AdminRosterSplitChoice = "part1" | "part2";

export type AdminRosterPeriodOption = {
  value: string;
  label: string;
  period: PayPeriodIdentity;
};

export const ADMIN_ROSTER_SPLIT_OPTIONS: ReadonlyArray<{ value: AdminRosterSplitChoice; label: string }> = [
  { value: "part1", label: "1st–15th" },
  { value: "part2", label: "16th–end" },
];

export function adminRosterMonthOptions(): ReadonlyArray<{ value: number; label: string }> {
  return MONTH_NAMES.map((label, index) => ({ value: index + 1, label }));
}

/** Seed years around "now", merge custom extras, newest first — no hard upper/lower cap. */
export function buildAdminRosterYearOptions(
  now = new Date(),
  extras: Iterable<number> = [],
): number[] {
  const current = now.getFullYear();
  const years = new Set<number>([current - 1, current, current + 1]);
  for (const year of extras) {
    if (Number.isInteger(year) && year >= 1970 && year <= 2100) years.add(year);
  }
  return [...years].sort((left, right) => right - left);
}

export function composeAdminRosterPeriod(input: {
  year: number;
  month: number;
  split: AdminRosterSplitChoice;
}): PayPeriodIdentity {
  const year = Math.trunc(input.year);
  const month = Math.min(12, Math.max(1, Math.trunc(input.month)));
  const split: AdminRosterSplitChoice = input.split === "part2" ? "part2" : "part1";
  const key = payPeriodKey(year, month, split);
  return { year, month, split, key, raw: key };
}

export function normalizeAdminRosterSplit(split: PayPeriodSplit | null | undefined, now = new Date()): AdminRosterSplitChoice {
  if (split === "part2") return "part2";
  if (split === "part1") return "part1";
  return now.getDate() >= 16 ? "part2" : "part1";
}

export function emptyPaySheetForPeriod(period: PayPeriodIdentity): PaySheet {
  const year = period.year ?? new Date().getFullYear();
  const month = period.month ?? new Date().getMonth() + 1;
  const split: PayPeriodSplit = period.split === "part2" || period.split === "full" ? period.split : "part1";
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

export function emptyTrackerForPeriod(period: PayPeriodIdentity): TrackerState {
  const year = period.year ?? new Date().getFullYear();
  const month = period.month ?? new Date().getMonth() + 1;
  const monthId = period.key ?? payPeriodKey(year, month, period.split === "unknown" ? "part1" : period.split);
  const record: MonthRecord = {
    id: monthId,
    year,
    month,
    sheets: [emptyPaySheetForPeriod({ ...period, year, month, key: monthId })],
  };
  return { months: [record], vehicleTypes: [] };
}

export function buildAdminRosterPeriodOptions(
  now = new Date(),
  options?: { fromYear?: number; throughYear?: number },
): AdminRosterPeriodOption[] {
  const fromYear = options?.fromYear ?? 2024;
  const throughYear = options?.throughYear ?? now.getFullYear() + 1;
  const rows: AdminRosterPeriodOption[] = [];
  for (let year = throughYear; year >= fromYear; year -= 1) {
    for (let month = 12; month >= 1; month -= 1) {
      for (const split of ["part2", "part1"] as const) {
        const key = payPeriodKey(year, month, split);
        const stamp = monthLabel(year, month);
        const splitLabel = split === "part2" ? "16th–end" : "1st–15th";
        rows.push({
          value: key,
          label: `${stamp} · ${splitLabel}`,
          period: { year, month, split, key, raw: key },
        });
      }
    }
  }
  return rows;
}

export function sheetMatchesRosterPeriod(
  sheet: AdminEmployeeSheet | null | undefined,
  period: PayPeriodIdentity,
): boolean {
  if (!sheet) return false;
  if (matchesPeriodKey(sheet.periodKey, period)) return true;
  if (matchesPeriodKey(sheet.monthId, period)) return true;
  const identity = periodFromUnknown(sheet.periodKey ?? sheet.monthId ?? sheet.sheetData);
  if (identity.split === "unknown" || period.split === "unknown") return false;
  return periodsCompatible(identity, period);
}

export function chainMatchesRosterPeriod(
  chain: ApprovalChainRecord | null | undefined,
  period: PayPeriodIdentity,
): boolean {
  if (!chain) return false;
  if (matchesPeriodKey(chain.monthId, period)) return true;
  const fromBaseline = periodFromUnknown(chain.adminBaseline);
  const fromDraft = periodFromUnknown(chain.repDraft);
  return periodsCompatible(fromBaseline, period) || periodsCompatible(fromDraft, period);
}

function sheetHasPeriodContent(sheet: AdminEmployeeSheet | null | undefined): boolean {
  if (!sheet) return false;
  if (extractDealsFromSheetData(sheet.sheetData).length > 0) return true;
  if (trackerHasSales(sheet.state) || worksheetContentScore(sheet.state) > 0) return true;
  if (sheet.sheetData && typeof sheet.sheetData === "object" && !Array.isArray(sheet.sheetData)) {
    const data = sheet.sheetData as Record<string, unknown>;
    if (Array.isArray(data.bonuses) && data.bonuses.length > 0) return true;
    if (Number(data.vacation_hours ?? data.vacationHours ?? 0) > 0) return true;
    if (Number(data.vacation_pay ?? data.vacationPay ?? 0) > 0) return true;
  }
  return false;
}

export function adminPeriodRosterStatus(input: {
  sheet?: AdminEmployeeSheet | null;
  chain?: ApprovalChainRecord | null;
  period: PayPeriodIdentity;
}): AdminRosterPeriodStatus {
  const sheetMatch = sheetMatchesRosterPeriod(input.sheet, input.period);
  const chainMatch = chainMatchesRosterPeriod(input.chain, input.period);

  // PAID only for the exact selected period row.
  if (sheetMatch && isPaidAdminSheet(input.sheet?.status, input.sheet?.isPaid)) return "paid";
  if (sheetMatch && isAuthorizedAdminSheet(input.sheet?.status, input.sheet?.isPaid)) return "finalized";

  if (chainMatch) {
    const tone = rosterToneFromChain(input.chain?.status);
    if (tone === "finalized") return "finalized";
    if (tone === "awaiting" || tone === "accepted" || tone === "modified") return "awaiting";
  }

  if (sheetMatch) {
    if (input.sheet?.status === ADMIN_SHEET_PUSHED) return "awaiting";
    if (input.sheet?.status === ADMIN_SHEET_DRAFT || sheetHasPeriodContent(input.sheet)) return "unpushed";
  }

  return "not_started";
}

export function rosterPeriodSubmissionLabel(input: {
  status: AdminRosterPeriodStatus;
  sheet?: AdminEmployeeSheet | null;
}): string {
  if (input.status === "not_started" || !input.sheet) return ADMIN_ROSTER_NO_SUBMISSION_LABEL;
  return "";
}

export function adminPeriodRosterBadgeLabel(status: AdminRosterPeriodStatus): string {
  if (status === "paid") return ADMIN_ROSTER_PAID_LABEL;
  if (status === "finalized") return MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL;
  if (status === "awaiting") return PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL;
  if (status === "unpushed") return ADMIN_ROSTER_UNPUSHED_LABEL;
  return ADMIN_ROSTER_NOT_STARTED_LABEL;
}

export function adminPeriodRosterBadgeClass(status: AdminRosterPeriodStatus): string {
  if (status === "paid" || status === "finalized") return "roster-badge roster-badge-ready";
  if (status === "awaiting") return "roster-badge roster-badge-awaiting";
  if (status === "unpushed") return "roster-badge roster-badge-idle";
  return "roster-badge roster-badge-idle";
}

export function adminPeriodRowClass(status: AdminRosterPeriodStatus, selected: boolean): string {
  return [
    "roster-row",
    status === "paid" || status === "finalized" ? "roster-row-ready bg-emerald-100 border-emerald-500" : "",
    status === "awaiting" ? "roster-row-awaiting" : "",
    status === "unpushed" || status === "not_started" ? "roster-row-idle" : "",
    selected ? "roster-row-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function shouldOpenPrintForPeriodStatus(status: AdminRosterPeriodStatus): boolean {
  return status === "paid" || status === "finalized";
}

export function periodOptionValue(period: PayPeriodIdentity): string {
  return period.key ?? payPeriodKey(period.year ?? 0, period.month ?? 0, period.split === "unknown" ? "part1" : period.split);
}

/** Last day helper used by tests/UI copy. */
export function periodEndDay(period: PayPeriodIdentity): number {
  if (!period.year || !period.month) return 15;
  if (period.split === "part1") return 15;
  return daysInMonth(period.year, period.month);
}
