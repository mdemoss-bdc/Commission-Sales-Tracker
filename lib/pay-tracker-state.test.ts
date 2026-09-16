import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayTrackerDocument,
  compileManagerApprovalSnapshot,
  dealRowsFromPayTrackerState,
  managerBufferTotalsFromDocument,
  mergePayTrackerDealRows,
  parsePayTrackerStateRow,
  pickLatestPayTrackerRow,
  parsePushSale,
  trackerStateFromPayTrackerDocument,
  workingTrackerFromPayTrackerRow,
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

test("buildPayTrackerDocument persists an empty bonuses array after a deletion", () => {
  const cleared: TrackerState = {
    vehicleTypes: sample.vehicleTypes,
    months: sample.months.map((month) => ({
      ...month,
      sheets: month.sheets.map((sheet) => ({ ...sheet, bonuses: [] })),
    })),
  };
  const doc = buildPayTrackerDocument(cleared, "rep-1");
  assert.deepEqual(doc.bonuses, []);
  assert.deepEqual(doc.sheets[0]?.bonuses, []);
  assert.deepEqual(doc.months[0]?.sheets[0]?.bonuses, []);
  const encoded = JSON.parse(JSON.stringify(doc)) as typeof doc;
  assert.deepEqual(encoded.bonuses, []);
  const restored = trackerStateFromPayTrackerDocument(encoded);
  assert.deepEqual(restored?.months[0]?.sheets[0]?.bonuses, []);
});

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

test("parsePushSale prefers deal_type_name over a stored UUID", () => {
  const hondaId = "9b7ea010-fafd-4032-8e15-6583f2d50043";
  const named = parsePushSale({
    id: "d1",
    stockNumber: "H100",
    customerName: "Pat",
    deal_type_id: hondaId,
    deal_type_name: "Honda",
    dealType: "new",
    gross: 1000,
  });
  const uuidOnly = parsePushSale({
    id: "d2",
    stockNumber: "U1",
    customerName: "Pat",
    vehicleType: hondaId,
    dealType: "used",
    gross: 500,
  });
  assert.equal(named?.vehicleType, "Honda");
  assert.equal(uuidOnly?.vehicleType, hondaId);
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

test("manager-visible accepted and modified snapshots keep their chain status", () => {
  const accepted = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "rep_accepted_no_changes",
    state: buildPayTrackerDocument(sample, "rep-1"),
    location_id: "loc-1",
    created_by: "admin-1",
  });
  assert.ok(accepted.length > 0);
  assert.equal(accepted.every((row) => row.status === "rep_accepted_no_changes"), true);
  const modified = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "rep_modified",
    state: buildPayTrackerDocument(sample, "rep-1"),
    location_id: "loc-1",
    created_by: "admin-1",
  });
  assert.equal(modified.every((row) => row.status === "rep_modified"), true);
});

