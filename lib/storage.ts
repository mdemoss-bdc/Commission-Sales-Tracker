import { vacationPayAmount } from "./commission.ts";
import { createMonth, createPaySheet, currentMonth, currentYear, monthLabel, sortMonths } from "./records.ts";
import { rangeFromLegacyName } from "./sheet-range.ts";
import type { ExtraPay, MonthRecord, PaySheet, Sale, TrackerState, VehicleTypeOption } from "./types.ts";
import { parseDealType } from "./deal-types.ts";
import { LEGACY_VEHICLE_TYPES } from "./vehicles.ts";

const GUEST_STORAGE_KEY = "pay-tracker:v2";
const LEGACY_KEY = "pay-tracker:v1";
const GUEST_CLAIMED_KEY = "pay-tracker:guest-claimed";

export function trackerStorageKey(userId: string | null): string {
  return userId ? `pay-tracker:v2:user:${userId}` : GUEST_STORAGE_KEY;
}

/** Profile/role/location prefs — never the per-user workbook cache. */
export function isSessionPreferenceKey(key: string): boolean {
  if (key === "pay-tracker:profile" || key === "pay-tracker:role") return true;
  if (key.startsWith("pay-tracker:profile:") || key.startsWith("pay-tracker:role:")) return true;
  if (key === "pay-tracker:location" || key.startsWith("pay-tracker:location")) return true;
  return false;
}

export function clearSessionPreferenceKeys(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && isSessionPreferenceKey(key)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asVehicleType(value: unknown): string {
  if (value === "new-honda") return "honda";
  const label = asString(value).trim();
  return label;
}

function parseSale(value: unknown): Sale | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    stockNumber: asString(row.stockNumber),
    customerName: asString(row.customerName),
    vehicleType: asVehicleType(row.vehicleType),
    dealType: parseDealType(row.dealType ?? row.deal_type),
    tradeIn: asBoolean(row.tradeIn),
    gross: asNumber(row.gross),
    flat: asNumber(row.flat),
    fi: asNumber(row.fi),
    service: asNumber(row.service),
  };
}

function parseBonus(value: unknown): ExtraPay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    label: asString(row.label),
    amount: asNumber(row.amount),
  };
}

function parseVehicleType(value: unknown): VehicleTypeOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  const label = asString(row.label).trim();
  if (!id || !label) return null;
  return { id, label };
}

function parseVehicleTypes(value: unknown): VehicleTypeOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const types: VehicleTypeOption[] = [];
  for (const item of value) {
    const type = parseVehicleType(item);
    if (!type || seen.has(type.id)) continue;
    seen.add(type.id);
    types.push(type);
  }
  return types;
}

function parseSheet(value: unknown, index = 0): PaySheet | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  const sales = Array.isArray(row.sales)
    ? row.sales.map(parseSale).filter((sale): sale is Sale => sale !== null)
    : [];
  const bonuses = Array.isArray(row.bonuses)
    ? row.bonuses.map(parseBonus).filter((bonus): bonus is ExtraPay => bonus !== null)
    : [];
  const start = asNumber(row.startDay);
  const end = asNumber(row.endDay);
  const range =
    start >= 1 && end >= 1
      ? { startDay: Math.min(31, start), endDay: Math.min(31, Math.max(start, end)) }
      : rangeFromLegacyName(asString(row.name), index);
  return {
    id,
    startDay: range.startDay,
    endDay: range.endDay,
    sales,
    vacationHours: asNumber(row.vacationHours ?? row.vacation_hours),
    vacationRate: asNumber(row.vacationRate ?? row.vacation_rate),
    vacationPay: vacationPayAmount(
      asNumber(row.vacationHours ?? row.vacation_hours),
      asNumber(row.vacationRate ?? row.vacation_rate),
      asNumber(row.vacationPay ?? row.vacation_pay),
    ),
    bonuses,
  };
}

function parseMonth(value: unknown): MonthRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  const year = asNumber(row.year);
  const month = asNumber(row.month);
  if (!id || year < 2000 || month < 1 || month > 12) return null;
  const sheets = Array.isArray(row.sheets)
    ? row.sheets
        .map((sheet, index) => parseSheet(sheet, index))
        .filter((sheet): sheet is PaySheet => sheet !== null)
    : [];
  return { id, year, month, sheets };
}

function parsePeriodLabel(label: string): { year: number; month: number } {
  const now = { year: currentYear(), month: currentMonth() };
  const match = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return now;
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthIndex = names.indexOf(match[1].toLowerCase());
  const year = Number(match[2]);
  if (monthIndex < 0 || !Number.isFinite(year)) return now;
  return { year, month: monthIndex + 1 };
}

function migrateLegacy(raw: string): TrackerState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Record<string, unknown>;
    const sales = Array.isArray(data.sales)
      ? data.sales.map(parseSale).filter((sale): sale is Sale => sale !== null)
      : [];
    const period = parsePeriodLabel(asString(data.periodLabel) || monthLabel(currentYear(), currentMonth()));
    const month = createMonth(period.year, period.month);
    const sheet = createPaySheet(1, 15);
    sheet.sales = sales;
    month.sheets = [sheet];
    return { months: [month], vehicleTypes: LEGACY_VEHICLE_TYPES };
  } catch {
    return null;
  }
}

export function emptyState(): TrackerState {
  return { months: [], vehicleTypes: [] };
}

export function hasTrackerData(state: TrackerState): boolean {
  return state.months.length > 0 || state.vehicleTypes.length > 0;
}

export function parseTrackerState(value: unknown): TrackerState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const months = Array.isArray(data.months)
    ? data.months.map(parseMonth).filter((month): month is MonthRecord => month !== null)
    : [];
  const vehicleTypes =
    "vehicleTypes" in data ? parseVehicleTypes(data.vehicleTypes) : LEGACY_VEHICLE_TYPES;
  return { months: sortMonths(months), vehicleTypes };
}

export function loadState(userId: string | null = null): TrackerState {
  if (typeof window === "undefined") return emptyState();
  try {
    const current = window.localStorage.getItem(trackerStorageKey(userId));
    if (current) {
      return parseTrackerState(JSON.parse(current)) ?? emptyState();
    }
    if (userId) return emptyState();
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      if (migrated) {
        saveState(migrated, null);
        return migrated;
      }
    }
    return emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state: TrackerState, userId: string | null = null): void {
  window.localStorage.setItem(trackerStorageKey(userId), JSON.stringify(state));
}

export function takeGuestStateForUser(userId: string): TrackerState | null {
  if (typeof window === "undefined") return null;
  const claimedBy = window.localStorage.getItem(GUEST_CLAIMED_KEY);
  if (claimedBy && claimedBy !== userId) return null;
  const guest = loadState(null);
  if (!hasTrackerData(guest)) return null;
  window.localStorage.setItem(GUEST_CLAIMED_KEY, userId);
  saveState(guest, userId);
  saveState(emptyState(), null);
  return guest;
}
