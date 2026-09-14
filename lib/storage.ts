import { createMonth, createPaySheet, currentMonth, currentYear, monthLabel, sortMonths } from "./records";
import type { ExtraPay, MonthRecord, PaySheet, Sale, TrackerState, VehicleType } from "./types";

const STORAGE_KEY = "pay-tracker:v2";
const LEGACY_KEY = "pay-tracker:v1";

const VEHICLE_VALUES = new Set<VehicleType>(["honda", "volkswagen", "used"]);

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asVehicleType(value: unknown): VehicleType | "" {
  if (value === "new-honda") return "honda";
  return typeof value === "string" && VEHICLE_VALUES.has(value as VehicleType)
    ? (value as VehicleType)
    : "";
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
    tradeIn: asBoolean(row.tradeIn),
    gross: asNumber(row.gross),
    flat: asNumber(row.flat),
    fi: asNumber(row.fi),
    service: asNumber(row.service),
    drive360: asNumber(row.drive360),
    carCare: asNumber(row.carCare),
    gap: asNumber(row.gap),
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

function parseSheet(value: unknown): PaySheet | null {
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
  return {
    id,
    name: asString(row.name) || "Sheet 1",
    sales,
    vacationPay: asNumber(row.vacationPay),
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
    ? row.sheets.map(parseSheet).filter((sheet): sheet is PaySheet => sheet !== null)
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
    const sheet = createPaySheet("Sheet 1");
    sheet.sales = sales;
    month.sheets = [sheet];
    return { months: [month] };
  } catch {
    return null;
  }
}

export function emptyState(): TrackerState {
  return { months: [] };
}

export function loadState(): TrackerState {
  if (typeof window === "undefined") return emptyState();
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current) as unknown;
      if (!parsed || typeof parsed !== "object") return emptyState();
      const data = parsed as Record<string, unknown>;
      const months = Array.isArray(data.months)
        ? data.months.map(parseMonth).filter((month): month is MonthRecord => month !== null)
        : [];
      return { months: sortMonths(months) };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      if (migrated) {
        saveState(migrated);
        return migrated;
      }
    }
    return emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(state: TrackerState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
