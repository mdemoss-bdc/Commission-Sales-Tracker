import { defaultPeriodLabel } from "./commission";
import type { Sale, TrackerState, VehicleType } from "./types";

const STORAGE_KEY = "pay-tracker:v1";

const VEHICLE_VALUES = new Set<VehicleType>(["new-honda", "volkswagen", "used"]);

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asVehicleType(value: unknown): VehicleType | "" {
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
    gross: asNumber(row.gross),
    flat: asNumber(row.flat),
    fi: asNumber(row.fi),
    service: asNumber(row.service),
    drive360: asNumber(row.drive360),
    carCare: asNumber(row.carCare),
    gap: asNumber(row.gap),
  };
}

export function emptyState(): TrackerState {
  return {
    sales: [],
    periodLabel: defaultPeriodLabel(),
  };
}

export function loadState(): TrackerState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyState();
    const data = parsed as Record<string, unknown>;
    const sales = Array.isArray(data.sales)
      ? data.sales.map(parseSale).filter((sale): sale is Sale => sale !== null)
      : [];
    return {
      sales,
      periodLabel: asString(data.periodLabel) || defaultPeriodLabel(),
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: TrackerState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
