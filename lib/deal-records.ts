import { sheetVacationPay, vacationPayAmount } from "./commission.ts";
import { sortMonths } from "./records.ts";
import type { ExtraPay, MonthRecord, PaySheet, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import { isPushedSheetStatus, type RecordStatus } from "./roles.ts";
import { dealTypeLabel } from "./deal-types.ts";
import { explicitBonuses } from "./worksheet-persist.ts";

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
  vacationHours?: number;
  vacationRate?: number;
  vacationPay?: number;
  vacation_hours?: number;
  vacation_rate?: number;
  vacation_pay?: number;
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
  proposed_data?: DealPayload | Record<string, never> | null;
  previous_data?: DealPayload | Record<string, never> | null;
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

export function asJsonObject(value: unknown): DealPayload | Record<string, never> {
  return isPayload(value) ? value : {};
}

export function proposedPayload(row: Pick<DealRow, "proposed_data">): DealPayload | null {
  return isPayload(row.proposed_data) ? row.proposed_data : null;
}

export function managerPushPayload(
  row: Pick<DealRow, "staged_data" | "proposed_data">,
): DealPayload | null {
  if (isPayload(row.proposed_data)) return row.proposed_data;
  if (isPayload(row.staged_data)) return row.staged_data;
  return null;
}

export function commitLivePayload(
  row: Pick<DealRow, "staged_data" | "proposed_data" | "live_data">,
): DealPayload | Record<string, never> {
  const proposed = proposedPayload(row);
  if (proposed) return proposed;
  if (isPayload(row.staged_data)) return row.staged_data;
  if (isPayload(row.live_data)) return row.live_data;
  return {};
}

export function normalizeDealRow(row: DealRow): DealRow {
  return {
    ...row,
    staged_data: asJsonObject(row.staged_data),
    live_data: asJsonObject(row.live_data),
    proposed_data: asJsonObject(row.proposed_data),
    previous_data: asJsonObject(row.previous_data),
  };
}

export function workingPayload(
  row: Pick<DealRow, "staged_data" | "live_data" | "proposed_data">,
): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  if (isPayload(row.proposed_data)) return row.proposed_data;
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
        vacationHours: sheet.vacationHours ?? 0,
        vacationRate: sheet.vacationRate ?? 0,
        vacationPay: sheetVacationPay(sheet),
        vacation_hours: sheet.vacationHours ?? 0,
        vacation_rate: sheet.vacationRate ?? 0,
        vacation_pay: sheetVacationPay(sheet),
        bonuses: explicitBonuses(sheet.bonuses),
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

function payloadNumber(payload: DealPayload, ...keys: string[]): number {
  const row = payload as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] == null || row[key] === "") continue;
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function vacationFromPayload(payload: DealPayload) {
  const hours = payloadNumber(payload, "vacationHours", "vacation_hours");
  const rate = payloadNumber(payload, "vacationRate", "vacation_rate");
  const fallback = payloadNumber(payload, "vacationPay", "vacation_pay");
  return {
    vacationHours: hours,
    vacationRate: rate,
    vacationPay: vacationPayAmount(hours, rate, fallback),
  };
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
        vacationHours: 0,
        vacationRate: 0,
        vacationPay: 0,
        bonuses: [],
      };
      month.sheets.push(sheet);
    }
    if (payload.kind === "sheet") {
      sheet.startDay = payload.startDay ?? sheet.startDay;
      sheet.endDay = payload.endDay ?? sheet.endDay;
      Object.assign(sheet, vacationFromPayload(payload));
      sheet.bonuses = explicitBonuses(payload.bonuses);
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
      .map((row) => (isPushedSheetStatus(row.status) ? managerPushPayload(row) : null))
      .filter((payload): payload is DealPayload => payload !== null),
  );
}

export function hasIncomingPushedSheet(rows: DealRow[]): boolean {
  return rows.some((row) => isPushedSheetStatus(row.status) && Boolean(managerPushPayload(row)));
}

function copySheet(sheet: PaySheet): PaySheet {
  return {
    ...sheet,
    sales: [...(sheet.sales ?? [])],
    bonuses: [...explicitBonuses(sheet.bonuses)],
  };
}

export function mergeLiveWithPushedMonths(live: TrackerState, pushed: TrackerState): TrackerState {
  const months: MonthRecord[] = live.months.map((month) => ({
    ...month,
    sheets: month.sheets.map(copySheet),
  }));
  for (const pushedMonth of pushed.months ?? []) {
    const nextMonth: MonthRecord = {
      ...pushedMonth,
      sheets: (pushedMonth.sheets ?? []).map(copySheet),
    };
    const index = months.findIndex((row) => row.id === pushedMonth.id);
    if (index === -1) {
      months.push(nextMonth);
      continue;
    }
    const current = months[index];
    const sheets = current.sheets.map(copySheet);
    for (const pushedSheet of nextMonth.sheets) {
      const sheetIndex = sheets.findIndex((sheet) => sheet.id === pushedSheet.id);
      if (sheetIndex === -1) {
        sheets.push(pushedSheet);
      }
    }
    months[index] = { ...current, sheets };
  }
  const vehicleTypes = [...(live.vehicleTypes ?? [])];
  for (const type of pushed.vehicleTypes ?? []) {
    if (vehicleTypes.some((row) => row.id === type.id)) continue;
    vehicleTypes.push(type);
  }
  return { months: sortMonths(months), vehicleTypes };
}

export function assembleRepViewState(rows: DealRow[]): TrackerState {
  return mergeLiveWithPushedMonths(assembleLiveState(rows), assembleStagedState(rows));
}

export function rowsForMonth(rows: DealRow[], monthId: string): DealRow[] {
  return rows.filter((row) => {
    const payload = managerPushPayload(row) ?? (isPayload(row.live_data) ? row.live_data : null);
    return payload?.monthId === monthId;
  });
}

export function assembleTrackerState(
  rows: Array<Pick<DealRow, "staged_data" | "live_data" | "proposed_data">>,
): TrackerState {
  return assembleFromPayloads(
    rows
      .map((row) => managerPushPayload(row) ?? (isPayload(row.live_data) ? row.live_data : null))
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
    add("Deal Type", original?.sale?.vehicleType, edited?.sale?.vehicleType);
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
    add(
      "Vacation hours",
      original?.vacationHours ?? original?.vacation_hours,
      edited?.vacationHours ?? edited?.vacation_hours,
    );
    add(
      "Hourly rate",
      original?.vacationRate ?? original?.vacation_rate,
      edited?.vacationRate ?? edited?.vacation_rate,
    );
    add(
      "Vacation pay",
      original?.vacationPay ?? original?.vacation_pay,
      edited?.vacationPay ?? edited?.vacation_pay,
    );
    add("Bonuses", original?.bonuses, edited?.bonuses);
    return diffs;
  }
  add("Vehicle type", original?.vehicleType?.label, edited?.vehicleType?.label);
  return diffs;
}

export function previousPayload(row: DealRow): DealPayload | null {
  if (isPayload(row.previous_data)) return row.previous_data;
  if (isPayload(row.proposed_data)) return row.proposed_data;
  return null;
}

export function originalPayload(row: DealRow): DealPayload | null {
  const prior = previousPayload(row);
  if (prior) return prior;
  if (isPayload(row.live_data)) return row.live_data;
  return null;
}

export function editedPayload(row: DealRow): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  return originalPayload(row);
}
