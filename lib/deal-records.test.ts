import assert from "node:assert/strict";
import test from "node:test";
import { assembleLiveState, assembleRepViewState, assembleTrackerState, diffPayloads, flattenTrackerState, mergeLiveWithPushedMonths, payloadKey, payloadLabel } from "./deal-records.ts";
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
          vacationRate: 18.5,
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
  assert.equal(restored.months[0]?.sheets[0]?.vacationHours, 40);
  assert.equal(restored.months[0]?.sheets[0]?.vacationRate, 18.5);
  assert.equal(restored.months[0]?.sheets[0]?.vacationPay, 740);
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

test("assembleRepViewState overlays pushed sheet numbers onto the sales-rep workbook", () => {
  const live = assembleLiveState([
    {
      id: "live-1",
      rep_id: "r1",
      location_id: null,
      created_by: "r1",
      status: "active",
      staged_data: {},
      live_data: {
        kind: "sale",
        entityId: "d1",
        monthId: "m-live",
        year: 2026,
        month: 8,
        sheetId: "s-live",
        sale: {
          id: "d1",
          stockNumber: "LIVE",
          customerName: "Pat",
          vehicleType: "",
          dealType: "new",
          tradeIn: false,
          gross: 500,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      rep_notes: null,
    },
  ]);
  const merged = assembleRepViewState([
    {
      id: "live-1",
      rep_id: "r1",
      location_id: null,
      created_by: "r1",
      status: "active",
      staged_data: {},
      live_data: {
        kind: "sale",
        entityId: "d1",
        monthId: "m-live",
        year: 2026,
        month: 8,
        sheetId: "s-live",
        sale: {
          id: "d1",
          stockNumber: "LIVE",
          customerName: "Pat",
          vehicleType: "",
          dealType: "new",
          tradeIn: false,
          gross: 500,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      rep_notes: null,
    },
    {
      id: "push-1",
      rep_id: "r1",
      location_id: null,
      created_by: "mgr",
      status: "awaiting_review",
      staged_data: {
        kind: "sale",
        entityId: "d9",
        monthId: "m-push",
        year: 2026,
        month: 9,
        sheetId: "s-push",
        sale: {
          id: "d9",
          stockNumber: "PUSH",
          customerName: "Manager",
          vehicleType: "",
          dealType: "new",
          tradeIn: false,
          gross: 1250,
          flat: 0,
          fi: 0,
          service: 0,
        },
      },
      live_data: {},
      rep_notes: null,
    },
  ]);
  assert.equal(live.months.some((month) => month.id === "m-push"), false);
  assert.equal(merged.months.some((month) => month.id === "m-push"), true);
  const pushedSheet = merged.months.find((month) => month.id === "m-push")?.sheets[0];
  assert.equal(pushedSheet?.sales[0]?.stockNumber, "PUSH");
  assert.equal(pushedSheet?.sales[0]?.gross, 1250);
  assert.equal(merged.months.find((month) => month.id === "m-live")?.sheets[0]?.sales[0]?.stockNumber, "LIVE");
});

test("mergeLiveWithPushedMonths keeps the sales-rep draft and adds missing pushed sheets", () => {
  const live = {
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
              {
                id: "d1",
                stockNumber: "MINE",
                customerName: "Pat",
                vehicleType: "",
                dealType: "new" as const,
                tradeIn: false,
                gross: 100,
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
  const pushed = {
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
              {
                id: "d9",
                stockNumber: "MGR",
                customerName: "Boss",
                vehicleType: "",
                dealType: "new" as const,
                tradeIn: false,
                gross: 999,
                flat: 0,
                fi: 0,
                service: 0,
              },
            ],
            vacationHours: 8,
            vacationRate: 20,
            vacationPay: 160,
            bonuses: [],
          },
        ],
      },
    ],
  };
  const merged = mergeLiveWithPushedMonths(live, pushed);
  assert.equal(merged.months[0]?.sheets[0]?.sales[0]?.stockNumber, "MINE");
  assert.equal(merged.months[0]?.sheets[0]?.sales[0]?.gross, 100);
  assert.equal(merged.months[0]?.sheets[0]?.vacationHours, 0);
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

test("assemble reads snake_case vacation hours and rate from a sheet payload", () => {
  const restored = assembleTrackerState([
    {
      staged_data: {
        kind: "sheet",
        entityId: "s1",
        monthId: "m1",
        year: 2026,
        month: 9,
        sheetId: "s1",
        startDay: 1,
        endDay: 15,
        vacation_hours: 8,
        vacation_rate: 20,
        vacation_pay: 0,
        bonuses: [],
      },
      live_data: {},
    },
  ]);
  assert.equal(restored.months[0]?.sheets[0]?.vacationHours, 8);
  assert.equal(restored.months[0]?.sheets[0]?.vacationRate, 20);
  assert.equal(restored.months[0]?.sheets[0]?.vacationPay, 160);
});
