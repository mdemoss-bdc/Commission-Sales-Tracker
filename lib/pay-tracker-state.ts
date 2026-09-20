import {
  assembleTrackerState,
  assembleWorkingState,
  flattenTrackerState,
  isActiveWorksheetDealRow,
  isPayload,
  type DealPayload,
  type DealRow,
} from "./deal-records.ts";
import { parseDealType } from "./deal-types.ts";
import { normalizeStockNumber } from "./commission.ts";
import { isUuid, preferredVehicleTypeKey } from "./vehicles.ts";
import { buildEmployeePushPayload, type EmployeePushPayload, type EmployeePushSheet } from "./employee-push.ts";
import { isPushedSheetStatus, type RecordStatus } from "./roles.ts";
import { hasTrackerData, parseTrackerState } from "./storage.ts";
import { addTotals, emptyTotals, summarizeAll, summarizeSales } from "./summaries.ts";
import type { ExtraPay, MonthRecord, PaySheet, Sale, Totals, TrackerState, VehicleTypeOption } from "./types.ts";
import { parsePayPeriodKey, periodFromUnknown, rangeFromPeriodIdentity, pickMonthForPeriod, periodFromSheet, matchesPeriodKey, periodMatchScore, sheetHasPayrollContent } from "./pay-period.ts";
import { explicitBonuses, withExplicitBonuses } from "./worksheet-persist.ts";

export const PAY_TRACKER_STATE_SELECT =
  "id,user_id,employee_id,month_id,status,state,admin_pushed_snapshot,rep_draft,approval_diffs,pay_delta,finalized_label,deny_reason,location_id,created_by,created_at,updated_at";

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
  admin_pushed_snapshot?: unknown;
  rep_draft?: unknown;
  approval_diffs?: unknown;
  pay_delta?: number | null;
  finalized_label?: string | null;
  deny_reason?: string | null;
  location_id: string | null;
  created_by: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function isPushedPayTrackerStatus(status: string | null | undefined): boolean {
  return isPushedSheetStatus(status);
}

export function isVisibleManagerPushStatus(status: string | null | undefined): boolean {
  return (
    isPushedPayTrackerStatus(status) ||
    status === "rep_accepted_no_changes" ||
    status === "rep_authorized_no_changes" ||
    status === "rep_modified" ||
    status === "pending_manager_approval" ||
    status === "manager_approved" ||
    status === "admin_final_approved" ||
    status === "pending_admin_approval"
  );
}

