import { assembleTrackerState, flattenTrackerState, isPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { parseDealType } from "./deal-types.ts";
import { buildEmployeePushPayload, type EmployeePushPayload, type EmployeePushSheet } from "./employee-push.ts";
import { isPushedSheetStatus, type RecordStatus } from "./roles.ts";
import { hasTrackerData, parseTrackerState } from "./storage.ts";
import { addTotals, emptyTotals, summarizeAll, summarizeSales } from "./summaries.ts";
import type { ExtraPay, MonthRecord, PaySheet, Sale, Totals, TrackerState, VehicleTypeOption } from "./types.ts";
import { explicitBonuses, withExplicitBonuses } from "./worksheet-persist.ts";

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
  const normalized = withExplicitBonuses(state);
  const payload = buildEmployeePushPayload(normalized);
  const totals = summarizeAll(normalized);
  return {
    ...normalized,
    ...payload,
    months: normalized.months ?? [],
    vehicleTypes: normalized.vehicleTypes ?? [],
    deals: payload.deals,
    gross: totals.gross,
    units: totals.units,
    trades: totals.trades,
    fi: totals.fi,
    vacation: totals.vacation,
    bonuses: explicitBonuses(payload.bonuses),
    month_id: payload.month_id,
    employee_id: employeeId,
    total_pay: totals.pay,
    pay: totals.pay,
  };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asNumber(value: unknown): number {
  return asFiniteNumber(value) ?? 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function parsePushBonus(value: unknown, index: number): ExtraPay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asText(row.id) || `bonus-${index + 1}`;
  return {
    id,
    label: asText(row.label),
    amount: asNumber(row.amount),
  };
}

function parsePushBonuses(value: unknown): ExtraPay[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => parsePushBonus(item, index))
    .filter((bonus): bonus is ExtraPay => Boolean(bonus));
}

export function parsePushSale(value: unknown, fallbackId?: string): Sale | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const stock = asText(row.stockNumber ?? row.stock_number);
  const customer = asText(row.customerName ?? row.customer_name);
  const id = asText(row.id) || fallbackId || "";
  if (!id && !stock && !customer && asFiniteNumber(row.gross) == null) return null;
  return {
    id: id || `deal:${stock || customer || "row"}`,
    stockNumber: stock,
    customerName: customer,
    vehicleType: asText(row.vehicleType ?? row.vehicle_type),
    dealType: parseDealType(row.dealType ?? row.deal_type),
    tradeIn: asBoolean(row.tradeIn ?? row.trade_in),
    gross: asNumber(row.gross),
    flat: asNumber(row.flat),
    fi: asNumber(row.fi),
    service: asNumber(row.service),
    duplicateConfirmed: asBoolean(row.duplicateConfirmed ?? row.duplicate_confirmed) || undefined,
  };
}

export function parseDealList(value: unknown): Sale[] {
  if (!Array.isArray(value)) return [];
  const sales: Sale[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const sale = parsePushSale(item, `deal-${index + 1}`);
    if (!sale || seen.has(sale.id)) return;
    seen.add(sale.id);
    sales.push(sale);
  });
  return sales;
}

function uniqueSales(sales: Sale[]): Sale[] {
  const seen = new Set<string>();
  return sales.filter((sale) => {
    if (seen.has(sale.id)) return false;
    seen.add(sale.id);
    return true;
  });
}

function parsePushSheet(value: unknown): PaySheet | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asText(row.id) || asText(row.sheetId) || asText(row.sheet_id);
  if (!id) return null;
  return {
    id,
    startDay: asFiniteNumber(row.startDay ?? row.start_day) || 1,
    endDay: asFiniteNumber(row.endDay ?? row.end_day) || 15,
    sales: uniqueSales([...parseDealList(row.sales), ...parseDealList(row.deals)]),
    vacationHours: asNumber(row.vacationHours ?? row.vacation_hours),
    vacationRate: asNumber(row.vacationRate ?? row.vacation_rate ?? row.hourly_rate),
    vacationPay: asNumber(row.vacationPay ?? row.vacation_pay),
    bonuses: parsePushBonuses(row.bonuses),
  };
}

function vehicleTypesFromDocument(data: Record<string, unknown>): VehicleTypeOption[] {
  const list = Array.isArray(data.vehicleTypes)
    ? data.vehicleTypes
    : Array.isArray(data.vehicle_types)
      ? data.vehicle_types
      : [];
  const types: VehicleTypeOption[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const label = asText(row.label).trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    types.push({ id, label });
  }
  return types;
}

