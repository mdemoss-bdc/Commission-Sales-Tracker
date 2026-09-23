import assert from "node:assert/strict";
import test from "node:test";
import { COMMISSION_TIERS } from "./commission.ts";
import {
  fromPayPlanTierConfig,
  resolvePayPlan,
  toPayPlanTierConfig,
} from "./pay-plan.ts";
import type { OrganizationRecord } from "./roles.ts";

test("to/from pay plan tier config round-trips pack percentage", () => {
  const tier = COMMISSION_TIERS[0];
  const config = toPayPlanTierConfig(tier);
  assert.equal(config.minUnits, 0);
  assert.equal(config.maxUnits, 3);
  assert.equal(config.packPercentage, 20);
  const back = fromPayPlanTierConfig(config);
  assert.equal(back.min, 0);
  assert.equal(back.max, 3);
  assert.equal(back.rate, 0.2);
});

test("dealership pay plan locks linked users", () => {
  const organization = {
    id: "org-1",
    name: "Moses Auto",
    join_code: "MOSES",
    pay_tiers: COMMISSION_TIERS,
  } as OrganizationRecord;
  const plan = resolvePayPlan({
    organization,
    profile: {
      id: "u1",
      email: "a@b.com",
      full_name: "Alex",
      role: "rep",
      location_id: "loc-1",
      org_id: "org-1",
    },
  });
  assert.equal(plan.locked, true);
  assert.equal(plan.source, "dealership");
  assert.equal(plan.dealershipName, "Moses Auto");
  assert.equal(plan.tiers[0]?.rate, 0.2);
});

test("standalone users fall back to personal or default and stay editable", () => {
  const personal = [
    { min: 0, max: 5, rate: 0.22, label: "Fewer than 6 units" },
    { min: 6, max: Number.POSITIVE_INFINITY, rate: 0.3, label: "6+ units" },
  ];
  const withPersonal = resolvePayPlan({
    organization: null,
    profile: {
      id: "u2",
      email: "solo@b.com",
      full_name: "Sam",
      role: "rep",
      location_id: null,
      org_id: null,
    },
    personalTiers: personal,
  });
  assert.equal(withPersonal.locked, false);
  assert.equal(withPersonal.source, "personal");
  assert.equal(withPersonal.tiers[1]?.rate, 0.3);

  const defaults = resolvePayPlan({
    organization: null,
    profile: {
      id: "u3",
      email: "new@b.com",
      full_name: "New",
      role: "rep",
      location_id: null,
      org_id: null,
    },
  });
  assert.equal(defaults.source, "default");
  assert.equal(defaults.locked, false);
  assert.equal(defaults.tiers.length, COMMISSION_TIERS.length);
});

test("independent users stay unlocked even if a dealership org object is still present", () => {
  const organization = {
    id: "org-stale",
    name: "Stale Motors",
    join_code: "STALE",
    pay_tiers: COMMISSION_TIERS,
  } as OrganizationRecord;
  const plan = resolvePayPlan({
    organization,
    profile: {
      id: "u4",
      email: "free@b.com",
      full_name: "Free",
      role: "rep",
      location_id: null,
      org_id: null,
    },
  });
  assert.equal(plan.locked, false);
  assert.notEqual(plan.source, "dealership");
});

test("missing location_id alone keeps the pay plan unlocked", () => {
  const organization = {
    id: "org-1",
    name: "Moses Auto",
    join_code: "MOSES",
    pay_tiers: COMMISSION_TIERS,
  } as OrganizationRecord;
  const plan = resolvePayPlan({
    organization,
    profile: {
      id: "u5",
      email: "half@b.com",
      full_name: "Half",
      role: "rep",
      location_id: null,
      org_id: "org-1",
    },
  });
  assert.equal(plan.locked, false);
});
