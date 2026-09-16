import assert from "node:assert/strict";
import test from "node:test";
import {
  activePayPeriod,
  parsePayPeriodKey,
  payPeriodKey,
  periodFromSheet,
  periodsCompatible,
  pickMonthForPeriod,
  pickSheetsForPeriod,
  mergeTrackerMonths,
  splitFromRange,
} from "./pay-period.ts";
import type { TrackerState } from "./types.ts";

test("pay period keys distinguish 1st–15th, 16th–end, and full month", () => {
  assert.equal(splitFromRange(1, 15, 2026, 9), "part1");
  assert.equal(splitFromRange(16, 30, 2026, 9), "part2");
  assert.equal(splitFromRange(1, 30, 2026, 9), "full");
  assert.equal(payPeriodKey(2026, 9, "part1"), "2026-09-part1");
  assert.equal(payPeriodKey(2026, 9, "part2"), "2026-09-part2");
  assert.equal(parsePayPeriodKey("2026-09-16th-end").split, "part2");
  assert.equal(parsePayPeriodKey("2026-09-part2").key, "2026-09-part2");
  assert.equal(parsePayPeriodKey("2026-09-1st-15th").split, "part1");
  assert.equal(periodsCompatible(parsePayPeriodKey("2026-09-part2"), parsePayPeriodKey("2026-09-16th-end")), true);
  assert.equal(periodsCompatible(parsePayPeriodKey("2026-09-part1"), parsePayPeriodKey("2026-09-part2")), false);
});

test("activePayPeriod uses 16th–end on or after the 16th", () => {
  assert.equal(activePayPeriod(new Date("2026-09-16T12:00:00Z")).split, "part2");
  assert.equal(activePayPeriod(new Date("2026-09-15T12:00:00Z")).split, "part1");
  assert.equal(activePayPeriod(new Date("2026-09-16T12:00:00Z")).key, "2026-09-part2");
});

test("pickMonthForPeriod prefers the 16th–end month that actually has deals", () => {
  const state: TrackerState = {
    vehicleTypes: [],
    months: [
      {
        id: "sep-part1",
        year: 2026,
        month: 9,
        sheets: [
          { id: "s1", startDay: 1, endDay: 15, sales: [], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] },
        ],
      },
      {
        id: "sep-part2",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "s2",
            startDay: 16,
            endDay: 30,
            sales: [
              {
                id: "d2",
                stockNumber: "H222",
                customerName: "Test User 2",
                vehicleType: "honda",
                dealType: "used",
                tradeIn: false,
                gross: 1800,
                flat: 0,
                fi: 0,
                service: 0,
              },
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
  const preferred = parsePayPeriodKey("2026-09-part2");
  const month = pickMonthForPeriod(state, preferred, new Date("2026-09-16T12:00:00Z"));
  assert.equal(month?.id, "sep-part2");
  assert.equal(pickSheetsForPeriod(month, preferred)[0]?.sales[0]?.stockNumber, "H222");
  assert.equal(periodFromSheet(month!.sheets[0], month).split, "part2");
});

test("mergeTrackerMonths keeps first-half and 16th–end sheets under one calendar month", () => {
  const merged = mergeTrackerMonths([
    {
      vehicleTypes: [],
      months: [
        {
          id: "uuid-a",
          year: 2026,
          month: 9,
          sheets: [
            { id: "s1", startDay: 1, endDay: 15, sales: [], vacationHours: 0, vacationRate: 0, vacationPay: 0, bonuses: [] },
          ],
        },
      ],
    },
    {
      vehicleTypes: [{ id: "honda", label: "Honda" }],
      months: [
        {
          id: "uuid-b",
          year: 2026,
          month: 9,
          sheets: [
            {
              id: "s2",
              startDay: 16,
              endDay: 30,
              sales: [
                {
                  id: "d2",
                  stockNumber: "H222",
                  customerName: "Riley",
                  vehicleType: "honda",
                  dealType: "used",
                  tradeIn: false,
                  gross: 900,
                  flat: 0,
                  fi: 0,
                  service: 0,
                },
              ],
              vacationHours: 0,
              vacationRate: 0,
              vacationPay: 0,
              bonuses: [],
            },
          ],
        },
      ],
    },
  ]);
  assert.equal(merged?.months.length, 1);
  assert.equal(merged?.months[0]?.sheets.length, 2);
  assert.equal(pickSheetsForPeriod(merged!.months[0], parsePayPeriodKey("2026-09-16th-end"))[0]?.sales[0]?.stockNumber, "H222");
});
