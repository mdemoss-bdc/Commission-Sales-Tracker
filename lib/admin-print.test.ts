import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_SHEET_PAID, parseAdminEmployeeSheet } from "./admin-employee-sheets.ts";
import {
  MARK_PAID_CONFIRM,
  PRINT_ALL_AUTHORIZED_LABEL,
  PRINT_SHEET_LABEL,
  PRINT_SHEET_CONTAINER_CLASS,
  activePeriodMonth,
  adminSheetNeedsFallback,
  authorizedAdminSheetsForLocation,
  formatPaidAt,
  hydrateAdminModalWorksheet,
  previewSheetWithFallback,
  hydrateFinalizedWorksheet,
  printCardSelector,
  printPeriodLabel,
  printStateFromAdminSheet,
  shouldPrintCard,
  sheetForEmployee,
  shouldShowFinalizedPrintPreview,
} from "./admin-print.ts";
import { extractDealsFromSheetData } from "./pay-tracker-state.ts";
import type { TrackerState } from "./types.ts";
import { assembleWorkingState } from "./deal-records.ts";

function sheet(patch: Record<string, unknown>) {
  return parseAdminEmployeeSheet({
    employee_id: "rep-1",
    org_id: "org-1",
    location_id: "loc-honda",
    month_id: "2026-09",
    status: "admin_final_approved",
    sheet_data: { months: [], vehicleTypes: [] },
    ...patch,
  });
}

test("print and mark-paid copy matches the Admin payroll workflow", () => {
  assert.equal(PRINT_SHEET_LABEL, "Print Sheet");
  assert.equal(PRINT_SHEET_CONTAINER_CLASS, "print-sheet-container");
  assert.equal(PRINT_ALL_AUTHORIZED_LABEL, "Print All Authorized");
  assert.equal(
    MARK_PAID_CONFIRM,
    "Are you sure you want to mark this pay sheet as PAID? This will lock the sheet and mark payroll disbursed.",
  );
});

test("authorizedAdminSheetsForLocation keeps manager-authorized and paid sheets at that rooftop", () => {
  const amy = sheet({ employee_id: "amy", status: "admin_final_approved" });
  const zane = sheet({ employee_id: "zane", status: "paid", is_paid: true, location_id: "loc-honda" });
  const pat = sheet({ employee_id: "pat", status: "pushed" });
  const otherStore = sheet({ employee_id: "lee", status: "approved_final", location_id: "loc-ford" });
  assert.ok(amy && zane && pat && otherStore);
  const people = [
    { id: "amy", location_id: "loc-honda" },
    { id: "zane", location_id: "loc-honda" },
    { id: "pat", location_id: "loc-honda" },
    { id: "lee", location_id: "loc-ford" },
  ];
  const authorized = authorizedAdminSheetsForLocation({
    sheets: [amy, zane, pat, otherStore],
    people,
    locationId: "loc-honda",
  });
  assert.deepEqual(
    authorized.map((row) => row.employeeId),
    ["amy", "zane"],
  );
  assert.equal(authorizedAdminSheetsForLocation({ sheets: [amy], people, locationId: null }).length, 0);
});

test("paid admin sheets parse with timestamp and stay marked paid", () => {
  const row = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    paid_at: "2026-09-16T12:00:00.000Z",
    sheet_data: {},
  });
  assert.ok(row);
  assert.equal(row.status, ADMIN_SHEET_PAID);
  assert.equal(row.isPaid, true);
  assert.equal(row.paidAt, "2026-09-16T12:00:00.000Z");
  assert.ok(formatPaidAt(row.paidAt));
  assert.equal(formatPaidAt("not-a-date"), null);
});

test("activePeriodMonth prefers the current calendar month, else the latest workbook month", () => {
  const state: TrackerState = {
    vehicleTypes: [],
    months: [
      { id: "aug", year: 2026, month: 8, sheets: [{ id: "s-aug", startDay: 1, endDay: 15, sales: [], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] }] },
      { id: "sep", year: 2026, month: 9, sheets: [{ id: "s-sep", startDay: 1, endDay: 15, sales: [], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] }] },
    ],
  };
  assert.equal(activePeriodMonth(state, new Date("2026-09-16T12:00:00Z"))?.id, "sep");
  assert.equal(activePeriodMonth(state, new Date("2026-10-01T12:00:00Z"))?.id, "sep");
  assert.equal(activePeriodMonth({ months: [], vehicleTypes: [] }), null);
});

