import assert from "node:assert/strict";
import test from "node:test";
import type { DealPayload, DealRow } from "./deal-records.ts";
import {
  lastSubmittedLabel,
  latestByMatchKey,
  latestPeriodRows,
  latestRowByRep,
  supersededPipelineIds,
} from "./latest-submission.ts";

function sale(id: string, stock: string, sheet = "s1"): DealPayload {
  return {
    kind: "sale",
    entityId: id,
    monthId: "m1",
    year: 2026,
    month: 9,
    sheetId: sheet,
    sale: {
      id,
      stockNumber: stock,
      customerName: "Pat",
      vehicleType: "",
      dealType: "new",
      tradeIn: false,
      gross: 1000,
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

test("duplicate pending rows for the same stock keep only the newest", () => {
  const older = row({
    id: "old",
    status: "pending_manager_approval",
    updated_at: "2026-09-01T12:00:00.000Z",
    staged_data: sale("d1", "H100"),
  });
  const newer = row({
    id: "new",
    status: "pending_manager_approval",
    updated_at: "2026-09-14T18:00:00.000Z",
    staged_data: sale("d9", "H100"),
  });
  const kept = latestByMatchKey([older, newer]);
  assert.deepEqual(
    kept.map((item) => item.id),
    ["new"],
  );
});

test("queue collapse keeps only the latest pay period per rep", () => {
  const sept = row({
    id: "sept",
    status: "pending_manager_approval",
    updated_at: "2026-09-14T18:00:00.000Z",
    staged_data: sale("d1", "H100", "s-sept"),
  });
  const aug = row({
    id: "aug",
    status: "pending_manager_approval",
    updated_at: "2026-08-02T12:00:00.000Z",
    staged_data: { ...sale("d2", "H200", "s-aug"), monthId: "m0", month: 8 },
  });
  const kept = latestPeriodRows([aug, sept]);
  assert.deepEqual(
    kept.map((item) => item.id),
    ["sept"],
  );
});

test("waiting list shows one row per salesperson", () => {
  const first = row({
    id: "a",
    status: "pending_rep_review",
    updated_at: "2026-09-01T12:00:00.000Z",
    staged_data: sale("d1", "H100"),
  });
  const second = row({
    id: "b",
    status: "pending_rep_review",
    updated_at: "2026-09-14T18:00:00.000Z",
    staged_data: sale("d2", "H200"),
  });
  const other = row({
    id: "c",
    rep_id: "rep2",
    status: "pending_rep_review",
    updated_at: "2026-09-10T12:00:00.000Z",
    staged_data: sale("d3", "N1"),
  });
  assert.deepEqual(
    latestRowByRep([first, second, other]).map((item) => item.id).sort(),
    ["b", "c"],
  );
});

test("superseded ids drop older same-period pipeline rows", () => {
  const keep = row({
    id: "keep",
    status: "pending_manager_approval",
    updated_at: "2026-09-14T18:00:00.000Z",
    staged_data: sale("d2", "H100"),
  });
  const old = row({
    id: "old",
    status: "pending_manager_approval",
    updated_at: "2026-09-01T12:00:00.000Z",
    staged_data: sale("d1", "H100"),
  });
  const otherStock = row({
    id: "other",
    status: "pending_manager_approval",
    updated_at: "2026-09-02T12:00:00.000Z",
    staged_data: sale("d3", "H200"),
  });
  const otherPeriod = row({
    id: "aug",
    status: "pending_manager_approval",
    updated_at: "2026-08-02T12:00:00.000Z",
    staged_data: { ...sale("d4", "A1", "s-aug"), monthId: "m0", month: 8 },
  });
  assert.deepEqual(supersededPipelineIds([keep, old, otherStock, otherPeriod], ["keep"]).sort(), ["old", "other"]);
});

test("last submitted copy marks the latest version", () => {
  assert.match(lastSubmittedLabel("2026-09-14T18:00:00.000Z"), /Last submitted: .* \(Latest Version\)/);
});
