import type { CommissionTier, ExtraPay, PaySheet, Sale, VehicleTypeOption } from "./types.ts";
import { resolveVehicleTypeCategory } from "./vehicles.ts";
import { DEFAULT_DEAL_TYPE } from "./deal-types.ts";

export const COMMISSION_TIERS: CommissionTier[] = [
  { min: 0, max: 3, rate: 0.2, label: "Fewer than 4 units" },
  { min: 4, max: 7, rate: 0.25, label: "4–7 units" },
  { min: 8, max: 11, rate: 0.3, label: "8–11 units" },
  { min: 12, max: Number.POSITIVE_INFINITY, rate: 0.35, label: "12+ units" },
];

export const PACK_LABELS = [
  "Fewer than 4 units · 20%",
  "4–7 units · 25%",
  "8–11 units · 30%",
  "12+ units · 35%",
] as const;

let runtimeTiers: CommissionTier[] | null = null;

export function setRuntimePayTiers(tiers: CommissionTier[] | null | undefined) {
  runtimeTiers = tiers && tiers.length > 0 ? tiers : null;
}

export function currentPayTiers(): CommissionTier[] {
  return runtimeTiers && runtimeTiers.length > 0 ? runtimeTiers : COMMISSION_TIERS;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asMax(value: unknown): number {
  if (value == null || value === "") return Number.POSITIVE_INFINITY;
  const parsed = asNumber(value);
  if (parsed == null) return Number.POSITIVE_INFINITY;
  return parsed;
}

function asRate(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  if (parsed > 1) return parsed / 100;
  return parsed;
}

export function tierLabel(min: number, max: number): string {
  if (!Number.isFinite(max)) return `${min}+ units`;
  if (min <= 0) return `Fewer than ${max + 1} units`;
  return `${min}–${max} units`;
}

export function packLabel(tier: CommissionTier): string {
  return `${tier.label} · ${Math.round(tier.rate * 100)}%`;
}

export function packLabels(tiers: CommissionTier[] = currentPayTiers()): string[] {
  return tiers.map(packLabel);
}

export function normalizePayTiers(data: unknown): CommissionTier[] {
  const rows = Array.isArray(data) ? data : [];
  const tiers: CommissionTier[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const min = asNumber(row.min) ?? asNumber(row.min_units);
    const rate = asRate(row.rate) ?? asRate(row.percent) ?? asRate(row.pack);
    if (min == null || rate == null || min < 0 || rate < 0) continue;
    const max = asMax(row.max ?? row.max_units);
    tiers.push({
      min,
      max,
      rate,
      label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : tierLabel(min, max),
    });
  }
  tiers.sort((left, right) => left.min - right.min || left.max - right.max);
  return tiers.length > 0 ? tiers : COMMISSION_TIERS.map((tier) => ({ ...tier }));
}

export function serializePayTiers(tiers: CommissionTier[]): Array<{ min: number; max: number | null; rate: number }> {
  return tiers.map((tier) => ({
    min: tier.min,
    max: Number.isFinite(tier.max) ? tier.max : null,
    rate: tier.rate,
  }));
}

export function draftPayTiers(tiers: CommissionTier[] = currentPayTiers()): Array<{
  min: string;
  max: string;
  percent: string;
}> {
  return tiers.map((tier) => ({
    min: String(tier.min),
    max: Number.isFinite(tier.max) ? String(tier.max) : "",
    percent: String(Math.round(tier.rate * 100)),
  }));
}

export function parseDraftPayTiers(
  drafts: Array<{ min: string; max: string; percent: string }>,
): { tiers: CommissionTier[]; error: string | null } {
  const tiers: CommissionTier[] = [];
  for (const draft of drafts) {
    const min = asNumber(draft.min);
    const percent = asNumber(draft.percent);
    if (min == null || percent == null) return { tiers: [], error: "Enter min units and a pack percentage for every tier." };
    if (min < 0 || percent < 0) return { tiers: [], error: "Tiers cannot use negative units or percentages." };
    const max = draft.max.trim() === "" ? Number.POSITIVE_INFINITY : asMax(draft.max);
    if (Number.isFinite(max) && max < min) return { tiers: [], error: "Max units must be greater than or equal to min units." };
    tiers.push({ min, max, rate: percent / 100, label: tierLabel(min, max) });
  }
  if (tiers.length === 0) return { tiers: [], error: "Add at least one unit tier." };
  tiers.sort((left, right) => left.min - right.min);
  return { tiers, error: null };
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asSales(sales: Sale[] | null | undefined): Sale[] {
  return Array.isArray(sales) ? sales : [];
}

export function isCountedUnit(sale: Sale): boolean {
  return sale.stockNumber.trim().length > 0 || sale.customerName.trim().length > 0;
}

export function normalizeStockNumber(value: string | null | undefined): string {
  return (value ?? "").toUpperCase();
}

export function vehicleTypeExcludesUnitCount(
  types: VehicleTypeOption[] | null | undefined,
  vehicleTypeId: string | null | undefined,
): boolean {
  if (!vehicleTypeId?.trim()) return false;
  const list = Array.isArray(types) ? types : [];
  const key = vehicleTypeId.trim().toLowerCase();
  const match = list.find(
    (type) => type.id === vehicleTypeId || type.id.toLowerCase() === key || type.label.trim().toLowerCase() === key,
  );
  return Boolean(match?.excludeFromUnitCount);
}

/** Unit volume contribution for one deal: 0, 0.5 (split), or 1. OTHER category is excluded from pack volume. */
export function unitContribution(
  sale: Sale,
  vehicleTypes?: VehicleTypeOption[] | null,
  options?: { includeOther?: boolean },
): number {
  if (!isCountedUnit(sale)) return 0;
  if (vehicleTypeExcludesUnitCount(vehicleTypes, sale.vehicleType)) return 0;
  const category = resolveVehicleTypeCategory(vehicleTypes, sale.vehicleType);
  if (category === "OTHER" && !options?.includeOther) return 0;
  return sale.splitDeal ? 0.5 : 1;
}

export function countUnits(
  sales: Sale[] | null | undefined,
  vehicleTypes?: VehicleTypeOption[] | null,
): number {
  return roundMoney(
    asSales(sales).reduce((sum, sale) => sum + unitContribution(sale, vehicleTypes), 0),
  );
}

export function countUnitsByCategory(
  sales: Sale[] | null | undefined,
  vehicleTypes: VehicleTypeOption[] | null | undefined,
  category: "NEW" | "USED" | "OTHER",
): number {
  return roundMoney(
    asSales(sales).reduce((sum, sale) => {
      if (resolveVehicleTypeCategory(vehicleTypes, sale.vehicleType) !== category) return sum;
      return sum + unitContribution(sale, vehicleTypes, { includeOther: category === "OTHER" });
    }, 0),
  );
}

export function countTrades(
  sales: Sale[] | null | undefined,
  vehicleTypes?: VehicleTypeOption[] | null,
): number {
  return asSales(sales).filter(
    (sale) => unitContribution(sale, vehicleTypes) > 0 && sale.tradeIn,
  ).length;
}

export function getCommissionRate(units: number, tiers: CommissionTier[] = currentPayTiers()): number {
  const list = tiers.length > 0 ? tiers : COMMISSION_TIERS;
  for (const tier of list) {
    const max = Number.isFinite(tier.max) ? tier.max : Number.POSITIVE_INFINITY;
    if (units >= tier.min && units <= max) return tier.rate;
  }
  return list[list.length - 1]?.rate ?? 0.2;
}

export function getActiveTier(units: number, tiers: CommissionTier[] = currentPayTiers()): CommissionTier {
  const list = tiers.length > 0 ? tiers : COMMISSION_TIERS;
  const tier = list.find((item) => {
    const max = Number.isFinite(item.max) ? item.max : Number.POSITIVE_INFINITY;
    return units >= item.min && units <= max;
  });
  return tier ?? list[list.length - 1] ?? COMMISSION_TIERS[0];
}

export function nextPackGoal(
  units: number,
  tiers: CommissionTier[] = currentPayTiers(),
): { unitsNeeded: number; rate: number } | null {
  const list = [...(tiers.length > 0 ? tiers : COMMISSION_TIERS)].sort((left, right) => left.min - right.min);
  const next = list.find((tier) => tier.min > units);
  if (!next) return null;
  return { unitsNeeded: next.min - units, rate: next.rate };
}

export function frontEndPay(gross: number, rate: number): number {
  return roundMoney(gross * rate);
}

export function backendPay(sale: Sale): number {
  return roundMoney(sale.flat + sale.fi + sale.service);
}

export function saleCommission(sale: Sale, rate: number): number {
  return roundMoney(frontEndPay(sale.gross, rate) + backendPay(sale));
}

export function sumField(sales: Sale[] | null | undefined, field: keyof Sale): number {
  return roundMoney(
    asSales(sales).reduce((total, sale) => {
      const value = sale[field];
      return total + (typeof value === "number" ? value : 0);
    }, 0),
  );
}

export function saleHasData(sale: Sale): boolean {
  return Boolean(
    sale.stockNumber.trim() ||
      sale.customerName.trim() ||
      sale.vehicleType ||
      sale.tradeIn ||
      sale.splitDeal ||
      sale.gross ||
      sale.flat ||
      sale.fi ||
      sale.service,
  );
}

export function shouldAppendLeadRowOnTab(
  event: { key: string; shiftKey: boolean },
  options: { isLastRow: boolean; rowHasContent: boolean; readOnly?: boolean },
): boolean {
  if (options.readOnly) return false;
  if (event.key !== "Tab" || event.shiftKey) return false;
  return options.isLastRow && options.rowHasContent;
}

export function vacationPayAmount(hours = 0, rate = 0, fallback = 0): number {
  const parsedHours = Number.isFinite(hours) ? hours : 0;
  const parsedRate = Number.isFinite(rate) ? rate : 0;
  if (parsedHours === 0 && parsedRate === 0) return roundMoney(fallback);
  return roundMoney(parsedHours * parsedRate);
}

export function sheetVacationPay(
  sheet: Pick<PaySheet, "vacationHours" | "vacationRate" | "vacationPay"> | null | undefined,
): number {
  if (!sheet) return 0;
  return vacationPayAmount(sheet.vacationHours ?? 0, sheet.vacationRate ?? 0, sheet.vacationPay ?? 0);
}

export function vacationFields(hours: number, rate: number, fallback = 0) {
  return {
    vacationHours: hours,
    vacationRate: rate,
    vacationPay: vacationPayAmount(hours, rate, fallback),
  };
}

export function regularPayAmount(hours = 0, rate = 0): number {
  const parsedHours = Number.isFinite(hours) ? hours : 0;
  const parsedRate = Number.isFinite(rate) ? rate : 0;
  if (parsedHours <= 0 || parsedRate <= 0) return 0;
  return roundMoney(parsedHours * parsedRate);
}

/** Hourly pay mode: regular hours + rate both > 0 → deal table earnings excluded from Total Pay. */
export function isHourlyPayMode(
  sheet: Pick<PaySheet, "regularHours" | "hourlyRate"> | null | undefined,
): boolean {
  return regularPayAmount(sheet?.regularHours ?? 0, sheet?.hourlyRate ?? 0) > 0;
}

export function regularPayFields(hours: number, rate: number) {
  return {
    regularHours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    hourlyRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
  };
}

export function createBonus(): ExtraPay {
  return {
    id: crypto.randomUUID(),
    label: "",
    amount: 0,
  };
}

export function createSale(): Sale {
  return {
    id: crypto.randomUUID(),
    stockNumber: "",
    customerName: "",
    vehicleType: "",
    dealType: DEFAULT_DEAL_TYPE,
    tradeIn: false,
    splitDeal: false,
    gross: 0,
    flat: 0,
    fi: 0,
    service: 0,
  };
}
