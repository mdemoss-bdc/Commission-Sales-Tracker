import assert from "node:assert/strict";
import test from "node:test";
import {
  UNASSIGNED_STORE_FILTER,
  isStoredLocationFilter,
  matchesLocationFilter,
  storeFilterSummary,
} from "./locations.ts";

test("all-stores filter includes assigned and unassigned people", () => {
  assert.equal(matchesLocationFilter("store-1", null), true);
  assert.equal(matchesLocationFilter(null, null), true);
});

test("store filter only matches that location_id", () => {
  assert.equal(matchesLocationFilter("store-1", "store-1"), true);
  assert.equal(matchesLocationFilter("store-2", "store-1"), false);
  assert.equal(matchesLocationFilter(null, "store-1"), false);
});

test("unassigned filter only matches people with no location_id", () => {
  assert.equal(matchesLocationFilter(null, UNASSIGNED_STORE_FILTER), true);
  assert.equal(matchesLocationFilter("", UNASSIGNED_STORE_FILTER), true);
  assert.equal(matchesLocationFilter("store-1", UNASSIGNED_STORE_FILTER), false);
});

test("count copy names the selected store", () => {
  assert.equal(storeFilterSummary(4, "abc", "Honda / Volkswagen"), "Showing 4 employees at Honda / Volkswagen");
  assert.equal(storeFilterSummary(1, UNASSIGNED_STORE_FILTER), "Showing 1 unassigned employee");
  assert.equal(storeFilterSummary(12, null), "Showing 12 employees across all stores");
});

test("unassigned and all-stores filters survive a location refresh", () => {
  assert.equal(isStoredLocationFilter(null, ["store-1"]), true);
  assert.equal(isStoredLocationFilter(UNASSIGNED_STORE_FILTER, ["store-1"]), true);
  assert.equal(isStoredLocationFilter("store-1", ["store-1"]), true);
  assert.equal(isStoredLocationFilter("gone", ["store-1"]), false);
});
