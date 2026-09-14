import type { CommissionTier, Sale } from "./types";

export const COMMISSION_TIERS: CommissionTier[] = [
  { min: 0, max: 3, rate: 0.2, label: "Fewer than 4 units" },
  { min: 4, max: 7, rate: 0.25, label: "4–7 units" },
  { min: 8, max: 11, rate: 0.3, label: "8–11 units" },
  { min: 12, max: Number.POSITIVE_INFINITY, rate: 0.3, label: "12+ units" },
];

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isCountedUnit(sale: Sale): boolean {
  return sale.stockNumber.trim().length > 0 || sale.customerName.trim().length > 0;
}

export function countUnits(sales: Sale[]): number {
  return sales.filter(isCountedUnit).length;
}

export function getCommissionRate(units: number): number {
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
  return null;
}

export function frontEndPay(gross: number, rate: number): number {
  return roundMoney(gross * rate);
}

export function backendPay(sale: Sale): number {
  return roundMoney(
    sale.flat + sale.fi + sale.service + sale.drive360 + sale.carCare + sale.gap,
  );
}

export function saleCommission(sale: Sale, rate: number): number {
  return roundMoney(frontEndPay(sale.gross, rate) + backendPay(sale));
}

export function sumField(sales: Sale[], field: keyof Sale): number {
  return roundMoney(
    sales.reduce((total, sale) => {
      const value = sale[field];
      return total + (typeof value === "number" ? value : 0);
    }, 0),
  );
}

export function createSale(): Sale {
  return {
    id: crypto.randomUUID(),
    stockNumber: "",
    customerName: "",
    vehicleType: "",
    gross: 0,
    flat: 0,
    fi: 0,
    service: 0,
    drive360: 0,
    carCare: 0,
    gap: 0,
  };
}

export function defaultPeriodLabel(date = new Date()): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
