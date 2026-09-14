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

export function summarizeSales(sales: Sale[]): Totals {
  const units = countUnits(sales);
  const rate = getCommissionRate(units);
  return {
    units,
    trades: countTrades(sales),
    gross: sumField(sales, "gross"),
    flat: sumField(sales, "flat"),
    fi: sumField(sales, "fi"),
    service: sumField(sales, "service"),
    drive360: sumField(sales, "drive360"),
    carCare: sumField(sales, "carCare"),
    gap: sumField(sales, "gap"),
    pay: roundMoney(sales.reduce((sum, sale) => sum + saleCommission(sale, rate), 0)),
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

export function summarizeSheet(sheet: PaySheet): Totals {
  return summarizeSales(sheet.sales);
}

export function summarizeMonth(month: MonthRecord): Totals {
  return month.sheets.map(summarizeSheet).reduce(addTotals, emptyTotals());
}

export function summarizeAll(state: TrackerState): Totals {
  return state.months.map(summarizeMonth).reduce(addTotals, emptyTotals());
}
