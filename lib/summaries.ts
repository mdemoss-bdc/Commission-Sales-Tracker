import {
  countTrades,
  countUnits,
  currentPayTiers,
  getCommissionRate,
  isCountedUnit,
  roundMoney,
  saleCommission,
  sheetVacationPay,
  sumField,
} from "./commission.ts";
import { DEAL_TYPES, parseDealType, type DealType } from "./deal-types.ts";
import { formatMoney } from "./format.ts";
import type { CommissionTier, MonthRecord, PaySheet, Sale, Totals, TrackerState } from "./types.ts";

export function emptyTotals(): Totals {
  return {
    units: 0,
    trades: 0,
    gross: 0,
    flat: 0,
    fi: 0,
    service: 0,
    bonus: 0,
    vacation: 0,
    pay: 0,
  };
}

export function summarizeSales(sales: Sale[] | null | undefined, tiers: CommissionTier[] = currentPayTiers()): Totals {
  const rows = Array.isArray(sales) ? sales : [];
  const units = countUnits(rows);
  const rate = getCommissionRate(units, tiers);
  return {
    units,
    trades: countTrades(rows),
    gross: sumField(rows, "gross"),
    flat: sumField(rows, "flat"),
    fi: sumField(rows, "fi"),
    service: sumField(rows, "service"),
    bonus: 0,
    vacation: 0,
    pay: roundMoney(rows.reduce((sum, sale) => sum + saleCommission(sale, rate), 0)),
  };
}

export function addTotals(left: Totals, right: Totals): Totals {
  return {
    units: left.units + right.units,
    trades: left.trades + right.trades,
    gross: roundMoney(left.gross + right.gross),
    flat: roundMoney(left.flat + right.flat),
    fi: roundMoney(left.fi + right.fi),
    service: roundMoney(left.service + right.service),
    bonus: roundMoney(left.bonus + right.bonus),
    vacation: roundMoney(left.vacation + right.vacation),
    pay: roundMoney(left.pay + right.pay),
  };
}

export function summarizeSheet(sheet: PaySheet | null | undefined, tiers: CommissionTier[] = currentPayTiers()): Totals {
  const salesTotals = summarizeSales(sheet?.sales, tiers);
  const vacation = sheetVacationPay(sheet);
  const bonus = roundMoney(
    (sheet?.bonuses ?? []).reduce((sum, item) => sum + (item.amount || 0), 0),
  );
  return {
    ...salesTotals,
    vacation,
    bonus,
    pay: roundMoney(salesTotals.pay + vacation + bonus),
  };
}

export function summarizeMonth(month: MonthRecord | null | undefined, tiers: CommissionTier[] = currentPayTiers()): Totals {
  return (month?.sheets ?? []).map((sheet) => summarizeSheet(sheet, tiers)).reduce(addTotals, emptyTotals());
}

export function summarizeAll(state: TrackerState | null | undefined, tiers: CommissionTier[] = currentPayTiers()): Totals {
  return (state?.months ?? []).map((month) => summarizeMonth(month, tiers)).reduce(addTotals, emptyTotals());
}

export function salesFromSheet(sheet: PaySheet | null | undefined): Sale[] {
  return Array.isArray(sheet?.sales) ? sheet.sales : [];
}

export function salesFromMonth(month: MonthRecord | null | undefined): Sale[] {
  return (month?.sheets ?? []).flatMap(salesFromSheet);
}

export function salesFromState(state: TrackerState | null | undefined): Sale[] {
  return (state?.months ?? []).flatMap(salesFromMonth);
}

export type DealTypeMix = Record<DealType, { units: number; trades: number; gross: number }>;

export function dealTypeStats(sales: Sale[] | null | undefined): DealTypeMix {
  const blank = () => ({ units: 0, trades: 0, gross: 0 });
  const mix: DealTypeMix = {
    new: blank(),
    used: blank(),
    lease_buyout: blank(),
  };
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!isCountedUnit(sale)) continue;
    const bucket = mix[parseDealType(sale.dealType)];
    bucket.units += 1;
    if (sale.tradeIn) bucket.trades += 1;
    bucket.gross = roundMoney(bucket.gross + sale.gross);
  }
  return mix;
}

export function dealTypeStatExtras(sales: Sale[] | null | undefined): { label: string; value: string }[] {
  const mix = dealTypeStats(sales);
  return DEAL_TYPES.map((type) => ({
    label: type === "lease_buyout" ? "Lease BO" : type === "new" ? "New" : "Used",
    value: String(mix[type].units),
  }));
}

export function hideHeaderStatOnPrint(label: string): boolean {
  const key = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  return (
    key === "gross" ||
    key === "total pay" ||
    key === "total" ||
    key === "trades" ||
    key === "new" ||
    key === "used" ||
    key === "lease bo" ||
    key === "lease buyout"
  );
}

export type PrintAddonRow = {
  key: string;
  label: string;
  detail: string;
  amount: number;
  kind: "deal" | "vacation" | "grand";
};

function formatVacationHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours);
}

export function vacationPayPrintDetail(hours = 0, rate = 0): string {
  if (hours > 0 && rate > 0) return `${formatVacationHours(hours)} hrs × ${formatMoney(rate)}/hr`;
  if (hours > 0) return `${formatVacationHours(hours)} hrs`;
  if (rate > 0) return `${formatMoney(rate)}/hr`;
  return "";
}

export function dealPayFromTotals(totals: Totals): number {
  return roundMoney(totals.pay - totals.vacation - totals.bonus);
}

export function printAddonRows(input: {
  totals: Totals;
  vacationHours?: number;
  vacationRate?: number;
}): PrintAddonRow[] {
  const vacationDetail = vacationPayPrintDetail(input.vacationHours ?? 0, input.vacationRate ?? 0);
  return [
    {
      key: "deal",
      label: "Commissions + Flats + F&I + Service",
      detail: "",
      amount: dealPayFromTotals(input.totals),
      kind: "deal",
    },
    {
      key: "vacation",
      label: "Vacation Pay",
      detail: vacationDetail ? `(${vacationDetail})` : "",
      amount: input.totals.vacation,
      kind: "vacation",
    },
    {
      key: "grand",
      label: "Final Total Pay",
      detail: "(Includes all worksheet pay)",
      amount: input.totals.pay,
      kind: "grand",
    },
  ];
}
