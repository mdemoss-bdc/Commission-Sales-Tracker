import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagerReviewView,
  comparedSalesForReview,
  matchingBaselineSheet,
} from "./manager-review-sheet.ts";
import type { PaySheet, TrackerState } from "./types.ts";

function sale(id: string, stock: string, gross: number, extra: Partial<TrackerState["months"][number]["sheets"][number]["sales"][number]> = {}) {
  return {
    id,
    stockNumber: stock,
    customerName: extra.customerName ?? "Pat",
    vehicleType: extra.vehicleType ?? "honda",
    dealType: extra.dealType ?? "new",
    tradeIn: extra.tradeIn ?? false,
    gross,
    flat: extra.flat ?? 0,
    fi: extra.fi ?? 0,
    service: extra.service ?? 0,
  };
}

function workbook(sales: ReturnType<typeof sale>[], extras: Partial<PaySheet> = {}): TrackerState {
  return {
    vehicleTypes: [{ id: "honda", label: "Honda" }],
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
            vacationHours: extras.vacationHours ?? 0,
            vacationRate: extras.vacationRate ?? 0,
            vacationPay: extras.vacationPay ?? 0,
            bonuses: extras.bonuses ?? [],
            sales,
          },
        ],
      },
    ],
  };
}

test("comparedSalesForReview keeps added, edited, and removed deals on the print table", () => {
  const baseline = workbook([sale("d1", "H100", 1000), sale("d2", "H200", 800)]);
  const draft = workbook([sale("d1", "H100", 1250, { flat: 50 }), sale("n1", "N1", 900)]);
  const diff = comparedSalesForReview(baseline.months[0]!.sheets[0], draft.months[0]!.sheets[0]!);
  assert.equal(diff.sales.map((row) => row.stockNumber).join(","), "H100,N1,H200");
  assert.equal(diff.compared.find((row) => row.sale.stockNumber === "N1")?.kind, "extra");
  assert.equal(diff.compared.find((row) => row.sale.stockNumber === "H200")?.kind, "missing");
  assert.deepEqual(diff.compared.find((row) => row.sale.stockNumber === "H100")?.fields.sort(), ["flat", "gross"]);
  assert.equal(diff.notes.some((note) => note.kind === "added"), true);
  assert.equal(diff.notes.some((note) => note.kind === "edited"), true);
  assert.equal(diff.notes.some((note) => note.kind === "removed"), true);
});

test("buildManagerReviewView hydrates the print-ready month and signed pay delta", () => {
  const baseline = workbook([sale("d1", "H100", 1000)], {
    vacationHours: 8,
    vacationRate: 20,
    bonuses: [{ id: "b1", label: "Spiff", amount: 50 }],
  });
  const draft = workbook([sale("d1", "H100", 1400), sale("n1", "N1", 500)], {
    vacationHours: 8,
    vacationRate: 20,
    bonuses: [{ id: "b1", label: "Spiff", amount: 75 }],
  });
  const view = buildManagerReviewView({ baseline, draft, period: "2026-09-part1" });
  assert.equal(view.month?.id, "m1");
  assert.equal(view.sheets[0]?.sales.length, 2);
  assert.equal(view.addedCount, 1);
  assert.equal(view.payDelta.delta !== 0, true);
  assert.match(view.payDelta.label, /^[+-]\$/);
  assert.equal(matchingBaselineSheet(baseline, view.month!, view.sheets[0]!)?.id, "s1");
});

test("buildManagerReviewView delta matches displayed period sheets, not ghost other-period pay", () => {
  const baseline: TrackerState = {
    vehicleTypes: [],
    months: [
      {
        id: "2026-09-part1",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "2026-09-part1",
            startDay: 1,
            endDay: 15,
            sales: [],
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: [],
          },
        ],
      },
      {
        id: "ghost-other",
        year: 2026,
        month: 8,
        sheets: [
          {
            id: "ghost-sheet",
            startDay: 1,
            endDay: 15,
            sales: [sale("ghost", "G1", 10000, { flat: 500 })],
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: [],
          },
        ],
      },
    ],
  };
  const draft: TrackerState = {
    vehicleTypes: [],
    months: [
      {
        id: "2026-09-part1",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "2026-09-part1",
            startDay: 1,
            endDay: 15,
            sales: [],
            vacationHours: 40,
            vacationRate: 50,
            vacationPay: 2000,
            bonuses: [],
          },
        ],
      },
      {
        id: "ghost-other",
        year: 2026,
        month: 8,
        sheets: [
          {
            id: "ghost-sheet",
            startDay: 1,
            endDay: 15,
            sales: [sale("ghost2", "G2", 5000)],
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: [],
          },
        ],
      },
    ],
  };
  const view = buildManagerReviewView({ baseline, draft, period: "2026-09-part1" });
  // Displayed Final Total Pay is vacation-only $2,000 — delta must not include Aug ghost deals.
  assert.equal(view.payDelta.workingPay, 2000);
  assert.equal(view.payDelta.adminPay, 0);
  assert.equal(view.payDelta.delta, 2000);
});