test("print scoping marks one employee or every authorized card", () => {
  assert.equal(shouldPrintCard("one", "amy", "amy"), true);
  assert.equal(shouldPrintCard("one", "zane", "amy"), false);
  assert.equal(shouldPrintCard("all", "zane", "amy"), true);
  assert.equal(sheetForEmployee([sheet({ employee_id: "amy" })!], "amy")?.employeeId, "amy");
  assert.equal(sheetForEmployee([], "amy"), null);
});

test("shouldShowFinalizedPrintPreview covers authorized, paid, and finalized roster rows", () => {
  const approved = sheet({ status: "admin_final_approved" });
  const paid = sheet({ status: "paid", is_paid: true });
  const pushed = sheet({ status: "pushed" });
  assert.equal(shouldShowFinalizedPrintPreview({ isAdmin: false, sheet: approved, rosterStatus: "finalized" }), false);
  assert.equal(shouldShowFinalizedPrintPreview({ isAdmin: true, sheet: approved, rosterStatus: "idle" }), true);
  assert.equal(shouldShowFinalizedPrintPreview({ isAdmin: true, sheet: paid, rosterStatus: "idle" }), true);
  assert.equal(shouldShowFinalizedPrintPreview({ isAdmin: true, sheet: pushed, rosterStatus: "finalized" }), true);
  assert.equal(
    shouldShowFinalizedPrintPreview({ isAdmin: true, sheet: pushed, rosterStatus: "idle", chainStatus: "admin_final_approved" }),
    true,
  );
  assert.equal(shouldShowFinalizedPrintPreview({ isAdmin: true, sheet: pushed, rosterStatus: "awaiting" }), false);
});

test("previewSheetWithFallback uses overlay workbook data when the stored sheet is empty", () => {
  const empty = sheet({ sheet_data: { months: [], vehicleTypes: [] } });
  const overlay: TrackerState = {
    vehicleTypes: [{ id: "honda", label: "Honda" }],
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
            sales: [
              {
                id: "d1",
                stockNumber: "H100",
                customerName: "Pat",
                vehicleType: "honda",
                dealType: "new",
                tradeIn: false,
                gross: 1000,
                flat: 0,
                fi: 0,
                service: 0,
              },
            ],
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: [],
          },
        ],
      },
    ],
  };
  const filled = previewSheetWithFallback(empty, overlay);
  assert.equal(filled?.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(previewSheetWithFallback(null, overlay), null);
});

