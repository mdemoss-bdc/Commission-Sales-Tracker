import assert from "node:assert/strict";
import test from "node:test";
import { hideHeaderStatOnPrint } from "./summaries.ts";

test("print header keeps units, trades, and pack and hides the other recap cards", () => {
  assert.equal(hideHeaderStatOnPrint("Units"), false);
  assert.equal(hideHeaderStatOnPrint("Trades"), false);
  assert.equal(hideHeaderStatOnPrint("Pack"), false);
  assert.equal(hideHeaderStatOnPrint("Months"), false);
  assert.equal(hideHeaderStatOnPrint("Gross"), true);
  assert.equal(hideHeaderStatOnPrint("Total pay"), true);
  assert.equal(hideHeaderStatOnPrint("Total"), true);
  assert.equal(hideHeaderStatOnPrint("New"), true);
  assert.equal(hideHeaderStatOnPrint("Used"), true);
  assert.equal(hideHeaderStatOnPrint("Lease BO"), true);
  assert.equal(hideHeaderStatOnPrint("Lease Buyout"), true);
});
