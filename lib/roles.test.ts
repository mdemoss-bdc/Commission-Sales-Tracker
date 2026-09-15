import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddCustomRole,
  canEditPersonRole,
  isJoinCodeSalesRepEmail,
  isProtectedAdminEmail,
  parsePersonRoleSelect,
  personRoleLabel,
  personRoleSelectValue,
  resolvedProfileRole,
  roleBadge,
  roleLabel,
  roleUpdatedMessage,
  signedInRoleBadge,
  signupRole,
  visibleRoleBadge,
  profileMatchesSession,
  isPushedSheetStatus,
} from "./roles.ts";

test("dealership join-code signup is always a sales rep", () => {
  assert.equal(signupRole(false, "store-1"), "rep");
  assert.equal(signupRole(true, "store-1"), "rep");
  assert.equal(signupRole(false, ""), "rep");
  assert.equal(signupRole(true, "  "), "rep");
  assert.equal(signupRole(), "rep");
});

test("header badges use Admin, Manager, and Sales Rep labels", () => {
  assert.equal(roleLabel("rep"), "Sales Rep");
  assert.equal(roleBadge("admin"), "[Admin]");
  assert.equal(roleBadge("manager"), "[Manager]");
  assert.equal(roleBadge("rep"), "[Sales Rep]");
});

test("signed-in header defaults to Sales Rep until the profile loads", () => {
  assert.equal(signedInRoleBadge(null, true), "[Sales Rep]");
  assert.equal(signedInRoleBadge(undefined, false), "[Sales Rep]");
  assert.equal(signedInRoleBadge("manager", true), "[Manager]");
});

test("visible role badge waits for the current user profile and never uses a prior session", () => {
  const admin = {
    id: "admin-1",
    role: "admin" as const,
    custom_role_name: null,
  };
  const rep = {
    id: "rep-1",
    role: "rep" as const,
    custom_role_name: null,
  };
  assert.equal(profileMatchesSession(admin, "admin-1"), true);
  assert.equal(profileMatchesSession(admin, "rep-1"), false);
  assert.equal(visibleRoleBadge(admin, "admin-1", true), null);
  assert.equal(visibleRoleBadge(admin, "rep-1", false), null);
  assert.equal(visibleRoleBadge(null, "admin-1", false), null);
  assert.equal(visibleRoleBadge(admin, "admin-1", false), "[Admin]");
  assert.equal(visibleRoleBadge(rep, "rep-1", false), "[Sales Rep]");
});

test("matthewdemoss@mosescars.com is always Admin from the profile email", () => {
  assert.equal(isProtectedAdminEmail("matthewdemoss@mosescars.com"), true);
  assert.equal(isProtectedAdminEmail("  MatthewDeMoss@MosesCars.com "), true);
  assert.equal(resolvedProfileRole("matthewdemoss@mosescars.com", "rep"), "admin");
  assert.equal(resolvedProfileRole("matthewdemoss@mosescars.com", null), "admin");
  assert.equal(resolvedProfileRole("rep@example.com", "manager"), "manager");
});

test("matthewdemoss@gmail.com is a sales rep, not a locked admin", () => {
  assert.equal(isProtectedAdminEmail("matthewdemoss@gmail.com"), false);
  assert.equal(isJoinCodeSalesRepEmail("matthewdemoss@gmail.com"), true);
  assert.equal(isJoinCodeSalesRepEmail("  MatthewDeMoss@gmail.com "), true);
  assert.equal(resolvedProfileRole("matthewdemoss@gmail.com", "rep"), "rep");
  assert.equal(resolvedProfileRole("matthewdemoss@gmail.com", null), "rep");
  assert.equal(resolvedProfileRole("matthewdemoss@gmail.com", "manager"), "manager");
});

test("only another admin can change someone else's role, including promoting to Admin", () => {
  const admin = {
    id: "admin-1",
    email: "other-admin@example.com",
    full_name: "Pat Admin",
    role: "admin" as const,
    location_id: null,
  };
  const owner = {
    ...admin,
    id: "owner-1",
    email: "matthewdemoss@mosescars.com",
    full_name: "Matthew DeMoss",
  };
  const gmail = {
    ...admin,
    id: "gmail-1",
    email: "matthewdemoss@gmail.com",
    role: "rep" as const,
    full_name: "Matthew Gmail",
  };
  const manager = { ...admin, id: "mgr-1", email: "mgr@example.com", role: "manager" as const };
  const rep = { ...admin, id: "rep-1", email: "rep@example.com", role: "rep" as const };
  assert.equal(canEditPersonRole(admin, manager), true);
  assert.equal(canEditPersonRole(admin, rep), true);
  assert.equal(canEditPersonRole(admin, gmail), true);
  assert.equal(canEditPersonRole(admin, admin), false);
  assert.equal(canEditPersonRole(manager, rep), false);
  assert.equal(canEditPersonRole(admin, owner), false);
  assert.equal(roleUpdatedMessage("Jane Doe", "admin"), "Updated Jane Doe to Admin.");
});

test("people role dropdown can select built-in and custom roles", () => {
  assert.deepEqual(parsePersonRoleSelect("admin"), { role: "admin", customRoleId: null });
  assert.deepEqual(parsePersonRoleSelect("manager"), { role: "manager", customRoleId: null });
  assert.deepEqual(parsePersonRoleSelect("rep"), { role: "rep", customRoleId: null });
  assert.deepEqual(parsePersonRoleSelect("custom:role-1"), { role: "rep", customRoleId: "role-1" });
  assert.equal(personRoleSelectValue({ role: "rep", custom_role_id: "role-1" }), "custom:role-1");
  assert.equal(personRoleSelectValue({ role: "admin", custom_role_id: null }), "admin");
  assert.equal(personRoleLabel({ role: "rep", custom_role_name: "BDC Rep" }), "BDC Rep");
  assert.equal(personRoleLabel({ role: "manager", custom_role_name: null }), "Manager");
});

test("custom role names reject blanks, built-ins, and duplicates", () => {
  assert.equal(canAddCustomRole("  ", []), "Enter a role name.");
  assert.equal(canAddCustomRole("Admin", []), "That name is already a built-in role.");
  assert.equal(canAddCustomRole("Sales Rep", []), "That name is already a built-in role.");
  assert.equal(canAddCustomRole("BDC Rep", [{ name: "bdc rep" }]), "That role already exists.");
  assert.equal(canAddCustomRole("Finance Manager", [{ name: "BDC Rep" }]), null);
});

test("pushed and awaiting_review both count as an incoming manager sheet", () => {
  assert.equal(isPushedSheetStatus("pushed"), true);
  assert.equal(isPushedSheetStatus("awaiting_review"), true);
  assert.equal(isPushedSheetStatus("pending_rep_review"), true);
  assert.equal(isPushedSheetStatus("active"), false);
});
