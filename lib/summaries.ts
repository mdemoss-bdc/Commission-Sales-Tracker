import {
  countTrades,
  countUnits,
  getCommissionRate,
  roundMoney,
  saleCommission,
  sumField,
} from "./commission.ts";
import type { MonthRecord, PaySheet, Sale, Totals, TrackerState } from "./types.ts";

export function emptyTotals(): Totals {
  return {
    units: 0,
    trades: 0,
    gross: 0,
    flat: 0,
    fi: 0,
    service: 0,
    drive360: 0,
    carCare: 0,
    gap: 0,
    pay: 0,
  };
}

export function summarizeSales(sales: Sale[] | null | undefined): Totals {
  const rows = Array.isArray(sales) ? sales : [];
  const units = countUnits(rows);
  const rate = getCommissionRate(units);
  return {
    units,
    trades: countTrades(rows),
    gross: sumField(rows, "gross"),
    flat: sumField(rows, "flat"),
    fi: sumField(rows, "fi"),
    service: sumField(rows, "service"),
    drive360: sumField(rows, "drive360"),
    carCare: sumField(rows, "carCare"),
    gap: sumField(rows, "gap"),
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
    drive360: roundMoney(left.drive360 + right.drive360),
    carCare: roundMoney(left.carCare + right.carCare),
    gap: roundMoney(left.gap + right.gap),
    pay: roundMoney(left.pay + right.pay),
  };
}

export function summarizeSheet(sheet: PaySheet | null | undefined): Totals {
  return summarizeSales(sheet?.sales);
}

export function summarizeMonth(month: MonthRecord | null | undefined): Totals {
  return (month?.sheets ?? []).map(summarizeSheet).reduce(addTotals, emptyTotals());
}

export function summarizeAll(state: TrackerState | null | undefined): Totals {
  return (state?.months ?? []).map(summarizeMonth).reduce(addTotals, emptyTotals());
}