test("hydrateFinalizedWorksheet falls back to deal_records when the finalized sheet_data is empty", () => {
  const empty = sheet({ sheet_data: {} });
  const fromDeals = assembleWorkingState([
    {
      id: "row-1",
      rep_id: "rep-1",
      location_id: "loc-honda",
      created_by: "mgr-1",
      status: "admin_final_approved",
      staged_data: {
        kind: "sale",
        entityId: "d1",
        monthId: "2026-09",
        year: 2026,
        month: 9,
        sheetId: "s1",
        sale: {
          id: "d1",
          stockNumber: "H200",
          customerName: "Sam",
          vehicleType: "honda",
          dealType: "new",
          tradeIn: false,
          gross: 2200,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      live_data: {},
      proposed_data: {},
      previous_data: {},
      rep_notes: null,
    },
  ]);
  const hydrated = hydrateFinalizedWorksheet(empty, [fromDeals]);
  assert.equal(hydrated?.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H200");
  const viaPreview = previewSheetWithFallback(empty, null, {
    dealRows: [
      {
        id: "row-1",
        rep_id: "rep-1",
        location_id: "loc-honda",
        created_by: "mgr-1",
        status: "admin_final_approved",
        staged_data: {
          kind: "sale",
          entityId: "d1",
          monthId: "2026-09",
          year: 2026,
          month: 9,
          sheetId: "s1",
          sale: {
            id: "d1",
            stockNumber: "H200",
            customerName: "Sam",
            vehicleType: "honda",
            dealType: "new",
            tradeIn: false,
            gross: 2200,
            flat: 0,
            fi: 0,
            service: 0,
          },
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
    ],
  });
  assert.equal(viaPreview?.state?.months[0]?.sheets[0]?.sales[0]?.customerName, "Sam");
});

test("printStateFromAdminSheet renders deals from sheet_data.deals, records, or state.deals", () => {
  const deal = {
    id: "d1",
    stockNumber: "H500",
    customerName: "Kim",
    vehicleType: "honda",
    dealType: "new",
    tradeIn: false,
    gross: 1500,
    flat: 0,
    fi: 0,
    service: 0,
  };
  const fromDeals = printStateFromAdminSheet(
    sheet({
      sheet_data: { deals: [deal], records: [deal], month_id: "2026-09", year: 2026, month: 9 },
    }),
  );
  assert.equal(fromDeals?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H500");
  const fromRecords = printStateFromAdminSheet(sheet({ sheet_data: { records: [deal], month_id: "2026-09" } }));
  assert.equal(fromRecords?.months[0]?.sheets[0]?.sales[0]?.customerName, "Kim");
  const fromNested = printStateFromAdminSheet(sheet({ sheet_data: { state: { deals: [deal] }, month_id: "2026-09" } }));
  assert.equal(fromNested?.months[0]?.sheets[0]?.sales[0]?.gross, 1500);
  assert.equal(activePeriodMonth(fromDeals)?.sheets[0]?.sales.length, 1);
});

test("printPeriodLabel includes the month name and worksheet date range", () => {
  assert.equal(printPeriodLabel(null), "Pay period");
  assert.equal(
    printPeriodLabel({
      id: "sep",
      year: 2026,
      month: 9,
      sheets: [{ id: "s1", startDay: 1, endDay: 15, sales: [], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] }],
    }),
    "September 2026 · 1st–15th",
  );
});

test("printCardSelector uses the modal card for one sheet and the hidden batch for print-all", () => {
  assert.equal(printCardSelector("one"), ".finalized-print-card");
  assert.equal(printCardSelector("all"), ".finalized-print-batch-card");
});

test("hydrateAdminModalWorksheet falls back to pay_tracker_state snapshots when sheet_data is empty", () => {
  const empty = sheet({ sheet_data: {} });
  const deal = {
    id: "d3",
    stockNumber: "H900",
    customerName: "Jordan",
    vehicleType: "honda",
    dealType: "new",
    tradeIn: false,
    gross: 2400,
    flat: 0,
    fi: 0,
    service: 0,
  };
  const fromDraft = hydrateAdminModalWorksheet({
    sheet: empty,
    employeeId: "rep-1",
    tracker: {
      id: "rep-1",
      user_id: "rep-1",
      employee_id: "rep-1",
      month_id: "2026-09",
      status: "admin_final_approved",
      state: { months: [], vehicleTypes: [] },
      rep_draft: { deals: [deal], month_id: "2026-09", year: 2026, month: 9 },
      location_id: "loc-honda",
      created_by: "mgr-1",
    },
  });
  assert.equal(fromDraft.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H900");
  assert.equal(extractDealsFromSheetData(fromDraft.sheetData)[0]?.stockNumber, "H900");
});

test("hydrateAdminModalWorksheet uses deal_records when admin sheet_data has no deals", () => {
  const empty = sheet({ sheet_data: {} });
  const hydrated = hydrateAdminModalWorksheet({
    sheet: empty,
    employeeId: "rep-1",
    dealRows: [
      {
        id: "row-2",
        rep_id: "rep-1",
        location_id: "loc-honda",
        created_by: "mgr-1",
        status: "pending_admin_approval",
        staged_data: {
          kind: "sale",
          entityId: "d4",
          monthId: "2026-09",
          year: 2026,
          month: 9,
          sheetId: "s1",
          sale: {
            id: "d4",
            stockNumber: "H330",
            customerName: "Riley",
            vehicleType: "honda",
            dealType: "used",
            tradeIn: true,
            gross: 1750,
            flat: 50,
            fi: 0,
            service: 0,
          },
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
    ],
  });
  assert.equal(hydrated.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H330");
  assert.equal(adminSheetNeedsFallback(hydrated), false);
});

test("printStateFromAdminSheet hydrates staged_data and deal_records fallbacks", () => {
  const deal = {
    id: "d2",
    stockNumber: "H700",
    customerName: "Alex",
    vehicleType: "honda",
    dealType: "used",
    tradeIn: true,
    gross: 900,
    flat: 0,
    fi: 0,
    service: 0,
  };
  const fromStaged = printStateFromAdminSheet(sheet({ sheet_data: { staged_data: [deal], month_id: "2026-09" } }));
  assert.equal(fromStaged?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H700");
  const fromDealRecords = printStateFromAdminSheet(sheet({ sheet_data: { deal_records: [deal], month_id: "2026-09" } }));
  assert.equal(fromDealRecords?.months[0]?.sheets[0]?.sales[0]?.customerName, "Alex");
});

test("hydrateAdminModalWorksheet falls back to admin_pushed_snapshot and writes sheet_data.deals", () => {
  const empty = sheet({ sheet_data: {} });
  const deal = {
    id: "d5",
    stockNumber: "H410",
    customerName: "Morgan",
    vehicleType: "honda",
    dealType: "new",
    tradeIn: false,
    gross: 3100,
    flat: 0,
    fi: 0,
    service: 0,
  };
  const hydrated = hydrateAdminModalWorksheet({
    sheet: empty,
    employeeId: "rep-1",
    tracker: {
      id: "rep-1",
      user_id: "rep-1",
      employee_id: "rep-1",
      month_id: "2026-09",
      status: "admin_final_approved",
      state: {},
      admin_pushed_snapshot: { deals: [deal], month_id: "2026-09", year: 2026, month: 9 },
      location_id: "loc-honda",
      created_by: "mgr-1",
    },
  });
  assert.equal(hydrated.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H410");
  assert.equal(extractDealsFromSheetData(hydrated.sheetData)[0]?.customerName, "Morgan");
  assert.equal(adminSheetNeedsFallback(hydrated), false);
});

test("previewSheetWithFallback hydrates from deal_records when the admin sheet row is missing", () => {
  const overlay = null;
  assert.equal(previewSheetWithFallback(null, overlay), null);
  const hydrated = previewSheetWithFallback(null, overlay, {
    employeeId: "rep-1",
    dealRows: [
      {
        id: "row-3",
        rep_id: "rep-1",
        location_id: "loc-honda",
        created_by: "mgr-1",
        status: "active",
        staged_data: {
          kind: "sale",
          entityId: "d6",
          monthId: "2026-09",
          year: 2026,
          month: 9,
          sheetId: "s1",
          sale: {
            id: "d6",
            stockNumber: "H118",
            customerName: "Casey",
            vehicleType: "honda",
            dealType: "new",
            tradeIn: false,
            gross: 1250,
            flat: 0,
            fi: 0,
            service: 0,
          },
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
    ],
  });
  assert.equal(hydrated?.employeeId, "rep-1");
  assert.equal(hydrated?.state?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H118");
  assert.equal(extractDealsFromSheetData(hydrated?.sheetData)[0]?.customerName, "Casey");
});

test("adminSheetNeedsFallback is true for empty sheet_data", () => {
  assert.equal(adminSheetNeedsFallback(null), true);
  assert.equal(adminSheetNeedsFallback(sheet({ sheet_data: {} })), true);
  assert.equal(adminSheetNeedsFallback(sheet({ sheet_data: { deals: [] } })), true);
});

test("hydrateAdminModalWorksheet loads 16th-end deals instead of an empty first-half month", () => {
  const emptyFirstHalf = sheet({ month_id: "2026-09-part1", sheet_data: {} });
  const hydrated = hydrateAdminModalWorksheet({
    sheet: emptyFirstHalf,
    employeeId: "rep-2",
    period: { year: 2026, month: 9, split: "part2", key: "2026-09-part2", raw: "2026-09-16th-end" },
    dealRows: [
      {
        id: "row-part2",
        rep_id: "rep-2",
        location_id: "loc-honda",
        created_by: "mgr-1",
        status: "active",
        staged_data: {
          kind: "sale",
          entityId: "d-part2",
          monthId: "2026-09-part2",
          year: 2026,
          month: 9,
          sheetId: "s2",
          startDay: 16,
          endDay: 30,
          sale: {
            id: "d-part2",
            stockNumber: "H216",
            customerName: "Test User 2",
            vehicleType: "honda",
            dealType: "used",
            tradeIn: false,
            gross: 2100,
            flat: 0,
            fi: 0,
            service: 0,
          },
        },
        live_data: {},
        proposed_data: {},
        previous_data: {},
        rep_notes: null,
      },
    ],
  });
  const month = activePeriodMonth(hydrated.state, new Date("2026-09-16T12:00:00Z"), {
    year: 2026,
    month: 9,
    split: "part2",
    key: "2026-09-part2",
    raw: "2026-09-part2",
  });
  assert.equal(extractDealsFromSheetData(hydrated.sheetData)[0]?.stockNumber, "H216");
  assert.equal(month?.sheets.some((row) => (row.sales ?? []).some((sale) => sale.stockNumber === "H216")), true);
  assert.equal(adminSheetNeedsFallback(hydrated), false);
});
