import assert from "node:assert/strict";
import test from "node:test";
import type { DealPayload, DealRow } from "./deal-records.ts";
import { classifyReviewItems, isAwaitingRepReview, isPendingEmployeeReview, payloadsMatch, resolutionForChoice } from "./rep-review.ts";

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
  assert.equal((keep.live_data as DealPayload).sale?.gross, 1000);
  const useManager = resolutionForChoice(items[0]!, "use_manager");
  assert.equal(useManager.action, "use_manager");
  assert.equal(useManager.live_id, "live1");
  const liveSale = useManager.live_data as DealPayload;
  assert.equal(liveSale.sale?.id, "d1");
  assert.equal(liveSale.sale?.gross, 1250);
});

test("matching sheet extras stay in review so vacation and bonuses can be confirmed", () => {
  const extras: DealPayload = {
    kind: "sheet",
    entityId: "s1",
    monthId: "m1",
    year: 2026,
    month: 9,
    sheetId: "s1",
    vacationHours: 40,
    vacationRate: 25,
    vacationPay: 1000,
    bonuses: [{ id: "b1", label: "Spiff", amount: 1000 }],
  };
  const { items, autoResolve } = classifyReviewItems([
    row({
      id: "live-sheet",
      status: "active",
      live_data: extras,
    }),
    row({
      id: "push-sheet",
      status: "pending_rep_review",
      staged_data: extras,
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.manager?.kind, "sheet");
  assert.equal(autoResolve.length, 0);
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

test("identical same-row manager push is auto-cleared instead of submitting to the manager", () => {
  const { items, autoResolve } = classifyReviewItems([
    row({
      id: "same1",
      status: "pending_rep_review",
      live_data: salePayload("d1", "H100", 1000),
      staged_data: salePayload("d1", "H100", 1000),
    }),
  ]);
  assert.equal(items.length, 0);
  assert.equal(autoResolve[0]?.action, "decline");
});

test("payloadsMatch ignores sale ids and compares pay fields", () => {
  assert.equal(payloadsMatch(salePayload("a", "H1", 10), salePayload("b", "H1", 10)), true);
  assert.equal(payloadsMatch(salePayload("a", "H1", 10), salePayload("b", "H1", 11)), false);
});

test("awaiting_review and staged both count as an active employee push", () => {
  assert.equal(isAwaitingRepReview("awaiting_review"), true);
  assert.equal(isAwaitingRepReview("pending_rep_review"), true);
  assert.equal(isAwaitingRepReview("staged"), true);
  assert.equal(isAwaitingRepReview("active"), false);
  assert.equal(isPendingEmployeeReview("pending_rep_review"), true);
  assert.equal(isPendingEmployeeReview("awaiting_review"), true);
  assert.equal(isPendingEmployeeReview("staged"), false);
  assert.equal(isPendingEmployeeReview("pending_manager_approval"), false);
});

test("duplicate pending reviews for the same stock keep only the newest", () => {
  const { items, autoResolve } = classifyReviewItems([
    row({
      id: "old",
      status: "pending_rep_review",
      updated_at: "2026-09-01T12:00:00.000Z",
      staged_data: salePayload("d1", "H100", 900),
    }),
    row({
      id: "new",
      status: "pending_rep_review",
      updated_at: "2026-09-14T18:00:00.000Z",
      staged_data: salePayload("d9", "H100", 1250),
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "new");
  assert.equal(items[0]?.manager?.sale?.gross, 1250);
  assert.equal(autoResolve[0]?.id, "old");
  assert.equal(autoResolve[0]?.action, "decline");
});