export function workingTrackerFromPayTrackerRow(row: PayTrackerStateRow): TrackerState | null {
  if (typeof row.deny_reason === "string" && row.deny_reason.trim() && row.rep_draft) {
    const draft = trackerStateFromPayTrackerDocument(row.rep_draft);
    if (draft && hasTrackerData(draft)) return draft;
  }
  return trackerStateFromPayTrackerDocument(row.state);
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

export function collectWorksheetDeals(state: TrackerState | null | undefined): Sale[] {
  const deals: Sale[] = [];
  for (const month of state?.months ?? []) {
    for (const sheet of month.sheets ?? []) {
      deals.push(...(sheet.sales ?? []));
    }
  }
  return uniqueSales(deals);
}

export function extractDealsFromSheetData(sheetData: unknown): Sale[] {
  if (!sheetData) return [];
  if (Array.isArray(sheetData)) {
    return uniqueSales(
      sheetData
        .map((item, index) => saleFromUnknown(item, `deal-${index + 1}`))
        .filter((sale): sale is Sale => Boolean(sale && (sale.stockNumber || sale.customerName || sale.gross))),
    );
  }
  if (typeof sheetData !== "object") return [];
  const data = sheetData as Record<string, unknown>;
  const nested =
    data.state && typeof data.state === "object" && !Array.isArray(data.state)
      ? (data.state as Record<string, unknown>)
      : null;
  const list =
    (Array.isArray(data.deals) && data.deals.length > 0 && data.deals) ||
    (Array.isArray(data.records) && data.records.length > 0 && data.records) ||
    (Array.isArray(data.staged_data) && data.staged_data.length > 0 && data.staged_data) ||
    (Array.isArray(data.stagedData) && data.stagedData.length > 0 && data.stagedData) ||
    (Array.isArray(data.deal_records) && data.deal_records.length > 0 && data.deal_records) ||
    (Array.isArray(data.dealRecords) && data.dealRecords.length > 0 && data.dealRecords) ||
    (nested && Array.isArray(nested.deals) && nested.deals.length > 0 && nested.deals) ||
    (nested && Array.isArray(nested.records) && nested.records.length > 0 && nested.records) ||
    (nested && Array.isArray(nested.staged_data) && nested.staged_data.length > 0 && nested.staged_data) ||
    [];
  const sales: Sale[] = [];
  list.forEach((item, index) => {
    const sale = saleFromUnknown(item, `deal-${index + 1}`);
    if (sale && (sale.stockNumber || sale.customerName || sale.gross || (sale.id && !sale.id.startsWith("deal-")))) {
      sales.push(sale);
    }
  });
  return uniqueSales(sales);
}

export type ManagerApprovalLedgerPayload = Omit<PayTrackerDocument, "records"> & {
  deals: Sale[];
  records: Sale[];
  vacation_hours: number;
  hourly_rate: number;
  bonuses: ExtraPay[];
  month_id: string | null;
  totals: Totals;
  state: TrackerState & { deals: Sale[] };
};

export function serializeManagerApprovalPayload(
  state: TrackerState,
  employeeId: string,
): ManagerApprovalLedgerPayload {
  const document = buildPayTrackerDocument(state, employeeId);
  const currentDealsList = collectWorksheetDeals(state);
  const deals = currentDealsList.length > 0 ? currentDealsList : document.deals ?? [];
  const primary =
    document.sheets.find((sheet) => (sheet.deals ?? []).length > 0) ??
    document.sheets.find((sheet) => sheet.startDay >= 16) ??
    document.sheets[0];
  const vacationHours = primary?.vacation_hours || document.vacation_hours || 0;
  const hourlyRate = primary?.hourly_rate || document.hourly_rate || 0;
  const bonusesList = explicitBonuses(primary?.bonuses ?? document.bonuses);
  const calculatedTotals = summarizeAll(state);
  const periodId =
    document.period_id ??
    (primary
      ? periodFromSheet(
          {
            id: primary.sheetId,
            startDay: primary.startDay,
            endDay: primary.endDay,
          },
          { id: primary.monthId, year: primary.year, month: primary.month },
        ).key
      : document.month_id);
  return {
    ...document,
    deals,
    records: deals,
    vacation_hours: vacationHours,
    hourly_rate: hourlyRate,
    bonuses: bonusesList,
    month_id: periodId ?? document.month_id,
    period_id: periodId ?? document.period_id ?? document.month_id,
    totals: calculatedTotals,
    state: {
      months: state.months ?? [],
      vehicleTypes: state.vehicleTypes ?? [],
      deals,
    },
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
    stockNumber: normalizeStockNumber(stock),
    customerName: customer,
    vehicleType: preferredVehicleTypeKey(
      asText(row.vehicleType ?? row.vehicle_type ?? row.deal_type_id ?? row.dealTypeId),
      asText(row.deal_type_name ?? row.dealTypeName ?? row.vehicleTypeName ?? row.vehicle_type_name),
    ),
    dealType: parseDealType(row.dealType ?? row.deal_type),
    tradeIn: asBoolean(row.tradeIn ?? row.trade_in),
    splitDeal: asBoolean(row.splitDeal ?? row.split_deal) || undefined,
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

const WORKSHEET_ENVELOPE_KEYS = [
  "state",
  "sheet_data",
  "sheetData",
  "staged_data",
  "stagedData",
  "live_data",
  "liveData",
  "proposed_data",
  "payload",
  "document",
  "data",
] as const;

function worksheetEnvelopes(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as Record<string, unknown>;
  const seen = new Set<Record<string, unknown>>();
  const out: Record<string, unknown>[] = [];
  function walk(node: Record<string, unknown>, depth: number) {
    if (seen.has(node) || depth > 5) return;
    seen.add(node);
    out.push(node);
    for (const key of WORKSHEET_ENVELOPE_KEYS) {
      const nested = node[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        walk(nested as Record<string, unknown>, depth + 1);
      }
    }
  }
  walk(root, 0);
  return out;
}

function saleFromUnknown(value: unknown, fallbackId?: string): Sale | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return (
    parsePushSale(row.sale, fallbackId) ||
    parsePushSale(row.staged_data, fallbackId) ||
    parsePushSale(row.live_data, fallbackId) ||
    parsePushSale(row.proposed_data, fallbackId) ||
    parsePushSale(value, fallbackId)
  );
}

function dealsFromEnvelope(data: Record<string, unknown>): Sale[] {
  const lists = [
    data.deals,
    data.sales,
    data.records,
    data.deal_records,
    data.staged_data,
    data.stagedData,
    data.live_data,
    data.liveData,
    data.proposed_data,
    data.proposedData,
  ];
  const sales: Sale[] = [];
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      const sale = saleFromUnknown(item, `deal-${sales.length + index + 1}`);
      if (sale) sales.push(sale);
    });
  });
  return uniqueSales(sales);
}

