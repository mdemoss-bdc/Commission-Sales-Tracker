import assert from "node:assert/strict";
import test from "node:test";
import { assembleTrackerState, flattenTrackerState, payloadKey } from "./deal-records.ts";
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
  assert.equal(restored.months[0]?.sheets[0]?.sales[0]?.stockNumber, "H100");
  assert.equal(restored.months[0]?.sheets[0]?.vacationPay, 100);
  assert.equal(restored.months[0]?.sheets[0]?.bonuses[0]?.label, "CSI");
});

test("working copy prefers staged_data over live_data", () => {
  const restored = assembleTrackerState([
    {
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
          tradeIn: false,
          gross: 1,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
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
          tradeIn: false,
          gross: 2,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
    },
  ]);
  assert.equal(restored.months[0]?.sheets[0]?.sales[0]?.stockNumber, "NEW");
});
