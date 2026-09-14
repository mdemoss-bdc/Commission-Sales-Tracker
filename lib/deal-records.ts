import { sortMonths } from "./records.ts";
import type { ExtraPay, MonthRecord, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import type { RecordStatus } from "./roles.ts";
import { dealTypeLabel } from "./deal-types.ts";

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
  proposed_data?: DealPayload | Record<string, never>;
  rep_notes: string | null;
  manager_notes?: string | null;
  reject_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type FieldDiff = {
  label: string;
  before: string;
  after: string;
};

export function isPayload(value: unknown): value is DealPayload {
  if (!value || typeof value !== "object") return false;
  const row = value as DealPayload;
  return (row.kind === "sale" || row.kind === "sheet" || row.kind === "vehicle_type") && Boolean(row.entityId);
}

export function workingPayload(row: Pick<DealRow, "staged_data" | "live_data">): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  if (isPayload(row.live_data)) return row.live_data;
  return null;
}

export function payloadKey(payload: DealPayload): string {
  return `${payload.kind}:${payload.entityId}`;
}

export function rowKey(row: Pick<DealRow, "staged_data" | "live_data" | "proposed_data">): string | null {
  const payload =
    (isPayload(row.staged_data) && row.staged_data) ||
    (isPayload(row.live_data) && row.live_data) ||
    (isPayload(row.proposed_data) && row.proposed_data) ||
    null;
  return payload ? payloadKey(payload) : null;
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

function assembleFromPayloads(payloads: DealPayload[]): TrackerState {
  const months = new Map<string, MonthRecord>();
  const vehicleTypes: VehicleTypeOption[] = [];
  for (const payload of payloads) {
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

export function assembleLiveState(rows: DealRow[]): TrackerState {
  return assembleFromPayloads(rows.map((row) => (isPayload(row.live_data) ? row.live_data : null)).filter((row): row is DealPayload => row !== null));
}

export function assembleOverlayState(rows: DealRow[]): TrackerState {
  const payloads: DealPayload[] = [];
  for (const row of rows) {
    if (row.status === "draft" && isPayload(row.staged_data)) {
      payloads.push(row.staged_data);
      continue;
    }
    if (isPayload(row.live_data)) payloads.push(row.live_data);
  }
  return assembleFromPayloads(payloads);
}

export function assembleStagedState(rows: DealRow[]): TrackerState {
  return assembleFromPayloads(
    rows
      .filter((row) => row.status === "staged" && isPayload(row.staged_data))
      .map((row) => row.staged_data as DealPayload),
  );
}

export function assembleTrackerState(rows: Array<Pick<DealRow, "staged_data" | "live_data">>): TrackerState {
  return assembleFromPayloads(
    rows
      .map((row) => (isPayload(row.staged_data) ? row.staged_data : isPayload(row.live_data) ? row.live_data : null))
      .filter((row): row is DealPayload => row !== null),
  );
}

function display(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value || "—";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && "label" in item && "amount" in item) {
          const bonus = item as ExtraPay;
          return `${bonus.label || "Bonus"} ${bonus.amount}`;
        }
        return String(item);
      })
      .join(", ");
  }
  return "—";
}

export function payloadLabel(payload: DealPayload | null | undefined): string {
  if (!payload) return "Record";
  if (payload.kind === "sale" && payload.sale) {
    return `${payload.sale.stockNumber || "No stock"} · ${payload.sale.customerName || "No customer"} · ${dealTypeLabel(payload.sale.dealType)}`;
  }
  if (payload.kind === "sheet") return "Worksheet extras";
  if (payload.kind === "vehicle_type") return `Vehicle type ${payload.vehicleType?.label ?? ""}`.trim();
  return "Record";
}

export function diffPayloads(original: DealPayload | null | undefined, edited: DealPayload | null | undefined): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  function add(label: string, before: unknown, after: unknown) {
    const left = display(before);
    const right = display(after);
    if (left === right) return;
    diffs.push({ label, before: left, after: right });
  }
  if (!original && !edited) return diffs;
  if ((original?.kind || edited?.kind) === "sale") {
    add("Stock #", original?.sale?.stockNumber, edited?.sale?.stockNumber);
    add("Customer", original?.sale?.customerName, edited?.sale?.customerName);
    add("Deal type", dealTypeLabel(original?.sale?.dealType), dealTypeLabel(edited?.sale?.dealType));
    add("Vehicle", original?.sale?.vehicleType, edited?.sale?.vehicleType);
    add("Trade-in", original?.sale?.tradeIn, edited?.sale?.tradeIn);
    add("Gross", original?.sale?.gross, edited?.sale?.gross);
    add("Flat", original?.sale?.flat, edited?.sale?.flat);
    add("F&I", original?.sale?.fi, edited?.sale?.fi);
    add("Service", original?.sale?.service, edited?.sale?.service);
    return diffs;
  }
  if ((original?.kind || edited?.kind) === "sheet") {
    add("From day", original?.startDay, edited?.startDay);
    add("To day", original?.endDay, edited?.endDay);
    add("Vacation pay", original?.vacationPay, edited?.vacationPay);
    add("Bonuses", original?.bonuses, edited?.bonuses);
    return diffs;
  }
  add("Vehicle type", original?.vehicleType?.label, edited?.vehicleType?.label);
  return diffs;
}

export function originalPayload(row: DealRow): DealPayload | null {
  if (isPayload(row.proposed_data)) return row.proposed_data;
  if (isPayload(row.live_data)) return row.live_data;
  return null;
}

export function editedPayload(row: DealRow): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  return originalPayload(row);
}