export function trackerHasSales(state: TrackerState | null | undefined): boolean {
  return Boolean(
    state?.months.some((month) => (month.sheets ?? []).some((sheet) => (sheet.sales ?? []).length > 0)),
  );
}

function firstPositive(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) return value;
  }
  return 0;
}

function sheetsToMonths(sheets: EmployeePushSheet[]): MonthRecord[] {
  const months = new Map<string, MonthRecord>();
  for (const sheet of sheets) {
    const parsed = parsePushSheet(sheet);
    const monthId = sheet.monthId || asText((sheet as unknown as { month_id?: unknown }).month_id);
    if (!monthId || !parsed) continue;
    let month = months.get(monthId);
    if (!month) {
      month = { id: monthId, year: sheet.year, month: sheet.month, sheets: [] };
      months.set(monthId, month);
    }
    if (!month.sheets.some((item) => item.id === parsed.id)) {
      month.sheets.push(parsed);
    }
  }
  return [...months.values()];
}

function monthMetaFromDocument(
  data: Record<string, unknown>,
  sheets: EmployeePushSheet[],
): { monthId: string; sheetId: string; year: number; month: number } {
  const primary = sheets[0];
  const now = new Date();
  return {
    monthId: asText(data.month_id) || asText(data.monthId) || primary?.monthId || "pending-month",
    sheetId: asText(data.sheet_id) || asText(data.sheetId) || primary?.sheetId || "pending-sheet",
    year: asFiniteNumber(data.year) || primary?.year || now.getFullYear(),
    month: asFiniteNumber(data.month) || primary?.month || now.getMonth() + 1,
  };
}

function rebuildTrackerFromPushDocument(value: unknown): TrackerState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const vehicleTypes = vehicleTypesFromDocument(data);

  if (Array.isArray(data.records)) {
    const fromRecords = assembleTrackerState(
      data.records
        .filter((item): item is DealPayload => isPayload(item))
        .map((payload) => ({ staged_data: payload, live_data: {} })),
    );
    if (trackerHasSales(fromRecords) || hasTrackerData(fromRecords)) {
      return {
        ...fromRecords,
        vehicleTypes: fromRecords.vehicleTypes.length ? fromRecords.vehicleTypes : vehicleTypes,
      };
    }
  }

  if (Array.isArray(data.sheets) && data.sheets.length > 0) {
    const months = sheetsToMonths(data.sheets as EmployeePushSheet[]);
    if (months.length > 0) return { months, vehicleTypes };
  }

  if (Array.isArray(data.months) && data.months.length > 0) {
    const months: MonthRecord[] = [];
    for (const item of data.months) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const nestedSheets = Array.isArray(row.sheets)
        ? row.sheets.map((sheet) => parsePushSheet(sheet)).filter((sheet): sheet is PaySheet => Boolean(sheet))
        : [];
      const id = asText(row.id) || asText(row.monthId) || asText(row.month_id);
      const year = asFiniteNumber(row.year);
      const month = asFiniteNumber(row.month);
      if (id && year && month && year >= 2000 && month >= 1 && month <= 12) {
        const loneSheet = nestedSheets.length
          ? nestedSheets
          : (() => {
              const parsed = parsePushSheet(item);
              return parsed ? [parsed] : [];
            })();
        months.push({ id, year, month, sheets: loneSheet });
        continue;
      }
      const parsed = parsePushSheet(item);
      const monthId = asText(row.monthId) || asText(row.month_id);
      if (parsed && monthId) {
        months.push({
          id: monthId,
          year: year || new Date().getFullYear(),
          month: month || new Date().getMonth() + 1,
          sheets: [parsed],
        });
      }
    }
    if (months.length > 0) return { months, vehicleTypes };
  }

  const deals = parseDealList(data.deals);
  if (deals.length > 0) {
    const sheets = Array.isArray(data.sheets) ? (data.sheets as EmployeePushSheet[]) : [];
    const meta = monthMetaFromDocument(data, sheets);
    return {
      months: [
        {
          id: meta.monthId,
          year: meta.year,
          month: meta.month,
          sheets: [
            {
              id: meta.sheetId,
              startDay: 1,
              endDay: 15,
              sales: deals,
              vacationHours: asNumber(data.vacation_hours ?? data.vacationHours),
              vacationRate: asNumber(data.hourly_rate ?? data.vacationRate ?? data.vacation_rate),
              vacationPay: asNumber(data.vacation_pay ?? data.vacationPay),
              bonuses: parsePushBonuses(data.bonuses),
            },
          ],
        },
      ],
      vehicleTypes,
    };
  }

  return vehicleTypes.length > 0 ? { months: [], vehicleTypes } : null;
}

