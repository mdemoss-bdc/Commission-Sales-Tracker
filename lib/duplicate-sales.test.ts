import assert from "node:assert/strict";
import test from "node:test";
import { createSale } from "./commission.ts";
import {
  DUPLICATE_SALE_WARNING,
  duplicateSaleIds,
  isDuplicateConfirmed,
  markDuplicateConfirmed,
  salesAreDuplicates,
} from "./duplicate-sales.ts";
import type { Sale } from "./types.ts";

function sale(patch: Partial<Sale>): Sale {
  return { ...createSale(), ...patch };
}

test("same stock and customer across rows is a duplicate", () => {
  const first = sale({ id: "a", stockNumber: " H100 ", customerName: "Pat" });
  const second = sale({ id: "b", stockNumber: "h100", customerName: " pat " });
  assert.equal(salesAreDuplicates(first, second), true);
  assert.equal(salesAreDuplicates(first, first), false);
});

test("same stock with a different customer is not a duplicate unless core fields match", () => {
  const first = sale({ id: "a", stockNumber: "H100", customerName: "Pat", dealType: "new", gross: 1000 });
  const second = sale({ id: "b", stockNumber: "H100", customerName: "Alex", dealType: "new", gross: 1000 });
  assert.equal(salesAreDuplicates(first, second), false);
});

test("matching stock, customer, deal type, and gross flags a duplicate", () => {
  const first = sale({ id: "a", stockNumber: "H100", customerName: "", dealType: "used", gross: 2500 });
  const second = sale({ id: "b", stockNumber: "h100", customerName: "", dealType: "used", gross: 2500 });
  assert.equal(salesAreDuplicates(first, second), true);
});

test("blank new rows and empty stock numbers are not duplicates", () => {
  const first = sale({ id: "a", stockNumber: "", customerName: "Pat" });
  const second = sale({ id: "b", stockNumber: "", customerName: "Pat" });
  const unfinished = sale({ id: "c", stockNumber: "H100", customerName: "", dealType: "new", gross: 0 });
  const otherUnfinished = sale({ id: "d", stockNumber: "H100", customerName: "", dealType: "new", gross: 0 });
  assert.equal(salesAreDuplicates(first, second), false);
  assert.equal(salesAreDuplicates(unfinished, otherUnfinished), false);
});

test("confirmed rows are exempt from highlighting but still match new duplicates", () => {
  const first = markDuplicateConfirmed(sale({ id: "a", stockNumber: "H100", customerName: "Pat" }));
  const second = sale({ id: "b", stockNumber: "H100", customerName: "Pat" });
  const flagged = duplicateSaleIds([first, second]);
  assert.equal(isDuplicateConfirmed(first), true);
  assert.equal(flagged.has("a"), false);
  assert.equal(flagged.has("b"), true);
  assert.equal(DUPLICATE_SALE_WARNING, "Sale already exists elsewhere for this month.");
  assert.equal((first as Sale & { duplicate_confirmed?: boolean }).duplicate_confirmed, true);
});