export function worksheetContentScore(state: TrackerState | null | undefined): number {
  if (!state) return 0;
  let sales = 0;
  let extras = 0;
  for (const month of state.months ?? []) {
    for (const sheet of month.sheets ?? []) {
      sales += (sheet.sales ?? []).length;
      extras += (sheet.bonuses ?? []).length;
      if ((sheet.vacationHours ?? 0) > 0 || (sheet.vacationRate ?? 0) > 0 || (sheet.vacationPay ?? 0) > 0) extras += 1;
    }
  }
  return sales * 100 + extras * 10;
}

export function pickRichestWorksheet(states: Array<TrackerState | null | undefined>): TrackerState | null {
  let best: TrackerState | null = null;
  let bestScore = -1;
  for (const state of states) {
    if (!state) continue;
    const score = worksheetContentScore(state);
    if (score > bestScore) {
      best = state;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function compileManagerApprovalSnapshot(input: {
  preferred?: TrackerState | null;
  dealRows?: DealRow[];
  tracker?: PayTrackerStateRow | null;
}): TrackerState | null {
  const activeRows = (input.dealRows ?? []).filter(isActiveWorksheetDealRow);
  const fromRows = activeRows.length ? assembleWorkingState(activeRows) : null;
  return pickRichestWorksheet([
    input.preferred,
    fromRows,
    trackerStateFromPayTrackerDocument(input.tracker?.rep_draft),
    trackerStateFromPayTrackerDocument(input.tracker?.state),
    trackerStateFromPayTrackerDocument(input.tracker?.admin_pushed_snapshot),
  ]);
}

export function trackerFromPayTrackerFallbacks(row: PayTrackerStateRow | null | undefined): TrackerState | null {
  if (!row) return null;
  return pickRichestWorksheet([
    trackerStateFromPayTrackerDocument(row.rep_draft),
    trackerStateFromPayTrackerDocument(row.state),
    trackerStateFromPayTrackerDocument(row.admin_pushed_snapshot),
  ]);
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
    regularHours: asNumber(row.regularHours ?? row.regular_hours),
    hourlyRate: asNumber(row.hourlyRate ?? row.hourly_pay_rate ?? row.regularHourlyRate),
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
    types.push({
      id,
      label,
      excludeFromUnitCount: asBoolean(
        row.excludeFromUnitCount ?? row.exclude_from_unit_count ?? row.excludeFromUnits,
      ),
    });
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
): { monthId: string; sheetId: string; year: number; month: number; startDay: number; endDay: number } {
  const populated = sheets.find((sheet) => (sheet.deals ?? []).length > 0) ?? sheets.find((sheet) => sheet.startDay >= 16) ?? sheets[0];
  const now = new Date();
  const period = periodFromUnknown({
    ...data,
    month_id: data.period_id ?? data.periodId ?? data.month_id ?? data.monthId ?? populated?.monthId,
    startDay: data.startDay ?? populated?.startDay,
    endDay: data.endDay ?? populated?.endDay,
    year: data.year ?? populated?.year,
    month: data.month ?? populated?.month,
  });
  const range = rangeFromPeriodIdentity(period);
  const year = period.year || populated?.year || now.getFullYear();
  const month = period.month || populated?.month || now.getMonth() + 1;
  const rawId = asText(data.month_id) || asText(data.monthId) || populated?.monthId;
  const monthId = rawId && parsePayPeriodKey(rawId).year == null ? rawId : period.key || rawId || "pending-month";
  return {
    monthId,
    sheetId: asText(data.sheet_id) || asText(data.sheetId) || populated?.sheetId || "pending-sheet",
    year,
    month,
    startDay: range?.startDay || populated?.startDay || asFiniteNumber(data.startDay ?? data.start_day) || 1,
    endDay: range?.endDay || populated?.endDay || asFiniteNumber(data.endDay ?? data.end_day) || 15,
  };
}

function rebuildFromSingleEnvelope(data: Record<string, unknown>): TrackerState | null {
  const vehicleTypes = vehicleTypesFromDocument(data);

  const payloadLists = [data.records, data.staged_data, data.stagedData, data.live_data, data.proposed_data];
  for (const list of payloadLists) {
    if (!Array.isArray(list)) continue;
    const fromRecords = assembleTrackerState(
      list
        .filter((item): item is DealPayload => isPayload(item))
        .map((payload) => ({ staged_data: payload, live_data: {} })),
    );
    if (trackerHasSales(fromRecords) || (fromRecords.months ?? []).some((month) => (month.sheets ?? []).length > 0)) {
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

  let monthsFromDocument: MonthRecord[] = [];
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
    monthsFromDocument = months;
    if (months.length > 0) {
      const fromMonths = { months, vehicleTypes };
      if (trackerHasSales(fromMonths) || worksheetContentScore(fromMonths) > 0) return fromMonths;
    }
  }

  const deals = uniqueSales([
    ...parseDealList(data.deals),
    ...dealsFromEnvelope(data),
    ...extractDealsFromSheetData(data),
  ]);
  const envelopeVacationHours = asNumber(data.vacation_hours ?? data.vacationHours);
  const envelopeVacationRate = asNumber(data.hourly_rate ?? data.vacationRate ?? data.vacation_rate);
  const envelopeVacationPay = asNumber(data.vacation_pay ?? data.vacationPay);
  const envelopeBonuses = parsePushBonuses(data.bonuses);
  const hasEnvelopeExtras =
    envelopeVacationHours > 0 ||
    envelopeVacationRate > 0 ||
    envelopeVacationPay > 0 ||
    envelopeBonuses.length > 0;
  if (deals.length > 0 || hasEnvelopeExtras) {
    const sheets = Array.isArray(data.sheets) ? (data.sheets as EmployeePushSheet[]) : [];
    const meta = monthMetaFromDocument(data, sheets);
    const host =
      monthsFromDocument.find((month) => month.sheets.some((sheet) => sheetHasPayrollContent(sheet))) ??
      monthsFromDocument.find((month) => month.sheets.some((sheet) => (sheet.sales ?? []).length > 0)) ??
      pickMonthForPeriod({ months: monthsFromDocument, vehicleTypes: [] }, periodFromUnknown(meta.monthId)) ??
      monthsFromDocument[0];
    const hostSheet =
      host?.sheets.find((sheet) => sheetHasPayrollContent(sheet)) ??
      host?.sheets.find((sheet) => (sheet.sales ?? []).length > 0) ??
      host?.sheets.find((sheet) => sheet.startDay >= 16) ??
      host?.sheets[0];
    return {
      months: [
        {
          id: host?.id || meta.monthId,
          year: host?.year || meta.year,
          month: host?.month || meta.month,
          sheets: [
            {
              id: hostSheet?.id || meta.sheetId,
              startDay: hostSheet?.startDay || meta.startDay,
              endDay: hostSheet?.endDay || meta.endDay,
              sales: uniqueSales([...(hostSheet?.sales ?? []), ...deals]),
              vacationHours: hostSheet?.vacationHours || envelopeVacationHours,
              vacationRate: hostSheet?.vacationRate || envelopeVacationRate,
              vacationPay: hostSheet?.vacationPay || envelopeVacationPay,
              bonuses: hostSheet?.bonuses?.length ? hostSheet.bonuses : envelopeBonuses,
            },
            ...(host?.sheets ?? []).filter((sheet) => sheet.id !== (hostSheet?.id || meta.sheetId)),
          ],
        },
      ],
      vehicleTypes,
    };
  }

  if (monthsFromDocument.length > 0) return { months: monthsFromDocument, vehicleTypes };
  return vehicleTypes.length > 0 ? { months: [], vehicleTypes } : null;
}

function rebuildTrackerFromPushDocument(value: unknown): TrackerState | null {
  const envelopes = worksheetEnvelopes(value);
  if (envelopes.length === 0) return null;
  const rebuilt = envelopes.map((envelope) => rebuildFromSingleEnvelope(envelope));
  return pickRichestWorksheet(rebuilt) ?? rebuilt.find((item): item is TrackerState => Boolean(item)) ?? null;
}

export function trackerStateFromPayTrackerDocument(value: unknown): TrackerState | null {
  const parsed = parseTrackerState(value);
  const rebuilt = rebuildTrackerFromPushDocument(value);
  if (rebuilt && trackerHasSales(rebuilt)) return rebuilt;
  if (parsed && trackerHasSales(parsed)) return parsed;
  if (rebuilt && hasTrackerData(rebuilt) && rebuilt.months.length > 0) return rebuilt;
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
    admin_pushed_snapshot: row.admin_pushed_snapshot,
    rep_draft: row.rep_draft,
    approval_diffs: row.approval_diffs,
    pay_delta: typeof row.pay_delta === "number" && Number.isFinite(row.pay_delta) ? row.pay_delta : null,
    finalized_label: typeof row.finalized_label === "string" ? row.finalized_label : null,
    deny_reason: typeof row.deny_reason === "string" ? row.deny_reason : null,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export function ownerIdFromPayTrackerRow(row: PayTrackerStateRow): string {
  return row.employee_id || row.user_id || row.id;
}

/** True for mirrored pay_tracker rows or any non-UUID used as a deal_records.id. */
export function isSyntheticPayTrackerDealId(id: string | null | undefined): boolean {
  if (!id || typeof id !== "string") return false;
  if (id.startsWith("pay-tracker:")) return true;
  return !isUuid(id);
}

/** True only for a real Postgres uuid primary key on deal_records. */
export function isPersistedDealRecordId(id: string | null | undefined): boolean {
  return Boolean(id && isUuid(id) && !id.startsWith("pay-tracker:"));
}

export function dealRowsFromPayTrackerState(row: PayTrackerStateRow): DealRow[] {
  if (!isVisibleManagerPushStatus(row.status)) return [];
  const source = row.admin_pushed_snapshot ?? row.state;
  const state = trackerStateFromPayTrackerDocument(source);
  const totals = managerBufferTotalsFromDocument(source);
  const ownerId = ownerIdFromPayTrackerRow(row);
  const payloads =
    state && (trackerHasSales(state) || (state.months ?? []).some((month) => month.sheets.length > 0))
      ? flattenTrackerState(state)
      : [];
  const extras = Array.isArray((source as { records?: unknown[] } | null)?.records)
    ? ((source as { records: unknown[] }).records.filter((item): item is DealPayload => isPayload(item)))
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
      status: (isVisibleManagerPushStatus(row.status) ? row.status : "awaiting_review") as RecordStatus,
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
    existing.map((row) => `${row.rep_id}:${row.staged_data && isPayload(row.staged_data) ? `${row.staged_data.kind}:${row.staged_data.entityId}` : ""}`),
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

export function pickRichestPayTrackerRow(
  rows: PayTrackerStateRow[],
  userId: string,
  period?: { key: string | null; year: number | null; month: number | null; split: string; raw?: string | null } | null,
): PayTrackerStateRow | null {
  const mine = rows.filter((row) => ownerIdFromPayTrackerRow(row) === userId || row.id === userId);
  if (mine.length === 0) return null;
  return mine.slice().sort((left, right) => {
    const leftState = trackerFromPayTrackerFallbacks(left);
    const rightState = trackerFromPayTrackerFallbacks(right);
    const leftSales = collectWorksheetDeals(leftState).length;
    const rightSales = collectWorksheetDeals(rightState).length;
    if (rightSales !== leftSales) return rightSales - leftSales;
    const leftPeriod = periodFromUnknown(left.month_id ?? left.rep_draft ?? left.state ?? left.admin_pushed_snapshot);
    const rightPeriod = periodFromUnknown(right.month_id ?? right.rep_draft ?? right.state ?? right.admin_pushed_snapshot);
    if (period) {
      const preferred = period as import("./pay-period.ts").PayPeriodIdentity;
      const leftHit =
        (matchesPeriodKey(left.month_id, preferred) ? 2 : 0) +
        (periodMatchScore(leftPeriod, preferred) > 0 ? 1 : 0);
      const rightHit =
        (matchesPeriodKey(right.month_id, preferred) ? 2 : 0) +
        (periodMatchScore(rightPeriod, preferred) > 0 ? 1 : 0);
      if (rightHit !== leftHit) return rightHit - leftHit;
      const leftScore = periodMatchScore(leftPeriod, preferred);
      const rightScore = periodMatchScore(rightPeriod, preferred);
      if (rightScore !== leftScore) return rightScore - leftScore;
    }
    return (right.updated_at ?? "").localeCompare(left.updated_at ?? "");
  })[0] ?? null;
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
