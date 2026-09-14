import assert from "node:assert/strict";
import test from "node:test";
import { locationFilterLabel, matchesLocationFilter } from "./locations.ts";

test("all-locations filter includes assigned and unassigned people", () => {
  assert.equal(matchesLocationFilter("store-1", null), true);
  assert.equal(matchesLocationFilter(null, null), true);
});

test("store filter only matches that location_id", () => {
  assert.equal(matchesLocationFilter("store-1", "store-1"), true);
  assert.equal(matchesLocationFilter("store-2", "store-1"), false);
  assert.equal(matchesLocationFilter(null, "store-1"), false);
});

test("store-only labels use the location name", () => {
  assert.equal(locationFilterLabel("Morgantown"), "Morgantown Only");
  assert.equal(locationFilterLabel("Supercenter"), "Supercenter Only");
});
