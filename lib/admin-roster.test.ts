import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ROSTER_NOT_STARTED_LABEL,
  ADMIN_ROSTER_NO_SUBMISSION_LABEL,
  ADMIN_ROSTER_UNPUSHED_LABEL,
  adminPeriodRosterBadgeLabel,
  adminPeriodRosterStatus,
  adminRosterMonthOptions,
  buildAdminRosterPeriodKey,
  buildAdminRosterYearOptions,
  composeAdminRosterPeriod,
  emptyTrackerForPeriod,
  getPeriodKey,
  normalizeAdminRosterSplit,
  rosterPeriodSubmissionLabel,
  sheetMatchesRosterPeriod,
} from "./admin-roster.ts";
import { parseAdminEmployeeSheet } from "./admin-employee-sheets.ts";
import { parsePayPeriodKey } from "./pay-period.ts";

test("getPeriodKey maps dropdown labels to canonical period_key", () => {
  assert.equal(getPeriodKey(2026, "September", "16th–end"), "2026-09-part2");
  assert.equal(getPeriodKey(2026, "September", "1st–15th"), "2026-09-part1");
  assert.equal(getPeriodKey(2026, 9, "part2"), "2026-09-part2");
});

test("buildAdminRosterYearOptions seeds nearby years and merges extras without hard caps", () => {
  const years = buildAdminRosterYearOptions(new Date("2026-09-16T12:00:00"), [2024, 2030]);
  assert.deepEqual(years, [2030, 2027, 2026, 2025, 2024]);
  assert.ok(adminRosterMonthOptions().length === 12);
  assert.equal(adminRosterMonthOptions()[0]?.label, "January");
  assert.equal(normalizeAdminRosterSplit("part2"), "part2");
  assert.equal(normalizeAdminRosterSplit("unknown", new Date("2026-09-10T12:00:00")), "part1");
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
  assert.equal(rosterPeriodSubmissionLabel({ status, sheet: null }), ADMIN_ROSTER_NO_SUBMISSION_LABEL);
});

test("adminPeriodRosterStatus treats other-period sheets as not started", () => {
  const period = parsePayPeriodKey("2026-08-part1");
  const sheet = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    month_id: "2026-09-part1",
    period_key: "2026-09-part1",
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
    period_key: "2026-09-part2",
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

test("adminPeriodRosterStatus reports paid only for the exact selected period", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const paid = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    month_id: "2026-09-part2",
    period_key: "2026-09-part2",
    sheet_data: {},
  });
  const finalized = parseAdminEmployeeSheet({
    employee_id: "rep-2",
    status: "admin_final_approved",
    month_id: "2026-09-16",
    period_key: "2026-09-part2",
    sheet_data: {},
  });
  assert.equal(adminPeriodRosterStatus({ sheet: paid, chain: null, period }), "paid");
  assert.equal(adminPeriodRosterStatus({ sheet: finalized, chain: null, period }), "finalized");
});

test("adminPeriodRosterStatus never treats status text alone as paid", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const statusOnlyPaid = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: false,
    month_id: "2026-09-part2",
    period_key: "2026-09-part2",
    sheet_data: {},
  });
  assert.equal(statusOnlyPaid?.isPaid, false);
  assert.notEqual(adminPeriodRosterStatus({ sheet: statusOnlyPaid, chain: null, period }), "paid");
});

test("adminPeriodRosterStatus shows not started for 16th-end when only 1st-15th is paid", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const firstHalfPaid = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    month_id: "2026-09-part1",
    period_key: "2026-09-part1",
    sheet_data: { month_id: "2026-09-part1", deals: [{ id: "d1", stockNumber: "A1", customerName: "Sam", gross: 1000 }] },
  });
  assert.equal(sheetMatchesRosterPeriod(firstHalfPaid, period), false);
  assert.equal(adminPeriodRosterStatus({ sheet: firstHalfPaid, chain: null, period }), "not_started");
  assert.equal(adminPeriodRosterBadgeLabel("not_started"), ADMIN_ROSTER_NOT_STARTED_LABEL);
});

test("adminPeriodRosterStatus accepts en-dash 16th–end aliases as the second half", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const sheet = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    status: "paid",
    is_paid: true,
    month_id: "2026-09-16th–end",
    period_key: "2026-09-16th-end",
    sheet_data: {},
  });
  assert.equal(sheetMatchesRosterPeriod(sheet, period), true);
  assert.equal(adminPeriodRosterStatus({ sheet, chain: null, period }), "paid");
});

test("emptyTrackerForPeriod seeds the selected half-month worksheet", () => {
  const period = parsePayPeriodKey("2026-09-part2");
  const state = emptyTrackerForPeriod(period);
  assert.equal(state.months[0]?.year, 2026);
  assert.equal(state.months[0]?.month, 9);
  assert.equal(state.months[0]?.sheets[0]?.startDay, 16);
  assert.equal(state.months[0]?.sheets[0]?.sales.length, 0);
});