export function trackerStateFromPayTrackerDocument(value: unknown): TrackerState | null {
  const parsed = parseTrackerState(value);
  const rebuilt = rebuildTrackerFromPushDocument(value);
  if (parsed && trackerHasSales(parsed)) return parsed;
  if (rebuilt && trackerHasSales(rebuilt)) return rebuilt;
  if (rebuilt && hasTrackerData(rebuilt)) return rebuilt;
  if (parsed && parsed.months.length > 0) return parsed;
  return rebuilt ?? parsed;
}

export function managerBufferTotalsFromDocument(value: unknown): Totals {
  const blank = emptyTotals();
  if (!value || typeof value !== "object") return blank;
  const data = value as Record<string, unknown>;
  const tracker = trackerStateFromPayTrackerDocument(value);
  const fromState = tracker ? summarizeAll(tracker) : blank;
  const fromDeals = summarizeSales(parseDealList(data.deals));
  const fromSheets = Array.isArray(data.sheets)
    ? (data.sheets as EmployeePushSheet[]).reduce(
        (sum, sheet) => addTotals(sum, summarizeSales(parseDealList(sheet.deals))),
        blank,
      )
    : blank;
  const units = firstPositive(asFiniteNumber(data.units), fromState.units, fromDeals.units, fromSheets.units);
  const trades = firstPositive(asFiniteNumber(data.trades), fromState.trades, fromDeals.trades, fromSheets.trades);
  const gross = firstPositive(
    asFiniteNumber(data.gross),
    asFiniteNumber(data.front_gross),
    asFiniteNumber(data.frontGross),
    fromState.gross,
    fromDeals.gross,
    fromSheets.gross,
  );
  const pay = firstPositive(
    asFiniteNumber(data.total_pay),
    asFiniteNumber(data.totalPay),
    asFiniteNumber(data.pay),
    fromState.pay,
    fromDeals.pay,
    fromSheets.pay,
  );
  return { ...fromState, units, trades, gross, pay };
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

export function isSyntheticPayTrackerDealId(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith("pay-tracker:"));
}

export function dealRowsFromPayTrackerState(row: PayTrackerStateRow): DealRow[] {
  if (!isPushedPayTrackerStatus(row.status)) return [];
  const state = trackerStateFromPayTrackerDocument(row.state);
  const totals = managerBufferTotalsFromDocument(row.state);
  const ownerId = ownerIdFromPayTrackerRow(row);
  const payloads =
    state && (trackerHasSales(state) || (state.months ?? []).some((month) => month.sheets.length > 0))
      ? flattenTrackerState(state)
      : [];
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
  if (!merged.some((payload) => payload.kind === "sale" || payload.kind === "sheet")) {
    const data = row.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
    const now = new Date();
    const monthId =
      row.month_id ||
      (typeof data.month_id === "string" ? data.month_id : "") ||
      (typeof data.monthId === "string" ? data.monthId : "") ||
      "pending-month";
    const sheetId =
      (typeof data.sheet_id === "string" ? data.sheet_id : "") ||
      (typeof data.sheetId === "string" ? data.sheetId : "") ||
      "pending-sheet";
    const year = typeof data.year === "number" ? data.year : now.getFullYear();
    const month = typeof data.month === "number" ? data.month : now.getMonth() + 1;
    merged.push({
      kind: "sheet",
      entityId: sheetId,
      monthId,
      year,
      month,
      sheetId,
    });
  }
  return merged.map((payload) => {
    const staged =
      payload.kind === "sheet"
        ? {
            ...payload,
            units: totals.units,
            trades: totals.trades,
            gross: totals.gross,
            total_pay: totals.pay,
            pay: totals.pay,
          }
        : payload;
    return {
      id: `pay-tracker:${ownerId}:${payload.kind}:${payload.entityId}`,
      rep_id: ownerId,
      location_id: row.location_id,
      created_by: row.created_by || ownerId,
      status: (isPushedSheetStatus(row.status) ? row.status : "awaiting_review") as RecordStatus,
      staged_data: staged,
      live_data: {},
      proposed_data: staged,
      previous_data: {},
      rep_notes: null,
      updated_at: row.updated_at ?? undefined,
    };
  });
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
    bonuses: explicitBonuses(doc.bonuses),
  };
}
