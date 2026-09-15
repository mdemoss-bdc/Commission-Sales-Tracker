import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayTrackerDocument,
  dealRowsFromPayTrackerState,
  mergePayTrackerDealRows,
  parsePayTrackerStateRow,
  pickLatestPayTrackerRow,
  trackerStateFromPayTrackerDocument,
} from "./pay-tracker-state.ts";
import { parseTrackerState } from "./storage.ts";
import type { TrackerState } from "./types.ts";

const sample: TrackerState = {
  vehicleTypes: [{ id: "vt1", label: "Honda" }],
  months: [
    {
      id: "m1",
      year: 2026,
      month: 9,
      sheets: [
        {
          id: "s1",
          startDay: 1,
          endDay: 15,
          vacationHours: 8,
          vacationRate: 20,
          vacationPay: 0,
          bonuses: [{ id: "b1", label: "Spiff", amount: 250 }],
          sales: [
            {
              id: "d1",
              stockNumber: "H100",
              customerName: "Jane",
              vehicleType: "vt1",
              dealType: "new",
              tradeIn: true,
              gross: 2000,
              flat: 0,
              fi: 150,
              service: 0,
            },
          ],
        },
      ],
    },
  ],
};

test("buildPayTrackerDocument stores deals, totals, month_id, and employee_id", () => {
  const doc = buildPayTrackerDocument(sample, "rep-1");
  assert.equal(doc.employee_id, "rep-1");
  assert.equal(doc.month_id, "m1");
  assert.equal(doc.deals[0]?.stockNumber, "H100");
  assert.equal(doc.gross, 2000);
  assert.equal(doc.units, 1);
  assert.equal(doc.trades, 1);
  assert.equal(doc.fi, 150);
  assert.equal(doc.vacation, 160);
  assert.equal(doc.bonuses[0]?.amount, 250);
  const parsed = parseTrackerState(doc);
  assert.equal(parsed?.months[0]?.sheets[0]?.sales[0]?.gross, 2000);
});

test("awaiting_review pay_tracker_state rows become deal records and a matching workbook", () => {
  const doc = buildPayTrackerDocument(sample, "rep-1");
  const row = parsePayTrackerStateRow({
    id: "rep-1",
    employee_id: "rep-1",
    user_id: "rep-1",
    month_id: "m1",
    status: "awaiting_review",
    state: doc,
    location_id: "loc-1",
    created_by: "mgr-1",
    updated_at: "2026-09-15T12:00:00.000Z",
  });
  assert.ok(row);
  const state = trackerStateFromPayTrackerDocument(row!.state);
  assert.equal(state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  const deals = dealRowsFromPayTrackerState(row!);
  assert.equal(deals.some((item) => item.status === "awaiting_review" && item.rep_id === "rep-1"), true);
  assert.equal(
    deals.some((item) => item.staged_data && "sale" in item.staged_data && item.staged_data.sale?.gross === 2000),
    true,
  );
});

test("draft pay_tracker_state rows do not synthesize a pending review", () => {
  const deals = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "draft",
    state: buildPayTrackerDocument(sample, "rep-1"),
    location_id: null,
    created_by: "mgr-1",
  });
  assert.equal(deals.length, 0);
});

test("mergePayTrackerDealRows skips snapshot rows when deal_records already has the push", () => {
  const extras = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "awaiting_review",
    state: buildPayTrackerDocument(sample, "rep-1"),
    location_id: null,
    created_by: "mgr-1",
  });
  const existing = extras.map((row) => ({ ...row, id: "real-1" }));
  const merged = mergePayTrackerDealRows(existing, extras);
  assert.equal(merged.length, existing.length);
});

test("pickLatestPayTrackerRow prefers awaiting_review for the logged-in rep", () => {
  const picked = pickLatestPayTrackerRow(
    [
      {
        id: "rep-1",
        user_id: "rep-1",
        employee_id: "rep-1",
        month_id: "m0",
        status: "draft",
        state: {},
        location_id: null,
        created_by: null,
        updated_at: "2026-09-14T00:00:00.000Z",
      },
      {
        id: "rep-1",
        user_id: "rep-1",
        employee_id: "rep-1",
        month_id: "m1",
        status: "awaiting_review",
        state: {},
        location_id: null,
        created_by: null,
        updated_at: "2026-09-15T00:00:00.000Z",
      },
    ],
    "rep-1",
  );
  assert.equal(picked?.status, "awaiting_review");
  assert.equal(picked?.month_id, "m1");
});
