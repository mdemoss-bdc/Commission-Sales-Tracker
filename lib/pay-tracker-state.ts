import { assembleTrackerState, flattenTrackerState, isPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { buildEmployeePushPayload, type EmployeePushPayload, type EmployeePushSheet } from "./employee-push.ts";
import { isPushedSheetStatus, type RecordStatus } from "./roles.ts";
import { hasTrackerData, parseTrackerState } from "./storage.ts";
import { summarizeAll } from "./summaries.ts";
import type { ExtraPay, MonthRecord, PaySheet, TrackerState, VehicleTypeOption } from "./types.ts";

export const PAY_TRACKER_STATE_SELECT =
  "id,user_id,employee_id,month_id,status,state,location_id,created_by,created_at,updated_at";

export type PayTrackerDocument = TrackerState & EmployeePushPayload & {
  gross: number;
  units: number;
  trades: number;
  fi: number;
  vacation: number;
  month_id: string | null;
  employee_id: string;
};

export type PayTrackerStateRow = {
  id: string;
  user_id: string | null;
  employee_id: string | null;
  month_id: string | null;
  status: string;
  state: unknown;
  location_id: string | null;
  created_by: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function isPushedPayTrackerStatus(status: string | null | undefined): boolean {
  return isPushedSheetStatus(status);
}

export function buildPayTrackerDocument(state: TrackerState, employeeId: string): PayTrackerDocument {
  const payload = buildEmployeePushPayload(state);
  const totals = summarizeAll(state);
  return {
    ...state,
    ...payload,
    months: state.months ?? [],
    vehicleTypes: state.vehicleTypes ?? [],
    deals: payload.deals,
    gross: totals.gross,
    units: totals.units,
    trades: totals.trades,
    fi: totals.fi,
    vacation: totals.vacation,
    bonuses: payload.bonuses,
    month_id: payload.month_id,
    employee_id: employeeId,
  };
}

function sheetsToMonths(sheets: EmployeePushSheet[]): MonthRecord[] {
  const months = new Map<string, MonthRecord>();
  for (const sheet of sheets) {
    const monthId = sheet.monthId;
    if (!monthId) continue;
    let month = months.get(monthId);
    if (!month) {
      month = { id: monthId, year: sheet.year, month: sheet.month, sheets: [] };
      months.set(monthId, month);
    }
    const paySheet: PaySheet = {
      id: sheet.sheetId,
      startDay: sheet.startDay,
      endDay: sheet.endDay,
      sales: sheet.deals ?? [],
      vacationHours: sheet.vacation_hours ?? 0,
      vacationRate: sheet.hourly_rate ?? 0,
      vacationPay: sheet.vacation_pay ?? 0,
      bonuses: sheet.bonuses ?? [],
    };
    if (!month.sheets.some((item) => item.id === paySheet.id)) {
      month.sheets.push(paySheet);
    }
  }
  return [...months.values()];
}

export function trackerStateFromPayTrackerDocument(value: unknown): TrackerState | null {
  const parsed = parseTrackerState(value);
  if (parsed && hasTrackerData(parsed)) return parsed;
  if (!value || typeof value !== "object") return parsed;
  const data = value as Record<string, unknown>;
  if (Array.isArray(data.records)) {
    const fromRecords = assembleTrackerState(
      data.records
        .filter((item): item is DealPayload => isPayload(item))
        .map((payload) => ({ staged_data: payload, live_data: {} })),
    );
    if (hasTrackerData(fromRecords)) return fromRecords;
  }
  if (Array.isArray(data.sheets)) {
    const sheets = data.sheets as EmployeePushSheet[];
    const months = sheetsToMonths(sheets);
    const vehicleTypes = Array.isArray(data.vehicle_types)
      ? (data.vehicle_types as VehicleTypeOption[])
      : Array.isArray(data.vehicleTypes)
        ? (data.vehicleTypes as VehicleTypeOption[])
        : [];
    const rebuilt = { months, vehicleTypes };
    if (hasTrackerData(rebuilt)) return rebuilt;
  }
  return parsed;
}

export function parsePayTrackerStateRow(value: unknown): PayTrackerStateRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const userId = typeof row.user_id === "string" ? row.user_id : typeof row.employee_id === "string" ? row.employee_id : id;
  if (!id && !userId) return null;
  return {
    id: id || userId,
    user_id: typeof row.user_id === "string" ? row.user_id : userId || null,
    employee_id: typeof row.employee_id === "string" ? row.employee_id : userId || null,
    month_id: typeof row.month_id === "string" ? row.month_id : null,
    status: typeof row.status === "string" && row.status.trim() ? row.status : "awaiting_review",
    state: row.state ?? row,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export function ownerIdFromPayTrackerRow(row: PayTrackerStateRow): string {
  return row.employee_id || row.user_id || row.id;
}

export function dealRowsFromPayTrackerState(row: PayTrackerStateRow): DealRow[] {
  if (!isPushedPayTrackerStatus(row.status)) return [];
  const state = trackerStateFromPayTrackerDocument(row.state);
  if (!state || !hasTrackerData(state)) return [];
  const ownerId = ownerIdFromPayTrackerRow(row);
  const payloads = flattenTrackerState(state);
  const extras = Array.isArray((row.state as { records?: unknown[] } | null)?.records)
    ? ((row.state as { records: unknown[] }).records.filter((item): item is DealPayload => isPayload(item)))
    : [];
  const seen = new Set<string>();
  const merged: DealPayload[] = [];
  for (const payload of [...payloads, ...extras]) {
    const key = `${payload.kind}:${payload.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(payload);
  }
  return merged.map((payload) => ({
    id: `pay-tracker:${ownerId}:${payload.kind}:${payload.entityId}`,
    rep_id: ownerId,
    location_id: row.location_id,
    created_by: row.created_by || ownerId,
    status: (isPushedSheetStatus(row.status) ? row.status : "awaiting_review") as RecordStatus,
    staged_data: payload,
    live_data: {},
    proposed_data: payload,
    previous_data: {},
    rep_notes: null,
    updated_at: row.updated_at ?? undefined,
  }));
}

export function mergePayTrackerDealRows(existing: DealRow[], extras: DealRow[]): DealRow[] {
  const keys = new Set(
    existing
      .filter((row) => isPushedSheetStatus(row.status))
      .map((row) => `${row.rep_id}:${row.staged_data && isPayload(row.staged_data) ? `${row.staged_data.kind}:${row.staged_data.entityId}` : ""}`),
  );
  const merged = [...existing];
  for (const extra of extras) {
    const payload = isPayload(extra.staged_data) ? extra.staged_data : null;
    const key = `${extra.rep_id}:${payload ? `${payload.kind}:${payload.entityId}` : extra.id}`;
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(extra);
  }
  return merged;
}

export function pickLatestPayTrackerRow(rows: PayTrackerStateRow[], userId: string): PayTrackerStateRow | null {
  const mine = rows.filter((row) => ownerIdFromPayTrackerRow(row) === userId || row.id === userId);
  if (mine.length === 0) return null;
  const awaiting = mine.filter((row) => isPushedPayTrackerStatus(row.status));
  const pool = awaiting.length > 0 ? awaiting : mine;
  return pool.slice().sort((left, right) => (right.updated_at ?? "").localeCompare(left.updated_at ?? ""))[0] ?? null;
}

export function documentTotals(doc: Pick<PayTrackerDocument, "gross" | "units" | "trades" | "fi" | "vacation" | "bonuses">): {
  gross: number;
  units: number;
  trades: number;
  fi: number;
  vacation: number;
  bonuses: ExtraPay[];
} {
  return {
    gross: doc.gross,
    units: doc.units,
    trades: doc.trades,
    fi: doc.fi,
    vacation: doc.vacation,
    bonuses: doc.bonuses ?? [],
  };
}
