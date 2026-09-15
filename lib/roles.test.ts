import assert from "node:assert/strict";
import test from "node:test";
import {
  firstUserRole,
  isProtectedAdminEmail,
  resolvedProfileRole,
  roleBadge,
  roleLabel,
  roleUpdatedMessage,
  signedInRoleBadge,
  signupRole,
  canEditPersonRole,
} from "./roles.ts";

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

test("matthewdemoss@mosescars.com is always Admin from the profile email", () => {
  assert.equal(isProtectedAdminEmail("matthewdemoss@mosescars.com"), true);
  assert.equal(isProtectedAdminEmail("  MatthewDeMoss@MosesCars.com "), true);
  assert.equal(resolvedProfileRole("matthewdemoss@mosescars.com", "rep"), "admin");
  assert.equal(resolvedProfileRole("matthewdemoss@mosescars.com", null), "admin");
  assert.equal(resolvedProfileRole("rep@example.com", "manager"), "manager");
});

test("only another admin can change someone else's role", () => {
  const admin = {
    id: "admin-1",
    email: "matthewdemoss@mosescars.com",
    full_name: "Matthew DeMoss",
    role: "admin" as const,
    location_id: null,
  };
  const manager = { ...admin, id: "mgr-1", email: "mgr@example.com", role: "manager" as const };
  const rep = { ...admin, id: "rep-1", email: "rep@example.com", role: "rep" as const };
  assert.equal(canEditPersonRole(admin, manager), true);
  assert.equal(canEditPersonRole(admin, admin), false);
  assert.equal(canEditPersonRole(manager, rep), false);
  assert.equal(
    canEditPersonRole({ ...admin, id: "admin-2", email: "other-admin@example.com" }, admin),
    false,
  );
  assert.equal(roleUpdatedMessage("Jane Doe", "manager"), "Updated Jane Doe to Manager.");
});
