import assert from "node:assert/strict";
import test from "node:test";
import {
  countTrades,
  countUnits,
  createSale,
  getCommissionRate,
  saleCommission,
} from "./commission.ts";
import { addMonth, addSheet, monthLabel } from "./records.ts";
import { addTotals, summarizeAll, summarizeMonth, summarizeSales } from "./summaries.ts";
import type { Sale, TrackerState } from "./types.ts";

function sale(patch: Partial<Sale>): Sale {
  return { ...createSale(), ...patch };
}

test("pack rate follows the unit schedule including 35% at 12+", () => {
  assert.equal(getCommissionRate(0), 0.2);
  assert.equal(getCommissionRate(3), 0.2);
  assert.equal(getCommissionRate(4), 0.25);
  assert.equal(getCommissionRate(7), 0.25);
  assert.equal(getCommissionRate(8), 0.3);
  assert.equal(getCommissionRate(11), 0.3);
  assert.equal(getCommissionRate(12), 0.35);
  assert.equal(getCommissionRate(20), 0.35);
});

test("a row counts as a unit when stock or customer is filled", () => {
  assert.equal(countUnits([sale({})]), 0);
  assert.equal(countUnits([sale({ stockNumber: "H1234" })]), 1);
  assert.equal(countUnits([sale({ customerName: "Jane Doe" })]), 1);
});

test("trade-ins count only on filled deals", () => {
  assert.equal(countTrades([sale({ tradeIn: true })]), 0);
  assert.equal(countTrades([sale({ customerName: "Alex", tradeIn: true })]), 1);
  assert.equal(countTrades([sale({ stockNumber: "U1", tradeIn: false })]), 0);
});

test("deal pay is pack of gross plus flats and backend products", () => {
  const deal = sale({
    gross: 1000,
    flat: 50,
    fi: 100,
    service: 25,
    drive360: 10,
    carCare: 15,
    gap: 20,
  });
  assert.equal(saleCommission(deal, 0.2), 420);
  assert.equal(saleCommission(deal, 0.35), 570);
});

test("months are named January through December and hold two sheets", () => {
  let state: TrackerState = { months: [] };
  const created = addMonth(state, 2026, 1);
  assert.ok("monthId" in created);
  assert.equal(monthLabel(2026, 1), "January 2026");
  state = created.state;
  const first = addSheet(state, created.monthId);
  assert.ok("sheetId" in first);
  state = first.state;
  const second = addSheet(state, created.monthId);
  assert.ok("sheetId" in second);
  state = second.state;
  const third = addSheet(state, created.monthId);
  assert.ok("error" in third);
  const duplicate = addMonth(state, 2026, 1);
  assert.ok("error" in duplicate);
});

test("combined totals add both sheets and months without mixing pack rates", () => {
  const sheetA = summarizeSales([
    sale({ customerName: "A", gross: 1000 }),
    sale({ customerName: "B", gross: 1000 }),
    sale({ customerName: "C", gross: 1000 }),
  ]);
  const sheetB = summarizeSales([
    sale({ customerName: "D", gross: 1000, tradeIn: true }),
    sale({ customerName: "E", gross: 1000, tradeIn: true }),
    sale({ customerName: "F", gross: 1000 }),
    sale({ customerName: "G", gross: 1000 }),
  ]);
  assert.equal(sheetA.units, 3);
  assert.equal(sheetA.pay, 600);
  assert.equal(sheetB.units, 4);
  assert.equal(sheetB.pay, 1000);
  const month = addTotals(sheetA, sheetB);
  assert.equal(month.units, 7);
  assert.equal(month.trades, 2);
  assert.equal(month.pay, 1600);

  const state: TrackerState = {
    months: [
      {
        id: "m1",
        year: 2026,
        month: 1,
        sheets: [
          { id: "s1", name: "Sheet 1", sales: [sale({ customerName: "A", gross: 1000 })] },
        ],
      },
      {
        id: "m2",
        year: 2026,
        month: 2,
        sheets: [
          { id: "s2", name: "Sheet 1", sales: [sale({ customerName: "B", gross: 500, tradeIn: true })] },
        ],
      },
    ],
  };
  assert.equal(summarizeMonth(state.months[0]).pay, 200);
  assert.equal(summarizeAll(state).units, 2);
  assert.equal(summarizeAll(state).trades, 1);
  assert.equal(summarizeAll(state).pay, 300);
});
