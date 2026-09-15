import assert from "node:assert/strict";
import test from "node:test";
import { parseTrackerState, trackerStorageKey, isSessionPreferenceKey } from "./storage.ts";

test("local cache keys guest data separately from a signed-in user", () => {
  assert.equal(trackerStorageKey(null), "pay-tracker:v2");
  assert.equal(
    trackerStorageKey("11111111-1111-1111-1111-111111111111"),
    "pay-tracker:v2:user:11111111-1111-1111-1111-111111111111",
  );
});

test("session preference keys are profile, role, and location — not workbooks", () => {
  assert.equal(isSessionPreferenceKey("pay-tracker:profile"), true);
  assert.equal(isSessionPreferenceKey("pay-tracker:role"), true);
  assert.equal(isSessionPreferenceKey("pay-tracker:location-filter"), true);
  assert.equal(isSessionPreferenceKey("pay-tracker:v2"), false);
  assert.equal(isSessionPreferenceKey("pay-tracker:v2:user:abc"), false);
});

test("parseTrackerState reloads vacation hours, rate, and calculated pay", () => {
  const parsed = parseTrackerState({
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
            vacation_hours: 40,
            vacation_rate: 18.5,
            vacation_pay: 0,
            bonuses: [],
            sales: [],
          },
        ],
      },
    ],
    vehicleTypes: [],
  });
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationHours, 40);
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationRate, 18.5);
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationPay, 740);
});

test("parseTrackerState keeps duplicate_confirmed on sale rows", () => {
  const parsed = parseTrackerState({
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
            bonuses: [],
            sales: [
              {
                id: "d1",
                stockNumber: "H100",
                customerName: "Pat",
                vehicleType: "",
                dealType: "new",
                tradeIn: false,
                gross: 1000,
                flat: 0,
                fi: 0,
                service: 0,
                duplicate_confirmed: true,
              },
            ],
          },
        ],
      },
    ],
    vehicleTypes: [],
  });
  assert.equal(parsed?.months[0]?.sheets[0]?.sales[0]?.duplicateConfirmed, true);
});

test("parseTrackerState keeps a legacy flat vacation pay amount", () => {
  const parsed = parseTrackerState({
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
            vacationPay: 150,
            bonuses: [],
            sales: [],
          },
        ],
      },
    ],
    vehicleTypes: [],
  });
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationHours, 0);
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationRate, 0);
  assert.equal(parsed?.months[0]?.sheets[0]?.vacationPay, 150);
});
