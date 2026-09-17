import assert from "node:assert/strict";
import test from "node:test";
import {
  dealRowHoldsSale,
  leftoverDealRowsToDelete,
  omitDeletedSalePayloads,
  omitDeletedSaleRows,
  stripDeletedSalesFromState,
} from "./sale-deletes.ts";
import type { DealPayload, DealRow } from "./deal-records.ts";
import type { TrackerState } from "./types.ts";

function salePayload(id: string, stock = "H100"): DealPayload {
  return {
    kind: "sale",
    entityId: id,
    monthId: "m1",
    year: 2026,
    month: 9,
    sheetId: "s1",
    sale: {
      id,
      stockNumber: stock,
      customerName: "Pat",
      vehicleType: "",
      dealType: "new",
      tradeIn: false,
      gross: 500,
      flat: 0,
      fi: 0,
      service: 0,
    },
  };
}

function row(partial: Partial<DealRow> & Pick<DealRow, "id" | "status">): DealRow {
  return {
    rep_id: "rep-1",
    location_id: null,
    created_by: "rep-1",
    staged_data: {},
    live_data: {},
    proposed_data: {},
    previous_data: {},
    rep_notes: null,
    ...partial,
  };
}

test("dealRowHoldsSale matches row id and JSON entityId, not only deal_records.id", () => {
  const live = row({
    id: "deal-row-uuid",
    status: "approved",
    live_data: salePayload("sale-entity"),
  });
  assert.equal(dealRowHoldsSale(live, "deal-row-uuid"), true);
  assert.equal(dealRowHoldsSale(live, "sale-entity"), true);
  assert.equal(dealRowHoldsSale(live, "other"), false);

  const pipeline = row({
    id: "pipeline-uuid",
    status: "awaiting_review",
    live_data: salePayload("sale-entity"),
    staged_data: salePayload("sale-entity"),
    proposed_data: salePayload("sale-entity"),
  });
  assert.equal(dealRowHoldsSale(pipeline, "sale-entity"), true);
});

test("stripDeletedSalesFromState removes tombstoned sales from every sheet", () => {
  const state: TrackerState = {
    vehicleTypes: [],
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
              salePayload("keep").sale!,
              salePayload("gone", "X1").sale!,
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
  const next = stripDeletedSalesFromState(state, ["gone"]);
  assert.deepEqual(
    next.months[0]?.sheets[0]?.sales.map((sale) => sale.id),
    ["keep"],
  );
});

test("hydrate omits leftover deal_records that still hold a deleted sale", () => {
  const rows = [
    row({ id: "keep-row", status: "approved", live_data: salePayload("keep") }),
    row({ id: "stale-row", status: "awaiting_review", live_data: salePayload("gone") }),
  ];
  const kept = omitDeletedSaleRows(rows, new Set(["gone"]));
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, "keep-row");
});

test("sync leftover deletes sale rows of any status, not only approved/active", () => {
  const liveLeftoverId = "11111111-1111-4111-8111-111111111111";
  const pipelineLeftoverId = "22222222-2222-4222-8222-222222222222";
  const keepRowId = "33333333-3333-4333-8333-333333333333";
  const draftSheetId = "44444444-4444-4444-8444-444444444444";
  const payloads = [salePayload("keep")];
  const existing = [
    row({ id: keepRowId, status: "approved", live_data: salePayload("keep") }),
    row({ id: liveLeftoverId, status: "approved", live_data: salePayload("gone-live") }),
    row({
      id: pipelineLeftoverId,
      status: "awaiting_review",
      live_data: salePayload("gone-pipeline"),
      staged_data: salePayload("gone-pipeline"),
    }),
    row({
      id: draftSheetId,
      status: "draft",
      staged_data: { kind: "sheet", entityId: "s1", monthId: "m1", year: 2026, month: 9, sheetId: "s1" },
    }),
    row({
      id: "pay-tracker:rep-1:sale:snapshot",
      status: "awaiting_review",
      live_data: salePayload("snapshot"),
    }),
  ];
  const leftover = leftoverDealRowsToDelete({ existing, payloads, repId: "rep-1" });
  assert.deepEqual(
    leftover.map((item) => item.id).sort(),
    [liveLeftoverId, pipelineLeftoverId].sort(),
  );
});

test("flatten persist drops deleted sale payloads so they are not upserted back", () => {
  const payloads = [salePayload("keep"), salePayload("gone")];
  const next = omitDeletedSalePayloads(payloads, new Set(["gone"]));
  assert.deepEqual(
    next.map((payload) => payload.entityId),
    ["keep"],
  );
});
