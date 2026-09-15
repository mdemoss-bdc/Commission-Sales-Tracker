import assert from "node:assert/strict";
import test from "node:test";
import { firstUserRole, roleBadge, roleLabel, signedInRoleBadge, signupRole } from "./roles.ts";

test("first signed-up user is admin; later signups are reps", () => {
  assert.equal(firstUserRole(false), "admin");
  assert.equal(firstUserRole(true), "rep");
});

test("dealership-code signup with a store is always a sales rep", () => {
  assert.equal(signupRole(false, "store-1"), "rep");
  assert.equal(signupRole(true, "store-1"), "rep");
  assert.equal(signupRole(false, ""), "admin");
  assert.equal(signupRole(true, "  "), "rep");
});

test("header badges use Admin, Manager, and Sales Rep labels", () => {
  assert.equal(roleLabel("rep"), "Sales Rep");
  assert.equal(roleBadge("admin"), "[Admin]");
  assert.equal(roleBadge("manager"), "[Manager]");
  assert.equal(roleBadge("rep"), "[Sales Rep]");
});

test("signed-in header defaults to admin when no profile table exists yet", () => {
  assert.equal(signedInRoleBadge(null, true), "[Admin]");
  assert.equal(signedInRoleBadge(undefined, false), "[Sales Rep]");
  assert.equal(signedInRoleBadge("manager", true), "[Manager]");
});
