import assert from "node:assert/strict";
import test from "node:test";
import {
  countTrades,
  countUnits,
  createSale,
  getCommissionRate,
  saleHasData,
  shouldAppendLeadRowOnTab,
  nextPackGoal,
  parseDraftPayTiers,
  saleCommission,
  setRuntimePayTiers,
  vacationPayAmount,
} from "./commission.ts";
import { addMonth, addSheet, monthLabel } from "./records.ts";
import { addTotals, summarizeAll, summarizeMonth, summarizeSales, summarizeSheet } from "./summaries.ts";
import { nextSheetRange, sheetRangeLabel } from "./sheet-range.ts";
import { addVehicleType, removeVehicleType } from "./vehicles.ts";
import type { Sale, TrackerState } from "./types.ts";

function sale(patch: Partial<Sale>): Sale {
  return { ...createSale(), ...patch };
}

test("Tab on the last filled lead row appends a new row; Shift+Tab does not", () => {
  const filled = sale({ stockNumber: "A1", customerName: "Pat" });
  assert.equal(saleHasData(filled), true);
  assert.equal(saleHasData(createSale()), false);
  assert.equal(
    shouldAppendLeadRowOnTab({ key: "Tab", shiftKey: false }, { isLastRow: true, rowHasContent: true }),
    true,
  );
  assert.equal(
    shouldAppendLeadRowOnTab({ key: "Tab", shiftKey: true }, { isLastRow: true, rowHasContent: true }),
    false,
  );
  assert.equal(
    shouldAppendLeadRowOnTab({ key: "Tab", shiftKey: false }, { isLastRow: false, rowHasContent: true }),
    false,
  );
  assert.equal(
    shouldAppendLeadRowOnTab({ key: "Tab", shiftKey: false }, { isLastRow: true, rowHasContent: false }),
    false,
  );
  assert.equal(
    shouldAppendLeadRowOnTab(
      { key: "Tab", shiftKey: false },
      { isLastRow: true, rowHasContent: true, readOnly: true },
    ),
    false,
  );
  assert.equal(
    shouldAppendLeadRowOnTab({ key: "Enter", shiftKey: false }, { isLastRow: true, rowHasContent: true }),
    false,
  );
});

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

test("custom organization pay tiers change pack rate and next-goal math", () => {
  const tiers = [
    { min: 0, max: 1, rate: 0.1, label: "Fewer than 2 units" },
    { min: 2, max: Number.POSITIVE_INFINITY, rate: 0.4, label: "2+ units" },
  ];
  setRuntimePayTiers(tiers);
  assert.equal(getCommissionRate(0), 0.1);
  assert.equal(getCommissionRate(2), 0.4);
  assert.equal(nextPackGoal(0)?.rate, 0.4);
  setRuntimePayTiers(null);
  assert.equal(getCommissionRate(4), 0.25);
});

test("draft pay tiers serialize min, max, and percent", () => {
  const parsed = parseDraftPayTiers([
    { min: "0", max: "3", percent: "20" },
    { min: "4", max: "", percent: "35" },
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.tiers[1]?.max, Number.POSITIVE_INFINITY);
  assert.equal(parsed.tiers[1]?.rate, 0.35);
});

test("a row counts as a unit when stock or customer is filled", () => {
  assert.equal(countUnits([sale({})]), 0);
  assert.equal(countUnits([sale({ stockNumber: "H1234" })]), 1);
  assert.equal(countUnits([sale({ customerName: "Jane Doe" })]), 1);
  assert.equal(countUnits(undefined), 0);
  assert.equal(countTrades(undefined), 0);
});

test("trade-ins count only on filled deals", () => {
  assert.equal(countTrades([sale({ tradeIn: true })]), 0);
  assert.equal(countTrades([sale({ customerName: "Alex", tradeIn: true })]), 1);
  assert.equal(countTrades([sale({ stockNumber: "U1", tradeIn: false })]), 0);
});

test("vehicle types can be added and removed for any make", () => {
  let types = addVehicleType([], "Toyota");
  types = addVehicleType(types, "Used");
  types = addVehicleType(types, "toyota");
  assert.equal(types.length, 2);
  assert.equal(types[0].label, "Toyota");
  types = removeVehicleType(types, types[0].id);
  assert.equal(types.length, 1);
  assert.equal(types[0].label, "Used");
});

test("deal pay is pack of gross plus flats, F&I, and service", () => {
  const deal = sale({
    gross: 1000,
    flat: 50,
    fi: 100,
    service: 25,
  });
  assert.equal(saleCommission(deal, 0.2), 375);
  assert.equal(saleCommission(deal, 0.35), 525);
});

test("months are named January through December and hold two sheets", () => {
  let state: TrackerState = { months: [], vehicleTypes: [] };
  const created = addMonth(state, 2026, 1);
  assert.ok("monthId" in created);
  assert.equal(monthLabel(2026, 1), "January 2026");
  state = created.state;
  const first = addSheet(state, created.monthId);
  assert.ok("sheetId" in first);
  state = first.state;
  assert.equal(state.months[0].sheets[0].startDay, 1);
  assert.equal(state.months[0].sheets[0].endDay, 15);
  const second = addSheet(state, created.monthId);
  assert.ok("sheetId" in second);
  state = second.state;
  assert.equal(state.months[0].sheets[1].startDay, 16);
  assert.equal(state.months[0].sheets[1].endDay, 31);
  assert.equal(sheetRangeLabel(1, 15, 2026, 1), "1st–15th");
  assert.equal(sheetRangeLabel(16, 31, 2026, 1), "16th–end");
  assert.deepEqual(nextSheetRange([], 2026, 2), { startDay: 1, endDay: 15 });
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
          { id: "s1", startDay: 1, endDay: 15, sales: [sale({ customerName: "A", gross: 1000 })], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] },
        ],
      },
      {
        id: "m2",
        year: 2026,
        month: 2,
        sheets: [
          { id: "s2", startDay: 16, endDay: 28, sales: [sale({ customerName: "B", gross: 500, tradeIn: true })], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] },
        ],
      },
    ],
    vehicleTypes: [],
  };
  assert.equal(summarizeMonth(state.months[0]).pay, 200);
  assert.equal(summarizeAll(state).units, 2);
  assert.equal(summarizeAll(state).trades, 1);
  assert.equal(summarizeAll(state).pay, 300);
  assert.equal(summarizeAll(undefined).units, 0);
  assert.equal(summarizeSales(undefined).pay, 0);
});

test("vacation pay and named bonuses add to the sheet total", () => {
  const totals = summarizeSheet({
    id: "s1",
    startDay: 1,
    endDay: 15,
    sales: [sale({ customerName: "A", gross: 1000 })],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 150,
    bonuses: [{ id: "b1", label: "CSI", amount: 50 }],
  });
  assert.equal(totals.pay, 400);
  assert.equal(totals.vacation, 150);
  assert.equal(totals.bonus, 50);
});

test("vacation total is hours times hourly rate", () => {
  assert.equal(vacationPayAmount(40, 18.5), 740);
  assert.equal(vacationPayAmount(0, 0, 150), 150);
  assert.equal(vacationPayAmount(8, 0, 150), 0);
  const totals = summarizeSheet({
    id: "s1",
    startDay: 1,
    endDay: 15,
    sales: [sale({ customerName: "A", gross: 1000 })],
    vacationHours: 40,
    vacationRate: 18.5,
    vacationPay: 0,
    bonuses: [],
  });
  assert.equal(totals.vacation, 740);
  assert.equal(totals.pay, 940);
});
