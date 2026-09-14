import { sortMonths } from "./records.ts";
import type { ExtraPay, MonthRecord, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import type { RecordStatus } from "./roles.ts";

export type DealKind = "sale" | "sheet" | "vehicle_type";

export type DealPayload = {
  kind: DealKind;
  entityId: string;
  monthId?: string;
  year?: number;
  month?: number;
  sheetId?: string;
  startDay?: number;
  endDay?: number;
  sale?: Sale;
  vacationPay?: number;
  bonuses?: ExtraPay[];
  vehicleType?: VehicleTypeOption;
};

export type DealRow = {
  id: string;
  rep_id: string;
  location_id: string | null;
  created_by: string;
  status: RecordStatus;
  staged_data: DealPayload | Record<string, never>;
  live_data: DealPayload | Record<string, never>;
  rep_notes: string | null;
};

function isPayload(value: unknown): value is DealPayload {
  if (!value || typeof value !== "object") return false;
  const row = value as DealPayload;
  return (row.kind === "sale" || row.kind === "sheet" || row.kind === "vehicle_type") && Boolean(row.entityId);
}

export function payloadKey(payload: DealPayload): string {
  return `${payload.kind}:${payload.entityId}`;
}

export function workingPayload(row: Pick<DealRow, "staged_data" | "live_data">): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  if (isPayload(row.live_data)) return row.live_data;
  return null;
}

export function flattenTrackerState(state: TrackerState): DealPayload[] {
  const rows: DealPayload[] = [];
  for (const type of state.vehicleTypes ?? []) {
    rows.push({ kind: "vehicle_type", entityId: type.id, vehicleType: type });
  }
  for (const month of state.months ?? []) {
    for (const sheet of month.sheets ?? []) {
      rows.push({
        kind: "sheet",
        entityId: sheet.id,
        monthId: month.id,
        year: month.year,
        month: month.month,
        sheetId: sheet.id,
        startDay: sheet.startDay,
        endDay: sheet.endDay,
        vacationPay: sheet.vacationPay,
        bonuses: sheet.bonuses,
      });
      for (const sale of sheet.sales ?? []) {
        rows.push({
          kind: "sale",
          entityId: sale.id,
          monthId: month.id,
          year: month.year,
          month: month.month,
          sheetId: sheet.id,
          startDay: sheet.startDay,
          endDay: sheet.endDay,
          sale,
        });
      }
    }
  }
  return rows;
}

export function assembleTrackerState(rows: Array<Pick<DealRow, "staged_data" | "live_data">>): TrackerState {
  const months = new Map<string, MonthRecord>();
  const vehicleTypes: VehicleTypeOption[] = [];
  for (const row of rows) {
    const payload = workingPayload(row);
    if (!payload) continue;
    if (payload.kind === "vehicle_type" && payload.vehicleType) {
      if (!vehicleTypes.some((type) => type.id === payload.vehicleType?.id)) {
        vehicleTypes.push(payload.vehicleType);
      }
      continue;
    }
    const monthId = payload.monthId;
    const sheetId = payload.sheetId;
    if (!monthId || !sheetId || !payload.year || !payload.month) continue;
    let month = months.get(monthId);
    if (!month) {
      month = { id: monthId, year: payload.year, month: payload.month, sheets: [] };
      months.set(monthId, month);
    }
    let sheet = month.sheets.find((item) => item.id === sheetId);
    if (!sheet) {
      sheet = {
        id: sheetId,
        startDay: payload.startDay ?? 1,
        endDay: payload.endDay ?? 15,
        sales: [],
        vacationPay: 0,
        bonuses: [],
      };
      month.sheets.push(sheet);
    }
    if (payload.kind === "sheet") {
      sheet.startDay = payload.startDay ?? sheet.startDay;
      sheet.endDay = payload.endDay ?? sheet.endDay;
      sheet.vacationPay = payload.vacationPay ?? 0;
      sheet.bonuses = payload.bonuses ?? [];
    }
    if (payload.kind === "sale" && payload.sale) {
      if (!sheet.sales.some((item) => item.id === payload.sale?.id)) {
        sheet.sales.push(payload.sale);
      }
    }
  }
  return { months: sortMonths([...months.values()]), vehicleTypes };
}

export function nextRepStatus(current: RecordStatus | undefined): RecordStatus {
  if (current === "pending_manager_approval") return "pending_manager_approval";
  if (current === "rejected") return "staged";
  return "staged";
}
