import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_SHEET_PAID, parseAdminEmployeeSheet } from "./admin-employee-sheets.ts";
import {
  MARK_PAID_CONFIRM,
  PRINT_ALL_AUTHORIZED_LABEL,
  PRINT_SHEET_LABEL,
  activePeriodMonth,
  authorizedAdminSheetsForLocation,
  formatPaidAt,
  previewSheetWithFallback,
  hydrateFinalizedWorksheet,
  shouldPrintCard,
  sheetForEmployee,
  shouldShowFinalizedPrintPreview,
} from "./admin-print.ts";
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
