import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney } from "./format.ts";
import { summarizePayByMonth, type SheetPayEntry } from "./month-totals.ts";

function entry(year: number, month: number, pay: number): SheetPayEntry {
  return { filterKey: `${year}-${month}`, year, month, pay };
}

test("summarizePayByMonth sums both half-month sheets into one month total", () => {
  const rows = summarizePayByMonth([
    entry(2026, 10, 3210.38), // October 2026 · 16th–end
    entry(2026, 10, 1900.55), // October 2026 · 1st–15th
    entry(2026, 9, 2097.27), // September 2026 · 16th–end
    entry(2026, 9, 1532.5), // September 2026 · 1st–15th
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "October 2026");
  assert.equal(formatMoney(rows[0].pay), "$5,110.93");
  assert.equal(rows[1].label, "September 2026");
  assert.equal(formatMoney(rows[1].pay), "$3,629.77");
});

test("summarizePayByMonth keeps a single-sheet month at that sheet's total", () => {
  const rows = summarizePayByMonth([entry(2026, 8, 1750)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "August 2026");
  assert.equal(rows[0].pay, 1750);
});

test("summarizePayByMonth orders newest month first across years", () => {
  const rows = summarizePayByMonth([
    entry(2025, 12, 900),
    entry(2026, 1, 1100),
    entry(2025, 11, 800),
  ]);
  assert.deepEqual(
    rows.map((row) => row.label),
    ["January 2026", "December 2025", "November 2025"],
  );
});

test("summarizePayByMonth does not merge the same month across years", () => {
  const rows = summarizePayByMonth([entry(2025, 10, 100), entry(2026, 10, 200)]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pay, 200);
  assert.equal(rows[1].pay, 100);
});

test("summarizePayByMonth returns no rows when there are no sheets", () => {
  assert.deepEqual(summarizePayByMonth([]), []);
});
