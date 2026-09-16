import { sheetVacationPay } from "./commission.ts";
import { flattenTrackerState, type DealPayload } from "./deal-records.ts";
import { summarizeAll } from "./summaries.ts";
import type { ExtraPay, MonthRecord, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import { explicitBonuses, withExplicitBonuses } from "./worksheet-persist.ts";

export const PUSH_SUCCESS_MESSAGE =
  "Worksheet pushed to the sales rep and their store manager. The rep can Accept or submit changes; the manager roster shows Awaiting Rep Action.";
export const RECALL_CONFIRM_MESSAGE =
  "Recall this push? This will pull the sheet back from the employee so you can edit and repush.";
export const RECALL_SUCCESS_MESSAGE = "Push recalled. The worksheet is a draft again.";

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
