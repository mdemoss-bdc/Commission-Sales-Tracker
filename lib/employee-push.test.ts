import assert from "node:assert/strict";
import test from "node:test";
import { buildEmployeePushPayload } from "./employee-push.ts";
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
          vacationHours: 40,
          vacationRate: 25,
          vacationPay: 0,
          bonuses: [{ id: "b1", label: "Spiff", amount: 1000 }],
          sales: [
            {
              id: "d1",
              stockNumber: "H100",
              customerName: "Jane",
              vehicleType: "vt1",
              dealType: "new",
              tradeIn: false,
              gross: 1000,
              flat: 0,
              fi: 0,
              service: 0,
            },
          ],
        },
      ],
    },
  ],
};

test("buildEmployeePushPayload includes deals, vacation, bonuses, and flattened records", () => {
  const payload = buildEmployeePushPayload(sample);
  assert.equal(payload.deals.length, 1);
  assert.equal(payload.deals[0]?.stockNumber, "H100");
  assert.equal(payload.vacation_hours, 40);
  assert.equal(payload.hourly_rate, 25);
  assert.equal(payload.vacation_pay, 1000);
  assert.deepEqual(payload.bonuses, [{ id: "b1", label: "Spiff", amount: 1000 }]);
  assert.equal(payload.sheets[0]?.sheetId, "s1");
  assert.equal(
    payload.records.some((row) => row.kind === "sheet" && row.vacationHours === 40 && row.bonuses?.[0]?.amount === 1000),
    true,
  );
  assert.equal(
    payload.records.some((row) => row.kind === "sale" && row.sale?.stockNumber === "H100"),
    true,
  );
});
