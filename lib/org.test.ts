import assert from "node:assert/strict";
import test from "node:test";
import { isMissingColumn, isMissingFunction, isMissingTable } from "./org.ts";

test("missing RPC functions are not treated as a missing table", () => {
  assert.equal(isMissingFunction("Could not find the function public.list_signup_locations"), true);
  assert.equal(isMissingTable("Could not find the function public.list_signup_locations"), false);
});

test("missing tables still count as setup", () => {
  assert.equal(isMissingTable("Could not find the table 'public.deal_records' in the schema cache", "PGRST205"), true);
  assert.equal(isMissingFunction("Could not find the table 'public.deal_records' in the schema cache", "PGRST205"), false);
});

test("isMissingColumn detects PostgREST missing-column errors", () => {
  assert.equal(
    isMissingColumn("Could not find the 'previous_data' column of 'deal_records' in the schema cache", "PGRST204"),
    true,
  );
  assert.equal(isMissingColumn("Could not find the table 'public.deal_records' in the schema cache", "PGRST205"), false);
});
