import assert from "node:assert/strict";
import test from "node:test";
import { displayName, hasDistinctEmail, metadataFullName, personOptionLabel } from "./names.ts";

test("displayName prefers a real full name over email", () => {
  assert.equal(displayName({ full_name: "Matthew DeMoss", email: "matthewdemoss@mosescars.com" }), "Matthew DeMoss");
  assert.equal(displayName({ full_name: "  ", email: "matthewdemoss@mosescars.com" }), "matthewdemoss@mosescars.com");
  assert.equal(displayName({ full_name: "matthewdemoss@mosescars.com", email: "matthewdemoss@mosescars.com" }), "matthewdemoss@mosescars.com");
});

test("email subtitle is shown only when it differs from the display name", () => {
  assert.equal(hasDistinctEmail({ full_name: "Matthew DeMoss", email: "matthewdemoss@mosescars.com" }), true);
  assert.equal(hasDistinctEmail({ full_name: "", email: "matthewdemoss@mosescars.com" }), false);
});

test("dropdown labels are full name then location", () => {
  assert.equal(
    personOptionLabel({ full_name: "Matthew DeMoss", email: "matt@example.com" }, "Honda / Volkswagen"),
    "Matthew DeMoss · Honda / Volkswagen",
  );
  assert.equal(personOptionLabel({ full_name: null, email: "matt@example.com" }), "matt@example.com");
});

test("signup metadata full_name is trimmed", () => {
  assert.equal(metadataFullName({ full_name: "  Matthew DeMoss  " }), "Matthew DeMoss");
  assert.equal(metadataFullName({ full_name: "   " }), null);
});
