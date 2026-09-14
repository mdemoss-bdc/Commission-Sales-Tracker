import type { CommissionTier, ExtraPay, PaySheet, Sale } from "./types.ts";
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

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asSales(sales: Sale[] | null | undefined): Sale[] {
  return Array.isArray(sales) ? sales : [];
}

export function isCountedUnit(sale: Sale): boolean {
  return sale.stockNumber.trim().length > 0 || sale.customerName.trim().length > 0;
}

export function countUnits(sales: Sale[] | null | undefined): number {
  return asSales(sales).filter(isCountedUnit).length;
}

export function countTrades(sales: Sale[] | null | undefined): number {
  return asSales(sales).filter((sale) => isCountedUnit(sale) && sale.tradeIn).length;
}

export function getCommissionRate(units: number): number {
  if (units >= 12) return 0.35;
  if (units >= 8) return 0.3;
  if (units >= 4) return 0.25;
  return 0.2;
}

export function getActiveTier(units: number): CommissionTier {
  const tier = COMMISSION_TIERS.find((item) => units >= item.min && units <= item.max);
  return tier ?? COMMISSION_TIERS[0];
}

export function nextPackGoal(units: number): { unitsNeeded: number; rate: number } | null {
  if (units < 4) return { unitsNeeded: 4 - units, rate: 0.25 };
  if (units < 8) return { unitsNeeded: 8 - units, rate: 0.3 };
  if (units < 12) return { unitsNeeded: 12 - units, rate: 0.35 };
  return null;
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
      sale.gross ||
      sale.flat ||
      sale.fi ||
      sale.service,
  );
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
    gross: 0,
    flat: 0,
    fi: 0,
    service: 0,
  };
}
