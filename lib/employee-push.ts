import { sheetVacationPay } from "./commission.ts";
import { flattenTrackerState, type DealPayload } from "./deal-records.ts";
import type { ExtraPay, Sale, TrackerState, VehicleTypeOption } from "./types.ts";

export const PUSH_SUCCESS_MESSAGE = "Worksheet pushed to employee for review.";
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
  vacation_hours: number;
  hourly_rate: number;
  vacation_pay: number;
  bonuses: ExtraPay[];
  vehicle_types: VehicleTypeOption[];
  sheets: EmployeePushSheet[];
  records: DealPayload[];
};

export function buildEmployeePushPayload(state: TrackerState): EmployeePushPayload {
  const sheets: EmployeePushSheet[] = [];
  const deals: Sale[] = [];
  for (const month of state.months ?? []) {
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
        bonuses: sheet.bonuses ?? [],
      });
    }
  }
  const primary = sheets[0];
  return {
    deals,
    vacation_hours: primary?.vacation_hours ?? 0,
    hourly_rate: primary?.hourly_rate ?? 0,
    vacation_pay: primary?.vacation_pay ?? 0,
    bonuses: primary?.bonuses ?? [],
    vehicle_types: state.vehicleTypes ?? [],
    sheets,
    records: flattenTrackerState(state),
  };
}

export function isAwaitingEmployeePush(status: string | null | undefined): boolean {
  return status === "pending_rep_review" || status === "staged";
}
