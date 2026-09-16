import assert from "node:assert/strict";
import test from "node:test";
import type { DealPayload } from "./deal-records.ts";
import type { ReviewItem } from "./rep-review.ts";
import type { Sale } from "./types.ts";
import {
  compareExtras,
  compareSaleRows,
  leftoverEditedSales,
  leftoverEditedSheet,
  resolutionsFromEditedSheet,
  reviewSheetTargets,
  reviewTargetsFromRows,
  saleMatchKey,
  acceptPushedSheetSubmit,
  disputePushedSheetSubmit,
  applyManagerSheetToState,
  resolveReviewTarget,
  resolvedStagedSheetFor,
  managerBufferTotalsFromRows,
  sheetFromTracker,
  paySheetFromParts,
  extrasFromSheet,
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

test("compareExtras highlights vacation and bonus differences", () => {
  const compared = compareExtras(
    {
      vacationHours: 8,
      vacationRate: 20,
      vacationPay: 160,
      bonuses: [{ id: "b1", label: "CSI", amount: 100 }],
    },
    {
      vacationHours: 40,
      vacationRate: 20,
      vacationPay: 800,
      bonuses: [
        { id: "b1", label: "CSI", amount: 100 },
        { id: "b2", label: "Spiff", amount: 1000 },
      ],
    },
  );
  assert.equal(compared.live.hours, true);
  assert.equal(compared.pushed.hours, true);
  assert.equal(compared.live.rate, false);
  assert.equal(compared.pushed.pay, true);
  assert.equal(compared.live.bonusIds.has("b1"), false);
  assert.equal(compared.pushed.bonusIds.has("b2"), true);
});

test("resolutionsFromEditedSheet writes edited vacation and bonuses onto sheet items", () => {
  const item: ReviewItem = {
    id: "sheet1",
    liveId: "live-sheet",
    kind: "conflict",
    title: "Worksheet extras",
    manager: {
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
    },
    mine: {
      kind: "sheet",
      entityId: "s1",
      monthId: "m1",
      year: 2026,
      month: 9,
      sheetId: "s1",
      vacationHours: 0,
      vacationRate: 0,
      vacationPay: 0,
      bonuses: [],
    },
    diffs: [],
  };
  const decisions = resolutionsFromEditedSheet([], [], [], {
    vacationHours: 16,
    vacationRate: 22,
    vacationPay: 352,
    bonuses: [{ id: "b9", label: "Volume", amount: 250 }],
  });
  assert.equal(decisions.length, 0);
  const updated = resolutionsFromEditedSheet([item], [], [], {
    vacationHours: 16,
    vacationRate: 22,
    vacationPay: 352,
    bonuses: [{ id: "b9", label: "Volume", amount: 250 }],
  });
  const live = updated[0]?.live_data as DealPayload;
  assert.equal(updated[0]?.action, "use_manager");
  assert.equal(live.vacationHours, 16);
  assert.equal(live.vacationRate, 22);
  assert.equal(live.vacationPay, 352);
  assert.deepEqual(live.bonuses, [{ id: "b9", label: "Volume", amount: 250 }]);
});

test("leftover extras become a sheet payload when no sheet item exists", () => {
  const leftover = leftoverEditedSheet(
    [],
    {
      vacationHours: 8,
      vacationRate: 18.5,
      vacationPay: 148,
      bonuses: [{ id: "b1", label: "CSI", amount: 75 }],
    },
    { monthId: "m1", sheetId: "s1", year: 2026, month: 9 },
  );
  assert.equal(leftover?.kind, "sheet");
  assert.equal(leftover?.vacationHours, 8);
  assert.equal(leftover?.vacationRate, 18.5);
  assert.equal(leftover?.vacationPay, 148);
  assert.equal(leftover?.bonuses?.[0]?.label, "CSI");
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
  assert.deepEqual(targets, [{ monthId: "m1", sheetId: "s1", label: "September 2026", year: 2026, month: 9 }]);
});

test("reviewTargetsFromRows finds a pushed sheet even on awaiting_review rows", () => {
  const targets = reviewTargetsFromRows([
    {
      id: "push-1",
      rep_id: "rep1",
      location_id: "loc1",
      created_by: "mgr1",
      status: "awaiting_review",
      staged_data: payload(sale("d1", "H100")),
      live_data: {},
      rep_notes: null,
    },
  ]);
  assert.equal(targets[0]?.monthId, "m1");
  assert.equal(targets[0]?.sheetId, "s1");
});

test("acceptPushedSheetSubmit uses manager values and leftover sheet extras", () => {
  const rows = [
    {
      id: "push-1",
      rep_id: "rep1",
      location_id: "loc1",
      created_by: "mgr1",
      status: "awaiting_review" as const,
      staged_data: payload(sale("d1", "H100", 1250)),
      live_data: {},
      rep_notes: null,
    },
  ];
  const submit = acceptPushedSheetSubmit(rows, "m1", "s1");
  assert.equal(submit.decisions[0]?.action, "accept");
  assert.equal((submit.decisions[0]?.live_data as DealPayload).sale?.gross, 1250);
});

test("disputePushedSheetSubmit keeps live values and declines new manager rows", () => {
  const rows = [
    {
      id: "push-1",
      rep_id: "rep1",
      location_id: "loc1",
      created_by: "mgr1",
      status: "awaiting_review" as const,
      staged_data: payload(sale("d9", "H100", 1250)),
      live_data: {},
      rep_notes: null,
    },
    {
      id: "live-1",
      rep_id: "rep1",
      location_id: "loc1",
      created_by: "rep1",
      status: "active" as const,
      staged_data: {},
      live_data: payload(sale("d1", "H100", 1000)),
      rep_notes: null,
    },
  ];
  const dispute = disputePushedSheetSubmit(rows, "m1", "s1");
  assert.equal(dispute.decisions[0]?.action, "keep_mine");
  assert.equal((dispute.decisions[0]?.live_data as DealPayload).sale?.gross, 1000);
  assert.ok(dispute.ids.includes("push-1"));
});

test("applyManagerSheetToState writes the manager buffer onto the live worksheet", () => {
  const next = applyManagerSheetToState(
    { months: [], vehicleTypes: [] },
    "m1",
    "s1",
    {
      id: "s1",
      startDay: 1,
      endDay: 15,
      sales: [sale("d9", "MGR", 999)],
      vacationHours: 8,
      vacationRate: 20,
      vacationPay: 160,
      bonuses: [],
    },
    { year: 2026, month: 9 },
  );
  assert.equal(next.months[0]?.id, "m1");
  assert.equal(next.months[0]?.sheets[0]?.sales[0]?.stockNumber, "MGR");
  assert.equal(next.months[0]?.sheets[0]?.sales[0]?.gross, 999);
  assert.equal(next.months[0]?.sheets[0]?.vacationHours, 8);
});

test("resolveReviewTarget falls back to the live sheet when no push rows exist", () => {
  const target = resolveReviewTarget(
    [],
    {
      months: [
        {
          id: "m-live",
          year: 2026,
          month: 9,
          sheets: [{ id: "s-live" }],
        },
      ],
    },
  );
  assert.equal(target.monthId, "m-live");
  assert.equal(target.sheetId, "s-live");
  assert.equal(resolveReviewTarget([], { months: [] }).monthId, "pending-month");
});

test("resolvedStagedSheetFor falls back to the first pushed sheet with deals", () => {
  const rows = [
    {
      id: "push-1",
      rep_id: "rep1",
      location_id: "loc1",
      created_by: "mgr1",
      status: "awaiting_review" as const,
      staged_data: payload(sale("d1", "H100", 1250)),
      live_data: {},
      rep_notes: null,
    },
  ];
  const sheet = resolvedStagedSheetFor(rows, "pending-month", "pending-sheet");
  assert.equal(sheet?.sales[0]?.stockNumber, "H100");
  assert.equal(sheet?.sales[0]?.gross, 1250);
});

test("managerBufferTotalsFromRows uses units/trades/gross/total_pay on the staged payload", () => {
  const totals = managerBufferTotalsFromRows(
    [
      {
        id: "push-1",
        rep_id: "rep1",
        location_id: "loc1",
        created_by: "mgr1",
        status: "awaiting_review",
        staged_data: {
          kind: "sheet",
          entityId: "s1",
          monthId: "m1",
          year: 2026,
          month: 9,
          sheetId: "s1",
          units: 5,
          trades: 2,
          gross: 7500,
          total_pay: 1800,
        },
        live_data: {},
        rep_notes: null,
      },
    ],
    "m1",
    "s1",
  );
  assert.equal(totals.units, 5);
  assert.equal(totals.trades, 2);
  assert.equal(totals.gross, 7500);
  assert.equal(totals.pay, 1800);
});

test("sheetFromTracker reads the matching worksheet from an admin snapshot", () => {
  const tracker = {
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
            sales: [sale("d1", "H100", 2200)],
            vacationHours: 2,
            vacationRate: 20,
            vacationPay: 40,
            bonuses: [],
          },
        ],
      },
    ],
    vehicleTypes: [],
  };
  const sheet = sheetFromTracker(tracker, "m1", "s1");
  assert.equal(sheet?.sales[0]?.stockNumber, "H100");
  assert.equal(sheetFromTracker(null, "m1", "s1"), null);
  const rebuilt = paySheetFromParts("s1", [sale("d2", "N1", 900)], extrasFromSheet(sheet), {
    startDay: 1,
    endDay: 15,
  });
  assert.equal(rebuilt.sales[0]?.stockNumber, "N1");
  assert.equal(rebuilt.vacationHours, 2);
});
