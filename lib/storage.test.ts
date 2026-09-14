import assert from "node:assert/strict";
import test from "node:test";
import { trackerStorageKey } from "./storage.ts";

test("local cache keys guest data separately from a signed-in user", () => {
  assert.equal(trackerStorageKey(null), "pay-tracker:v2");
  assert.equal(
    trackerStorageKey("11111111-1111-1111-1111-111111111111"),
    "pay-tracker:v2:user:11111111-1111-1111-1111-111111111111",
  );
});
