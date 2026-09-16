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
  activePayPeriod,
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
import type { MonthRecord, PaySheet, TrackerState } from "./types.ts";
import { extractDealsFromSheetData, trackerHasSales, worksheetContentScore } from "./pay-tracker-state.ts";

export const ADMIN_ROSTER_NOT_STARTED_LABEL = "Not Started";
export const ADMIN_ROSTER_UNPUSHED_LABEL = "Unpushed";
export const ADMIN_ROSTER_PAID_LABEL = "PAID";
export const PUSH_ALL_PAY_SHEETS_LABEL = "Push All Pay Sheets to Employees";
export const SAVE_ADMIN_DRAFT_LABEL = "Save Draft";
export const ADMIN_DRAFT_SAVED_TOAST = "Draft saved to admin ledger";

export type AdminRosterPeriodStatus = "paid" | "finalized" | "awaiting" | "unpushed" | "not_started";

export type AdminRosterPeriodOption = {
  value: string;
  label: string;
  period: PayPeriodIdentity;
};

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

export function buildAdminRosterPeriodOptions(now = new Date(), monthsBack = 5): AdminRosterPeriodOption[] {
  const options: AdminRosterPeriodOption[] = [];
  for (let offset = 0; offset <= monthsBack; offset += 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    for (const split of ["part2", "part1"] as const) {
      if (offset === 0) {
        const active = activePayPeriod(now);
        if (split === "part2" && active.split === "part1") continue;
      }
      const key = payPeriodKey(year, month, split);
      const stamp = monthLabel(year, month);
      const splitLabel = split === "part2" ? "16th–end" : "1st–15th";
      options.push({
        value: key,
        label: `${stamp} · ${splitLabel}`,
        period: { year, month, split, key, raw: key },
      });
    }
  }
  return options;
}

export function sheetMatchesRosterPeriod(
  sheet: AdminEmployeeSheet | null | undefined,
  period: PayPeriodIdentity,
): boolean {
  if (!sheet) return false;
  if (matchesPeriodKey(sheet.monthId, period)) return true;
  const identity = periodFromUnknown(sheet.monthId ?? sheet.sheetData);
  if (periodsCompatible(identity, period) && identity.split !== "unknown") return true;
  if (!period.year || !period.month) return false;
  if (identity.year === period.year && identity.month === period.month && period.split === "unknown") return true;
  const state = sheet.state;
  if (!state) return false;
  return state.months.some((month) => {
    if (month.year !== period.year || month.month !== period.month) return false;
    return month.sheets.some((page) => {
      const pageSplit =
        page.startDay >= 16 ? "part2" : page.endDay <= 15 ? "part1" : "full";
      return period.split === "unknown" || period.split === "full" || pageSplit === period.split || pageSplit === "full";
    });
  });
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
