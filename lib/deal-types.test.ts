import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEAL_TYPE, dealTypeLabel, parseDealType } from "./deal-types.ts";
import { countUnits, countUnitsByCategory, createSale, saleCommission } from "./commission.ts";
import { dealTypeStats, summarizeSales } from "./summaries.ts";
import { defaultVehicleTypeCategory } from "./vehicles.ts";
import type { VehicleTypeOption } from "./types.ts";

test("deal type defaults to New and accepts Used and Lease Buyout", () => {
  assert.equal(parseDealType(undefined), DEFAULT_DEAL_TYPE);
  assert.equal(parseDealType("Used"), "used");
  assert.equal(parseDealType("lease buyout"), "lease_buyout");
  assert.equal(dealTypeLabel("lease_buyout"), "Lease Buyout");
  assert.equal(createSale().dealType, "new");
});

test("vehicle type labels default to NEW / USED / OTHER categories", () => {
  assert.equal(defaultVehicleTypeCategory("Honda"), "NEW");
  assert.equal(defaultVehicleTypeCategory("Volkswagen"), "NEW");
  assert.equal(defaultVehicleTypeCategory("Subaru"), "NEW");
  assert.equal(defaultVehicleTypeCategory("Used"), "USED");
  assert.equal(defaultVehicleTypeCategory("Street Purchase"), "OTHER");
  assert.equal(defaultVehicleTypeCategory("Lease Buyout"), "OTHER");
});

test("New and Used volume come from vehicle type category; Other is excluded from Total Units", () => {
  const types: VehicleTypeOption[] = [
    { id: "honda", label: "Honda", category: "NEW" },
    { id: "used", label: "Used", category: "USED" },
    { id: "lease", label: "Lease Buyout", category: "OTHER" },
  ];
  const rows = [
    { ...createSale(), stockNumber: "N1", vehicleType: "honda", gross: 1000, flat: 50 },
    { ...createSale(), stockNumber: "U1", vehicleType: "used", gross: 1000, flat: 75, splitDeal: true },
    { ...createSale(), customerName: "Lease", vehicleType: "lease", gross: 1000, flat: 100 },
  ];
  assert.equal(countUnitsByCategory(rows, types, "NEW"), 1);
  assert.equal(countUnitsByCategory(rows, types, "USED"), 0.5);
  assert.equal(countUnits(rows, types), 1.5);
  const totals = summarizeSales(rows, undefined, types);
  assert.equal(totals.totalNewUnits, 1);
  assert.equal(totals.totalUsedUnits, 0.5);
  assert.equal(totals.units, 1.5);
  assert.equal(saleCommission(rows[1], 0.2), 275);
  assert.equal(saleCommission(rows[2], 0.2), 300);
  const mix = dealTypeStats(rows, types);
  assert.equal(mix.new.units, 1);
  assert.equal(mix.used.units, 0.5);
  assert.equal(mix.lease_buyout.units, 1);
  assert.equal(mix.used.gross, 1000);
});
