import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnits,
  createSale,
  getCommissionRate,
  saleCommission,
} from "./commission.ts";
import type { Sale } from "./types.ts";

function sale(patch: Partial<Sale>): Sale {
  return { ...createSale(), ...patch };
}

test("pack rate follows the unit schedule", () => {
  assert.equal(getCommissionRate(0), 0.2);
  assert.equal(getCommissionRate(3), 0.2);
  assert.equal(getCommissionRate(4), 0.25);
  assert.equal(getCommissionRate(7), 0.25);
  assert.equal(getCommissionRate(8), 0.3);
  assert.equal(getCommissionRate(11), 0.3);
  assert.equal(getCommissionRate(12), 0.3);
});

test("a row counts as a unit when stock or customer is filled", () => {
  assert.equal(countUnits([sale({})]), 0);
  assert.equal(countUnits([sale({ stockNumber: "H1234" })]), 1);
  assert.equal(countUnits([sale({ customerName: "Jane Doe" })]), 1);
});

test("deal pay is pack of gross plus flats and backend products", () => {
  const deal = sale({
    gross: 1000,
    flat: 50,
    fi: 100,
    service: 25,
    drive360: 10,
    carCare: 15,
    gap: 20,
  });
  assert.equal(saleCommission(deal, 0.2), 420);
  assert.equal(saleCommission(deal, 0.25), 470);
});
