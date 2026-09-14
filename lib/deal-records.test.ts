import assert from "node:assert/strict";
import test from "node:test";
import { assembleLiveState, assembleTrackerState, diffPayloads, flattenTrackerState, payloadKey, payloadLabel } from "./deal-records.ts";
import type { TrackerState } from "./types.ts";

const sample: TrackerState = {
  vehicleTypes: [{ id: "vt1", label: "Honda" }],
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
          vacationPay: 100,
          bonuses: [{ id: "b1", label: "CSI", amount: 50 }],
          sales: [
            {
              id: "d1",
              stockNumber: "H100",
              customerName: "Jane",
              vehicleType: "vt1",
              dealType: "new",
              tradeIn: true,
              gross: 1000,
              flat: 50,
              fi: 25,
              service: 10,
            },
          ],
        },
      ],
    },
  ],
};

test("flatten then assemble round-trips a workbook", () => {
  const flat = flattenTrackerState(sample);
  assert.equal(flat.length, 3);
  assert.deepEqual(
    new Set(flat.map(payloadKey)),
    new Set(["vehicle_type:vt1", "sheet:s1", "sale:d1"]),
  );
  const restored = assembleTrackerState(flat.map((payload) => ({ staged_data: payload, live_data: {} })));
  assert.equal(restored.vehicleTypes[0]?.label, "Honda");
  assert.equal(restored.months[0]?.sheets[0]?.sales[0]?.dealType, "new");
  assert.equal(payloadLabel(flat.find((row) => row.kind === "sale")!), "H100 · Jane · New");
  assert.equal(restored.months[0]?.sheets[0]?.vacationPay, 100);
  assert.equal(restored.months[0]?.sheets[0]?.bonuses[0]?.label, "CSI");
});

test("live assemble ignores staged manager drafts", () => {
  const live = assembleLiveState([
    {
      id: "1",
      rep_id: "r1",
      location_id: null,
      created_by: "a1",
      status: "draft",
      staged_data: {
        kind: "sale",
        entityId: "d1",
        monthId: "m1",
        year: 2026,
        month: 9,
        sheetId: "s1",
        sale: {
          id: "d1",
          stockNumber: "NEW",
          customerName: "New",
          vehicleType: "",
          dealType: "used",
          tradeIn: false,
          gross: 2,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      live_data: {
        kind: "sale",
        entityId: "d1",
        monthId: "m1",
        year: 2026,
        month: 9,
        sheetId: "s1",
        sale: {
          id: "d1",
          stockNumber: "OLD",
          customerName: "Old",
          vehicleType: "",
          dealType: "used",
          tradeIn: false,
          gross: 1,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      proposed_data: {},
      rep_notes: null,
    },
  ]);
  assert.equal(live.months[0]?.sheets[0]?.sales[0]?.stockNumber, "OLD");
});

test("diffPayloads reports original vs rep edit", () => {
  const diffs = diffPayloads(
    {
      kind: "sale",
      entityId: "d1",
      sale: {
        id: "d1",
        stockNumber: "H1",
        customerName: "Ann",
        vehicleType: "",
        dealType: "new",
        tradeIn: false,
        gross: 1000,
        flat: 0,
        fi: 0,
        service: 0,
      },
    },
    {
      kind: "sale",
      entityId: "d1",
      sale: {
        id: "d1",
        stockNumber: "H1",
        customerName: "Ann",
        vehicleType: "",
        dealType: "new",
        tradeIn: false,
        gross: 1200,
        flat: 50,
        fi: 0,
        service: 0,
      },
    },
  );
  assert.deepEqual(
    diffs.map((item) => item.label),
    ["Gross", "Flat"],
  );
});
