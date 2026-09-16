import assert from "node:assert/strict";
import test from "node:test";
import { isMissingColumn, isMissingFunction, isMissingRelation, isMissingTable, buildRepSubmitPayload, missingColumnName, organizationFromQuery, usableCachedProfile } from "./org.ts";

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
  assert.equal(
    isMissingColumn("Could not find the 'proposed_data' column of 'deal_records' in the schema cache", "PGRST204"),
    true,
  );
  assert.equal(missingColumnName("Could not find the 'proposed_data' column of 'deal_records' in the schema cache"), "proposed_data");
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
  assert.equal(isMissingRelation("Could not find the function public.join_organization_by_code in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.admin_update_pay_tiers in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.get_current_dealership in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.notify_rep_on_sheet_push in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.notify_location_managers in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the table 'public.pay_tracker_state' in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.upsert_pay_tracker_state in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the table 'public.admin_employee_sheets' in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.upsert_admin_employee_sheet in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.mark_admin_employee_sheet_pushed in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.apply_manager_approval_to_admin_sheet in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.lock_admin_employee_sheet_approved in the schema cache"), true);
  assert.equal(isMissingRelation("Could not find the function public.commit_proposed_to_live in the schema cache"), true);
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

test("cached profiles from another user are never reused", () => {
  const admin = {
    id: "admin-1",
    email: "admin@example.com",
    full_name: "Pat Admin",
    role: "admin" as const,
    location_id: "loc-1",
  };
  assert.equal(usableCachedProfile(admin, "admin-1")?.id, "admin-1");
  assert.equal(usableCachedProfile(admin, "rep-1"), null);
  assert.equal(usableCachedProfile(null, "admin-1"), null);
  assert.equal(usableCachedProfile(admin, null), null);
});

test("resolve_user_profile is treated as a known RPC in setup errors", () => {
  assert.equal(isMissingRelation("Could not find the function public.resolve_user_profile in the schema cache"), true);
});

test("buildRepSubmitPayload sends decisions under updated_deals", () => {
  const payload = buildRepSubmitPayload([{ id: "deal-1", action: "accept", live_data: {} }]);
  assert.equal(payload.decisions[0]?.id, "deal-1");
  assert.equal(payload.deals[0]?.action, "accept");
  assert.equal(payload.deals[0]?.id, "deal-1");
});

test("organizationFromQuery reads get_current_dealership row or array payloads", () => {
  const row = {
    id: "org-1",
    name: "Moses",
    join_code: "7k9x2b",
    pay_tiers: [
      { min: 0, max: 3, rate: 0.2 },
      { min: 4, max: 7, rate: 0.25 },
    ],
  };
  const fromObject = organizationFromQuery(row);
  const fromArray = organizationFromQuery([row]);
  assert.equal(fromObject?.join_code, "7K9X2B");
  assert.equal(fromObject?.pay_tiers?.length, 2);
  assert.equal(fromArray?.id, "org-1");
  assert.equal(organizationFromQuery(null), null);
  assert.equal(organizationFromQuery({ id: "org-1", name: "Moses" }), null);
});
