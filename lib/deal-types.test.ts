import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEAL_TYPE, dealTypeLabel, parseDealType } from "./deal-types.ts";
import { countUnits, createSale, saleCommission } from "./commission.ts";
import { dealTypeStats } from "./summaries.ts";

test("deal type defaults to New and accepts Used and Lease Buyout", () => {
  assert.equal(parseDealType(undefined), DEFAULT_DEAL_TYPE);
  assert.equal(parseDealType("Used"), "used");
  assert.equal(parseDealType("lease buyout"), "lease_buyout");
  assert.equal(dealTypeLabel("lease_buyout"), "Lease Buyout");
  assert.equal(createSale().dealType, "new");
});

test("New, Used, and Lease Buyout each count as a unit and use the same pack plus flat", () => {
  const rows = [
    { ...createSale(), stockNumber: "N1", dealType: "new" as const, gross: 1000, flat: 50 },
    { ...createSale(), stockNumber: "U1", dealType: "used" as const, gross: 1000, flat: 75 },
    { ...createSale(), customerName: "Lease", dealType: "lease_buyout" as const, gross: 1000, flat: 100 },
  ];
  assert.equal(countUnits(rows), 3);
  assert.equal(saleCommission(rows[1], 0.2), 275);
  assert.equal(saleCommission(rows[2], 0.2), 300);
  const mix = dealTypeStats(rows);
  assert.equal(mix.new.units, 1);
  assert.equal(mix.used.units, 1);
  assert.equal(mix.lease_buyout.units, 1);
  assert.equal(mix.used.gross, 1000);
});
