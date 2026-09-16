import { sheetVacationPay } from "./commission.ts";
import { flattenTrackerState, type DealPayload } from "./deal-records.ts";
import { summarizeAll } from "./summaries.ts";
import type { ExtraPay, MonthRecord, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import { explicitBonuses, withExplicitBonuses } from "./worksheet-persist.ts";

export const PUSH_SUCCESS_MESSAGE =
  "Sheet pushed to the employee and their store manager. Status is Pending Employee & Manager Approval.";
export const RECALL_CONFIRM_MESSAGE =
  "Delete / Reset this push? This wipes the pending sheet, clears unread push notifications, and sets the employee back to draft so you can start over.";
export const RECALL_SUCCESS_MESSAGE = "Push deleted. The employee sheet is a draft again.";
export const DENY_SUCCESS_MESSAGE = "Changes denied. The employee can revise and submit to their manager again.";

export type EmployeePushSheet = {
  monthId: string;
  sheetId: string;
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  deals: Sale[];
  vacation_hours: number;
  hourly_rate: number;
  vacation_pay: number;
  bonuses: ExtraPay[];
};

export type EmployeePushPayload = {
  deals: Sale[];
  gross: number;
  units: number;
  trades: number;
  fi: number;
  vacation: number;
  vacation_hours: number;
  hourly_rate: number;
  vacation_pay: number;
  bonuses: ExtraPay[];
  vehicle_types: VehicleTypeOption[];
  sheets: EmployeePushSheet[];
  records: DealPayload[];
  months: MonthRecord[];
  month_id: string | null;
  employee_id?: string;
  total_pay?: number;
  pay?: number;
};

export function buildEmployeePushPayload(state: TrackerState): EmployeePushPayload {
  const normalized = withExplicitBonuses(state);
  const sheets: EmployeePushSheet[] = [];
  const deals: Sale[] = [];
  for (const month of normalized.months ?? []) {
    for (const sheet of month.sheets ?? []) {
      const sheetDeals = sheet.sales ?? [];
      deals.push(...sheetDeals);
      sheets.push({
        monthId: month.id,
        sheetId: sheet.id,
        year: month.year,
        month: month.month,
        startDay: sheet.startDay,
        endDay: sheet.endDay,
        deals: sheetDeals,
        vacation_hours: sheet.vacationHours ?? 0,
        hourly_rate: sheet.vacationRate ?? 0,
        vacation_pay: sheetVacationPay(sheet),
        bonuses: explicitBonuses(sheet.bonuses),
      });
    }
  }
  const primary = sheets[0];
  const totals = summarizeAll(normalized);
  return {
    months: normalized.months ?? [],
    deals,
    gross: totals.gross,
    units: totals.units,
    trades: totals.trades,
    fi: totals.fi,
    vacation: totals.vacation,
    total_pay: totals.pay,
    pay: totals.pay,
    vacation_hours: primary?.vacation_hours ?? 0,
    hourly_rate: primary?.hourly_rate ?? 0,
    vacation_pay: primary?.vacation_pay ?? 0,
    bonuses: explicitBonuses(primary?.bonuses),
    vehicle_types: normalized.vehicleTypes ?? [],
    sheets,
    records: flattenTrackerState(normalized),
    month_id: primary?.monthId ?? normalized.months[0]?.id ?? null,
  };
}

export function isAwaitingEmployeePush(status: string | null | undefined): boolean {
  return (
    status === "pending_rep_review" ||
    status === "staged" ||
    status === "awaiting_review" ||
    status === "pushed" ||
    status === "admin_pushed"
  );
}

export function isInFlightEmployeePush(status: string | null | undefined): boolean {
  return (
    isAwaitingEmployeePush(status) ||
    status === "rep_accepted_no_changes" ||
    status === "rep_modified" ||
    status === "pending_manager_approval" ||
    status === "manager_approved" ||
    status === "pending_admin_approval"
  );
}
