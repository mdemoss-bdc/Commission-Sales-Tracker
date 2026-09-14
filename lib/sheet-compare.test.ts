import assert from "node:assert/strict";
import test from "node:test";
import type { DealPayload } from "./deal-records.ts";
import type { ReviewItem } from "./rep-review.ts";
import type { Sale } from "./types.ts";
import {
  compareSaleRows,
  leftoverEditedSales,
  resolutionsFromEditedSheet,
  reviewSheetTargets,
  saleMatchKey,
} from "./sheet-compare.ts";

function sale(id: string, stock: string, gross = 1000, extra: Partial<Sale> = {}): Sale {
  return {
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
  };
}

function payload(saleRow: Sale, sheetId = "s1", monthId = "m1"): DealPayload {
  return {
    kind: "sale",
    entityId: saleRow.id,
    monthId,
    year: 2026,
    month: 9,
    sheetId,
    sale: saleRow,
  };
}

test("stock numbers match even when sale ids differ", () => {
  assert.equal(saleMatchKey(sale("a", "H100")), saleMatchKey(sale("b", "H100")));
  assert.notEqual(saleMatchKey(sale("a", "H100")), saleMatchKey(sale("a", "H200")));
});

test("compareSaleRows highlights differing cells and extra or missing rows", () => {
  const live = [sale("d1", "H100", 1000), sale("d2", "H200", 800)];
  const manager = [sale("x9", "H100", 1250, { flat: 50 }), sale("n1", "N1", 900)];
  const compared = compareSaleRows(live, manager);
  const liveH100 = compared.live.find((row) => row.sale.stockNumber === "H100");
  const liveH200 = compared.live.find((row) => row.sale.stockNumber === "H200");
  const managerNew = compared.manager.find((row) => row.sale.stockNumber === "N1");
  assert.deepEqual(liveH100?.fields.sort(), ["flat", "gross"]);
  assert.equal(liveH200?.kind, "missing");
  assert.equal(managerNew?.kind, "extra");
});

test("resolutionsFromEditedSheet uses the edited bottom-table values", () => {
  const mine = sale("d1", "H100", 1000);
  const manager = sale("d9", "H100", 1250);
  const edited = sale("d9", "H100", 1100, { flat: 25 });
  const item: ReviewItem = {
    id: "pending1",
    liveId: "live1",
    kind: "conflict",
    title: "H100",
    manager: payload(manager),
    mine: payload(mine),
    diffs: [],
  };
  const decisions = resolutionsFromEditedSheet([item], [], [edited]);
  assert.equal(decisions[0]?.action, "use_manager");
  assert.equal((decisions[0]?.live_data as DealPayload).sale?.gross, 1100);
  assert.equal((decisions[0]?.live_data as DealPayload).sale?.flat, 25);
});

test("deleted manager rows are declined and leftover sales stay for insert", () => {
  const added = sale("new1", "Z9", 500);
  const item: ReviewItem = {
    id: "pending2",
    kind: "addition",
    title: "H300",
    manager: payload(sale("d3", "H300", 900)),
    mine: null,
    diffs: [],
  };
  const decisions = resolutionsFromEditedSheet([item], [], [added]);
  assert.equal(decisions[0]?.action, "decline");
  assert.deepEqual(
    leftoverEditedSales([item], [added]).map((row) => row.id),
    ["new1"],
  );
});

test("reviewSheetTargets points the employee at the pushed worksheet", () => {
  const targets = reviewSheetTargets([
    {
      id: "1",
      kind: "addition",
      title: "H100",
      manager: payload(sale("d1", "H100")),
      mine: null,
      diffs: [],
    },
  ]);
  assert.deepEqual(targets, [{ monthId: "m1", sheetId: "s1", label: "September 2026" }]);
});
