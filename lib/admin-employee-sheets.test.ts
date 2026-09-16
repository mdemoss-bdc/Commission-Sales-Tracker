import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_LEDGER_UNAVAILABLE,
  ADMIN_SHEET_APPROVED_FINAL,
  ADMIN_SHEET_DRAFT,
  ADMIN_SHEET_PAID,
  ADMIN_SHEET_PUSHED,
  adminMasterSheetTitle,
  isAdminLedgerUnavailable,
  isApprovedFinalAdminSheet,
  isAuthorizedAdminSheet,
  isPaidAdminSheet,
  nextAdminSheetStatusOnEdit,
  parseAdminEmployeeSheet,
  parseAdminSheetData,
  shouldPersistOverlayToAdminLedger,
} from "./admin-employee-sheets.ts";

test("admin master sheet titles use the employee name", () => {
  assert.equal(adminMasterSheetTitle("Pat Rivera"), "Admin Master Sheet: Pat Rivera");
  assert.equal(adminMasterSheetTitle("  "), "Admin Master Sheet: Employee");
});

test("admin overlay edits persist only for an admin targeting an employee", () => {
  assert.equal(
    shouldPersistOverlayToAdminLedger({ view: "overlay", actorRole: "admin", targetRepId: "rep-1" }),
    true,
  );
  assert.equal(
    shouldPersistOverlayToAdminLedger({ view: "overlay", actorRole: "manager", targetRepId: "rep-1" }),
    false,
  );
  assert.equal(
    shouldPersistOverlayToAdminLedger({ view: "live", actorRole: "admin", targetRepId: "rep-1" }),
    false,
  );
  assert.equal(
    shouldPersistOverlayToAdminLedger({ view: "overlay", actorRole: "admin", targetRepId: null }),
    false,
  );
  assert.equal(
    shouldPersistOverlayToAdminLedger({ view: "overlay", actorRole: "rep", targetRepId: "rep-1" }),
    false,
  );
});

test("editing an approved_final master reopens it as draft; paid and pushed stay locked", () => {
  assert.equal(nextAdminSheetStatusOnEdit(ADMIN_SHEET_APPROVED_FINAL), ADMIN_SHEET_DRAFT);
  assert.equal(nextAdminSheetStatusOnEdit("admin_final_approved"), ADMIN_SHEET_DRAFT);
  assert.equal(nextAdminSheetStatusOnEdit(ADMIN_SHEET_PUSHED), ADMIN_SHEET_PUSHED);
  assert.equal(nextAdminSheetStatusOnEdit(ADMIN_SHEET_PAID), ADMIN_SHEET_PAID);
  assert.equal(nextAdminSheetStatusOnEdit(ADMIN_SHEET_DRAFT), ADMIN_SHEET_DRAFT);
  assert.equal(nextAdminSheetStatusOnEdit(null), ADMIN_SHEET_DRAFT);
  assert.equal(isApprovedFinalAdminSheet(ADMIN_SHEET_APPROVED_FINAL), true);
  assert.equal(isApprovedFinalAdminSheet("admin_final_approved"), true);
  assert.equal(isApprovedFinalAdminSheet(ADMIN_SHEET_PUSHED), false);
  assert.equal(isPaidAdminSheet(ADMIN_SHEET_PAID), true);
  assert.equal(isPaidAdminSheet("admin_final_approved", true), true);
  assert.equal(isAuthorizedAdminSheet("manager_approved"), true);
  assert.equal(isAuthorizedAdminSheet(ADMIN_SHEET_PAID), true);
  assert.equal(isAuthorizedAdminSheet(ADMIN_SHEET_PUSHED), false);
});

test("missing admin ledger table or RPC is treated as unavailable so overlay can fall back", () => {
  assert.equal(isAdminLedgerUnavailable(ADMIN_LEDGER_UNAVAILABLE), true);
  assert.equal(
    isAdminLedgerUnavailable("Could not find the table 'public.admin_employee_sheets' in the schema cache"),
    true,
  );
  assert.equal(
    isAdminLedgerUnavailable("Could not find the function public.upsert_admin_employee_sheet in the schema cache"),
    true,
  );
  assert.equal(isAdminLedgerUnavailable("JWT expired"), false);
});

test("parseAdminSheetData reads a full tracker workbook out of sheet_data", () => {
  const state = parseAdminSheetData({
    months: [
      {
        id: "2026-09",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "s1",
            startDay: 1,
            endDay: 15,
            sales: [{ id: "d1", stockNumber: "A1", customerName: "Sam", gross: 1200 }],
            bonuses: [{ id: "b1", label: "Spiff", amount: 50 }],
            vacationHours: 8,
            vacationRate: 20,
          },
        ],
      },
    ],
    vehicleTypes: [{ id: "new", label: "New" }],
  });
  assert.ok(state);
  assert.equal(state.months[0]?.id, "2026-09");
  assert.equal(state.months[0]?.sheets[0]?.sales[0]?.stockNumber, "A1");
  assert.equal(state.months[0]?.sheets[0]?.bonuses[0]?.amount, 50);
  assert.equal(state.vehicleTypes[0]?.label, "New");
});

test("parseAdminSheetData rebuilds deals from envelope keys used by manager approval payloads", () => {
  const deal = { id: "d1", stockNumber: "H100", customerName: "Pat", dealType: "new", gross: 1800 };
  const fromDeals = parseAdminSheetData({ deals: [deal], month_id: "2026-09", year: 2026, month: 9 });
  const fromRecords = parseAdminSheetData({ records: [deal], month_id: "2026-09", year: 2026, month: 9 });
  const fromStaged = parseAdminSheetData({ staged_data: [deal], month_id: "2026-09", year: 2026, month: 9 });
  const fromNested = parseAdminSheetData({ state: { deals: [deal], month_id: "2026-09", year: 2026, month: 9 } });
  assert.equal(fromDeals?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(fromRecords?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(fromStaged?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(fromNested?.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(parseAdminSheetData({}), null);
  assert.equal(parseAdminSheetData({ deals: [], months: [], vehicleTypes: [] }), null);
});

test("parseAdminEmployeeSheet maps the isolated ledger row without exposing deal_records", () => {
  const row = parseAdminEmployeeSheet({
    employee_id: "rep-1",
    org_id: "org-1",
    location_id: "loc-1",
    month_id: "2026-09",
    status: "pushed",
    sheet_data: { months: [{ id: "2026-09", year: 2026, month: 9, sheets: [] }], vehicleTypes: [] },
    created_by: "admin-1",
  });
  assert.ok(row);
  assert.equal(row.employeeId, "rep-1");
  assert.equal(row.status, "pushed");
  assert.equal(row.state?.months[0]?.id, "2026-09");
  assert.equal(parseAdminEmployeeSheet({ status: "draft" }), null);
});
