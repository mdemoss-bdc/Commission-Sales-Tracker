import assert from "node:assert/strict";
import test from "node:test";
import { diffCell, groupApprovalSheets } from "./approval-sheet.ts";
import type { DealPayload, DealRow } from "./deal-records.ts";
import type { Sale } from "./types.ts";

function salePayload(id: string, stock: string, gross: number, extra: Partial<Sale> = {}): DealPayload {
  return {
    kind: "sale",
    entityId: id,
    monthId: "m1",
    year: 2026,
    month: 9,
    sheetId: "s1",
    startDay: 1,
    endDay: 15,
    sale: {
      id,
      stockNumber: stock,
      customerName: "Pat",
      vehicleType: "",
      dealType: "new",
      tradeIn: false,
      gross,
      flat: 0,
      fi: 0,
      service: 0,
      ...extra,
    },
  };
}

function row(patch: Partial<DealRow> & Pick<DealRow, "id" | "status">): DealRow {
  return {
    rep_id: "rep1",
    location_id: "loc1",
    created_by: "mgr1",
    staged_data: {},
    live_data: {},
    rep_notes: null,
    ...patch,
  };
}

test("diffCell marks employee edits and additions", () => {
  assert.equal(diffCell("Gross", "gross", "$1,200.00", "$1,000.00", true).kind, "changed");
  assert.equal(diffCell("Gross", "gross", "$1,200.00", "$1,000.00", true).tooltip, "Changed from: $1,000.00");
  assert.equal(diffCell("Stock #", "stockNumber", "H200", null, true).kind, "added");
  assert.equal(diffCell("Stock #", "stockNumber", "H200", null, true).tooltip, "Added by Rep");
  assert.equal(diffCell("Customer", "customerName", "Pat", "—", true).kind, "added");
  assert.equal(diffCell("Gross", "gross", "$1,000.00", "$1,000.00", true).kind, "unchanged");
  assert.equal(diffCell("Gross", "gross", "$1,200.00", "$1,000.00", false).kind, "unchanged");
});

test("groupApprovalSheets shows the full sheet with red diffs on pending sales", () => {
  const pending = row({
    id: "p1",
    status: "pending_manager_approval",
    staged_data: salePayload("d1", "H100", 1250, { flat: 50 }),
    previous_data: salePayload("d1", "H100", 1000),
  });
  const liveOther = row({
    id: "live2",
    status: "active",
    live_data: salePayload("d2", "H200", 800),
  });
  const groups = groupApprovalSheets([pending], [pending, liveOther]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.sales.length, 2);
  const changed = groups[0]?.sales.find((sale) => sale.sale.stockNumber === "H100");
  const untouched = groups[0]?.sales.find((sale) => sale.sale.stockNumber === "H200");
  assert.equal(changed?.pending, true);
  assert.equal(changed?.cells.find((cell) => cell.key === "gross")?.kind, "changed");
  assert.equal(changed?.cells.find((cell) => cell.key === "flat")?.kind, "changed");
  assert.equal(changed?.cells.find((cell) => cell.key === "flat")?.tooltip, "Changed from: $0.00");
  assert.equal(untouched?.pending, false);
  assert.equal(untouched?.cells.every((cell) => cell.kind === "unchanged"), true);
  assert.ok((groups[0]?.changedCount ?? 0) >= 2);
  assert.match(groups[0]?.title ?? "", /September 2026/);
});

test("accepted additions have no previous values and mark cells as added", () => {
  const pending = row({
    id: "p2",
    status: "pending_admin_approval",
    staged_data: salePayload("d9", "H300", 900),
    previous_data: {},
  });
  const groups = groupApprovalSheets([pending], [pending]);
  const stock = groups[0]?.sales[0]?.cells.find((cell) => cell.key === "stockNumber");
  assert.equal(stock?.kind, "added");
  assert.equal(stock?.tooltip, "Added by Rep");
});
