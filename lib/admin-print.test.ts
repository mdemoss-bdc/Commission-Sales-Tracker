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
  shouldPrintCard,
  sheetForEmployee,
} from "./admin-print.ts";
import type { TrackerState } from "./types.ts";

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
