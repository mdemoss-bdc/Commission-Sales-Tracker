import assert from "node:assert/strict";
import test from "node:test";
import { printSheetEmployee } from "./print-employee.ts";

const honda = { id: "loc-honda", name: "Honda / Volkswagen" };

test("print header prefers the active entry rep over the signed-in profile", () => {
  const info = printSheetEmployee({
    entryRep: {
      full_name: "Amy Cole",
      email: "amy@store.com",
      role: "rep",
      location_id: honda.id,
    },
    profile: {
      full_name: "Pat Admin",
      email: "pat@store.com",
      role: "admin",
      location_id: null,
    },
    locations: [honda],
  });
  assert.deepEqual(info, {
    name: "Amy Cole",
    subtitle: "Sales Consultant • Honda / Volkswagen",
  });
});

test("print header uses the signed-in profile when no entry rep is selected", () => {
  const info = printSheetEmployee({
    profile: {
      full_name: "Matthew DeMoss",
      email: "matthewdemoss@mosescars.com",
      role: "rep",
      location_id: honda.id,
    },
    session: { fullName: "Cached Name", email: "matthewdemoss@mosescars.com" },
    locations: [honda],
  });
  assert.deepEqual(info, {
    name: "Matthew DeMoss",
    subtitle: "Sales Consultant • Honda / Volkswagen",
  });
});

test("print header falls back to the session name and omits a missing store", () => {
  const info = printSheetEmployee({
    session: { fullName: "Jamie Rep", email: "jamie@store.com" },
    locations: [honda],
  });
  assert.deepEqual(info, {
    name: "Jamie Rep",
    subtitle: "Sales Consultant",
  });
});

test("print header labels managers with their role instead of Sales Consultant", () => {
  const info = printSheetEmployee({
    profile: {
      full_name: "Pat Manager",
      email: "pat@store.com",
      role: "manager",
      location_id: honda.id,
    },
    locations: [honda],
  });
  assert.deepEqual(info, {
    name: "Pat Manager",
    subtitle: "Manager • Honda / Volkswagen",
  });
});