test("a denied push hydrates the employee’s last submitted draft", () => {
  const baseline = buildPayTrackerDocument(sample, "rep-1");
  const revised: TrackerState = {
    vehicleTypes: sample.vehicleTypes,
    months: sample.months.map((month) => ({
      ...month,
      sheets: month.sheets.map((sheet) => ({
        ...sheet,
        sales: sheet.sales.map((sale) => ({ ...sale, gross: 3100 })),
      })),
    })),
  };
  const restored = workingTrackerFromPayTrackerRow({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "admin_pushed",
    state: baseline,
    rep_draft: buildPayTrackerDocument(revised, "rep-1"),
    deny_reason: "Fix the Honda gross",
    location_id: "loc-1",
    created_by: "mgr-1",
  });
  assert.equal(restored?.months[0]?.sheets[0]?.sales[0]?.gross, 3100);
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

test("mergePayTrackerDealRows skips snapshots after the employee already submitted", () => {
  const extras = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "rep_modified",
    state: buildPayTrackerDocument(sample, "rep-1"),
    location_id: null,
    created_by: "mgr-1",
  });
  const existing = extras.map((row) => ({ ...row, id: "real-2", status: "pending_manager_approval" as const }));
  const merged = mergePayTrackerDealRows(existing, extras);
  assert.equal(merged.length, existing.length);
  assert.equal(merged[0]?.status, "pending_manager_approval");
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

test("trackerStateFromPayTrackerDocument rebuilds months from top-level deals when months are empty", () => {
  const state = trackerStateFromPayTrackerDocument({
    month_id: "m1",
    year: 2026,
    month: 9,
    units: 3,
    trades: 1,
    gross: 4500,
    total_pay: 890,
    deals: [
      {
        id: "d1",
        stockNumber: "H1",
        customerName: "Pat",
        dealType: "new",
        tradeIn: true,
        gross: 4500,
        flat: 0,
        fi: 0,
        service: 0,
        vehicleType: "",
      },
    ],
  });
  assert.equal(state?.months[0]?.id, "m1");
  assert.equal(state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H1");
  assert.equal(state?.months[0]?.sheets[0]?.sales[0]?.gross, 4500);
});

test("trackerStateFromPayTrackerDocument rebuilds months from records, staged_data, and nested state.deals", () => {
  const deal = {
    id: "d9",
    stockNumber: "X9",
    customerName: "Lee",
    dealType: "used",
    tradeIn: false,
    gross: 900,
    flat: 0,
    fi: 0,
    service: 0,
    vehicleType: "honda",
  };
  const fromRecords = trackerStateFromPayTrackerDocument({
    records: [deal],
    month_id: "m1",
    year: 2026,
    month: 9,
  });
  const fromStaged = trackerStateFromPayTrackerDocument({
    staged_data: [deal],
    month_id: "m1",
    year: 2026,
    month: 9,
  });
  const fromNested = trackerStateFromPayTrackerDocument({
    state: { deals: [deal], month_id: "m1", year: 2026, month: 9 },
  });
  assert.equal(fromRecords?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "X9");
  assert.equal(fromStaged?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "X9");
  assert.equal(fromNested?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "X9");
});

test("compileManagerApprovalSnapshot uses deal_records when the preferred tracker is empty", () => {
  const snapshot = compileManagerApprovalSnapshot({
    preferred: { months: [], vehicleTypes: [] },
    dealRows: [
      {
        id: "row-1",
        rep_id: "rep-1",
        location_id: "loc-1",
        created_by: "mgr-1",
        status: "rep_authorized_no_changes",
        staged_data: {
          kind: "sale",
          entityId: "d1",
          monthId: "m1",
          year: 2026,
          month: 9,
          sheetId: "s1",
          sale: {
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
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
      {
        id: "row-sheet",
        rep_id: "rep-1",
        location_id: "loc-1",
        created_by: "mgr-1",
        status: "rep_authorized_no_changes",
        staged_data: {
          kind: "sheet",
          entityId: "s1",
          monthId: "m1",
          year: 2026,
          month: 9,
          sheetId: "s1",
          vacationHours: 8,
          vacationRate: 20,
          bonuses: [{ id: "b1", label: "Spiff", amount: 250 }],
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
    ],
  });
  assert.equal(snapshot?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(snapshot?.months[0]?.sheets[0]?.vacationHours, 8);
  assert.equal(snapshot?.months[0]?.sheets[0]?.bonuses[0]?.amount, 250);
  assert.equal(compileManagerApprovalSnapshot({ preferred: { months: [], vehicleTypes: [] }, dealRows: [] }), null);
});

test("managerBufferTotalsFromDocument reads payload.units, trades, gross, and total_pay", () => {
  const totals = managerBufferTotalsFromDocument({
    units: 4,
    trades: 2,
    gross: 8000,
    total_pay: 1200,
    deals: [],
    months: [],
  });
  assert.equal(totals.units, 4);
  assert.equal(totals.trades, 2);
  assert.equal(totals.gross, 8000);
  assert.equal(totals.pay, 1200);
});

test("dealRowsFromPayTrackerState attach buffer totals when the document has no nested sales", () => {
  const deals = dealRowsFromPayTrackerState({
    id: "rep-1",
    user_id: "rep-1",
    employee_id: "rep-1",
    month_id: "m1",
    status: "awaiting_review",
    state: {
      month_id: "m1",
      units: 6,
      trades: 2,
      gross: 9000,
      total_pay: 2100,
    },
    location_id: null,
    created_by: "mgr-1",
  });
  const sheet = deals.find((row) => row.staged_data && "kind" in row.staged_data && row.staged_data.kind === "sheet");
  assert.ok(sheet);
  const payload = sheet!.staged_data as { units?: number; trades?: number; gross?: number; total_pay?: number };
  assert.equal(payload.units, 6);
  assert.equal(payload.trades, 2);
  assert.equal(payload.gross, 9000);
  assert.equal(payload.total_pay, 2100);
});
