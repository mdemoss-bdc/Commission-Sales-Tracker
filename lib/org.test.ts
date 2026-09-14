import assert from "node:assert/strict";
import test from "node:test";
import { isMissingFunction, isMissingTable } from "./org.ts";

test("missing RPC functions are not treated as a missing table", () => {
  assert.equal(isMissingFunction("Could not find the function public.list_signup_locations"), true);
  assert.equal(isMissingTable("Could not find the function public.list_signup_locations"), false);
});

test("missing tables still count as setup", () => {
  assert.equal(isMissingTable("Could not find the table 'public.deal_records' in the schema cache", "PGRST205"), true);
  assert.equal(isMissingFunction("Could not find the table 'public.deal_records' in the schema cache", "PGRST205"), false);
});
