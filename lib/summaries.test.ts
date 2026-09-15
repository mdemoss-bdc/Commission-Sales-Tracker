import assert from "node:assert/strict";
import test from "node:test";
import { hideHeaderStatOnPrint, printAddonRows, summarizeSheet } from "./summaries.ts";
import type { PaySheet } from "./types.ts";

test("print header keeps units, trades, and pack and hides the other recap cards", () => {
  assert.equal(hideHeaderStatOnPrint("Units"), false);
  assert.equal(hideHeaderStatOnPrint("Trades"), false);
  assert.equal(hideHeaderStatOnPrint("Pack"), false);
  assert.equal(hideHeaderStatOnPrint("Months"), false);
  assert.equal(hideHeaderStatOnPrint("Gross"), true);
  assert.equal(hideHeaderStatOnPrint("Total pay"), true);
  assert.equal(hideHeaderStatOnPrint("Total"), true);
  assert.equal(hideHeaderStatOnPrint("New"), true);
  assert.equal(hideHeaderStatOnPrint("Used"), true);
  assert.equal(hideHeaderStatOnPrint("Lease BO"), true);
  assert.equal(hideHeaderStatOnPrint("Lease Buyout"), true);
});

test("print add-on rows itemize vacation, bonuses, and final total pay", () => {
  const sheet: PaySheet = {
    id: "s1",
    startDay: 1,
    endDay: 15,
    sales: [],
    vacationHours: 40,
    vacationRate: 18.5,
    vacationPay: 0,
    bonuses: [
      { id: "b1", label: "CSI Spiff", amount: 50 },
      { id: "b2", label: "Volume bonus", amount: 100 },
    ],
  };
  const totals = summarizeSheet(sheet);
  const rows = printAddonRows({
    totals,
    vacationHours: sheet.vacationHours,
    vacationRate: sheet.vacationRate,
    bonuses: sheet.bonuses,
  });

  const vacation = rows.find((row) => row.kind === "vacation");
  const csi = rows.find((row) => row.label === "CSI Spiff");
  const volume = rows.find((row) => row.label === "Volume bonus");
  const bonusTotal = rows.find((row) => row.kind === "bonus-total");
  const grand = rows.find((row) => row.kind === "grand");
  const deal = rows.find((row) => row.kind === "deal");

  assert.equal(vacation?.amount, 740);
  assert.equal(vacation?.detail, "40 hrs × $18.50/hr");
  assert.equal(csi?.amount, 50);
  assert.equal(volume?.amount, 100);
  assert.equal(bonusTotal?.amount, 150);
  assert.equal(deal?.amount, 0);
  assert.equal(grand?.amount, 890);
  assert.equal(grand?.amount, (deal?.amount ?? 0) + (vacation?.amount ?? 0) + (bonusTotal?.amount ?? 0));
});

test("print add-on rows still show a zero bonus total when none are logged", () => {
  const totals = summarizeSheet({
    id: "s2",
    startDay: 16,
    endDay: 31,
    sales: [],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 150,
    bonuses: [],
  });
  const rows = printAddonRows({ totals, bonuses: [] });
  assert.equal(rows.find((row) => row.kind === "vacation")?.amount, 150);
  assert.equal(rows.find((row) => row.kind === "bonus-total")?.amount, 0);
  assert.equal(rows.find((row) => row.kind === "bonus-total")?.detail, "None logged");
  assert.equal(rows.find((row) => row.kind === "grand")?.amount, 150);
});
