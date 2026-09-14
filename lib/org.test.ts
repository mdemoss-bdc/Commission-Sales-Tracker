import assert from "node:assert/strict";
import test from "node:test";
import { isMissingColumn, isMissingFunction, isMissingRelation, isMissingTable, buildRepSubmitPayload } from "./org.ts";

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

test("rep_submit_to_manager is treated as a known RPC in setup errors", () => {
  assert.equal(isMissingRelation("Could not find the function public.rep_submit_to_manager in the schema cache"), true);
});

test("buildRepSubmitPayload sends decisions under updated_deals", () => {
  const payload = buildRepSubmitPayload([{ id: "deal-1", action: "accept", live_data: {} }]);
  assert.equal(payload.decisions[0]?.id, "deal-1");
  assert.equal(payload.deals[0]?.action, "accept");
  assert.equal(payload.deals[0]?.id, "deal-1");
});
