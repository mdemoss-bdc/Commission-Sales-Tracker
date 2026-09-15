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

test("recall_pending_push is treated as a known RPC in setup errors", () => {
  assert.equal(isMissingRelation("Could not find the function public.recall_pending_push in the schema cache"), true);
});

test("org join-code RPCs are treated as known setup functions", () => {
  assert.equal(isMissingFunction("Could not find the function public.lookup_stores_by_org_code"), true);
  assert.equal(isMissingRelation("Could not find the function public.lookup_stores_by_org_code in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.set_organization_code in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.register_new_dealership_admin in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.admin_update_pay_tiers in the schema cache"), true);
});

test("admin_set_user_assignment is treated as a known RPC in setup errors", () => {
  assert.equal(isMissingRelation("Could not find the function public.admin_set_user_assignment in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.admin_set_user_role in the schema cache"), true);
});

test("location switch RPCs are treated as known setup functions", () => {
  assert.equal(isMissingRelation("Could not find the function public.get_available_org_locations in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.set_my_location in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.admin_set_user_location in the schema cache"), true);
});

test("custom_roles table is treated as a known setup relation", () => {
  assert.equal(isMissingRelation("Could not find the table 'public.custom_roles' in the schema cache"), true);
});

test("buildRepSubmitPayload sends decisions under updated_deals", () => {
  const payload = buildRepSubmitPayload([{ id: "deal-1", action: "accept", live_data: {} }]);
  assert.equal(payload.decisions[0]?.id, "deal-1");
  assert.equal(payload.deals[0]?.action, "accept");
  assert.equal(payload.deals[0]?.id, "deal-1");
});
