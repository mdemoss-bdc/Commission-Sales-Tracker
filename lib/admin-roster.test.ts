import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ROSTER_NOT_STARTED_LABEL,
  ADMIN_ROSTER_UNPUSHED_LABEL,
  adminPeriodRosterBadgeLabel,
  adminPeriodRosterStatus,
  buildAdminRosterPeriodOptions,
  emptyTrackerForPeriod,
  sheetMatchesRosterPeriod,
} from "./admin-roster.ts";
import { parseAdminEmployeeSheet } from "./admin-employee-sheets.ts";
import { parsePayPeriodKey } from "./pay-period.ts";

test("buildAdminRosterPeriodOptions defaults to current month halves", () => {
  const options = buildAdminRosterPeriodOptions(new Date("2026-09-16T12:00:00"));
  assert.ok(options.some((row) => row.value === "2026-09-part2"));
  assert.ok(options.some((row) => row.value === "2026-09-part1"));
  assert.ok(options[0]?.label.includes("16th–end") || options[0]?.label.includes("1st–15th"));
});

test("adminPeriodRosterStatus shows not started instead of pending when no period sheet exists", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const status = adminPeriodRosterStatus({
    sheet: null,
    chain: null,
    period,
  });
  assert.equal(status, "not_started");
  assert.equal(adminPeriodRosterBadgeLabel(status), ADMIN_ROSTER_NOT_STARTED_LABEL);
});

test("adminPeriodRosterStatus treats other-period sheets as not started", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const sheet = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "pushed",
    month_id: "2026-09-part1",
    sheet_data: { deals: [{ id: "d1", stockNumber: "A1", customerName: "Sam", gross: 1000 }] },
  });
  assert.equal(sheetMatchesRosterPeriod(sheet, period), false);
  assert.equal(adminPeriodRosterStatus({ sheet, chain: null, period }), "not_started");
});

test("adminPeriodRosterStatus reports unpushed for draft content on the selected period", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const sheet = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "draft",
    month_id: "2026-09-part2",
    sheet_data: {
      month_id: "2026-09-part2",
      vacation_hours: 8,
      hourly_rate: 20,
      deals: [],
    },
  });
  assert.equal(adminPeriodRosterStatus({ sheet, chain: null, period }), "unpushed");
  assert.equal(adminPeriodRosterBadgeLabel("unpushed"), ADMIN_ROSTER_UNPUSHED_LABEL);
});

test("adminPeriodRosterStatus reports paid and finalized for matching period sheets", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const paid = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    month_id: "2026-09-part2",
    sheet_data: {},
  });
  const finalized = parseAdminEmployeeSheet({
    employee_id: "rep-2",
    status: "admin_final_approved",
    month_id: "2026-09-16",
    sheet_data: {},
  });
  assert.equal(adminPeriodRosterStatus({ sheet: paid, chain: null, period }), "paid");
  assert.equal(adminPeriodRosterStatus({ sheet: finalized, chain: null, period }), "finalized");
});

test("emptyTrackerForPeriod seeds the selected half-month worksheet", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const state = emptyTrackerForPeriod(period);
  assert.equal(state.months[0]?.year, 2026);
  assert.equal(state.months[0]?.month, 9);
  assert.equal(state.months[0]?.sheets[0]?.startDay, 16);
  assert.equal(state.months[0]?.sheets[0]?.sales.length, 0);
});
