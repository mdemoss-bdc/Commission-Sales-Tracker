import assert from "node:assert/strict";
import test from "node:test";
import type { DealPayload, DealRow } from "./deal-records.ts";
import { classifyReviewItems, payloadsMatch, resolutionForChoice } from "./rep-review.ts";

function salePayload(id: string, stock: string, gross: number, sheetId = "s1"): DealPayload {
  return {
    kind: "sale",
    entityId: id,
    monthId: "m1",
    year: 2026,
    month: 9,
    sheetId,
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

test("brand new manager deals are additions the rep can accept or decline", () => {
  const { items } = classifyReviewItems([
    row({
      id: "new1",
      status: "pending_rep_review",
      staged_data: salePayload("d2", "H200", 900),
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "addition");
  assert.equal(resolutionForChoice(items[0]!, "accept").action, "accept");
  assert.equal(resolutionForChoice(items[0]!, "decline").action, "decline");
});

test("matching stock numbers with different pay fields are conflicts", () => {
  const { items } = classifyReviewItems([
    row({
      id: "live1",
      status: "active",
      live_data: salePayload("d1", "H100", 1000),
    }),
    row({
      id: "push1",
      status: "staged",
      staged_data: salePayload("d9", "H100", 1250),
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "conflict");
  assert.equal(items[0]?.liveId, "live1");
  const keep = resolutionForChoice(items[0]!, "keep_mine");
  assert.equal(keep.action, "keep_mine");
  const useManager = resolutionForChoice(items[0]!, "use_manager");
  assert.equal(useManager.action, "use_manager");
  assert.equal(useManager.live_id, "live1");
  const liveSale = useManager.live_data as DealPayload;
  assert.equal(liveSale.sale?.id, "d1");
  assert.equal(liveSale.sale?.gross, 1250);
});

test("same stock and same numbers are auto-cleared instead of duplicating", () => {
  const { items, autoResolve } = classifyReviewItems([
    row({
      id: "live1",
      status: "approved",
      live_data: salePayload("d1", "H100", 1000),
    }),
    row({
      id: "push1",
      status: "pending_rep_review",
      staged_data: salePayload("d9", "H100", 1000),
    }),
  ]);
  assert.equal(items.length, 0);
  assert.equal(autoResolve[0]?.action, "decline");
});

test("payloadsMatch ignores sale ids and compares pay fields", () => {
  assert.equal(payloadsMatch(salePayload("a", "H1", 10), salePayload("b", "H1", 10)), true);
  assert.equal(payloadsMatch(salePayload("a", "H1", 10), salePayload("b", "H1", 11)), false);
});
