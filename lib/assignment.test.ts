import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentUpdatedMessage,
  locationIdForRepSave,
  resolvedAssignmentLocation,
  rooftopIdForDeal,
} from "./assignment.ts";

test("assignment toast names the person", () => {
  assert.equal(assignmentUpdatedMessage("Jane Owner"), "Updated assignment for Jane Owner.");
});

test("promoting to manager without a store is blocked unless a store filter is selected", () => {
  assert.equal(
    resolvedAssignmentLocation({
      currentLocationId: null,
      nextRole: "manager",
    }).error,
    "Select a location when assigning a Manager.",
  );
  assert.equal(
    resolvedAssignmentLocation({
      currentLocationId: null,
      storeFilterId: "loc-honda",
      nextRole: "manager",
    }).locationId,
    "loc-honda",
  );
  assert.equal(
    resolvedAssignmentLocation({
      currentLocationId: "loc-nissan",
      nextRole: "manager",
    }).locationId,
    "loc-nissan",
  );
  assert.equal(
    resolvedAssignmentLocation({
      currentLocationId: "loc-nissan",
      nextLocationId: "loc-honda",
      nextRole: "rep",
    }).locationId,
    "loc-honda",
  );
});

test("deal rooftop prefers the employee's assigned store over a stamped location", () => {
  const people = [
    { id: "rep-caddy", location_id: "loc-cadillac" },
    { id: "rep-honda", location_id: "loc-honda" },
  ];
  assert.equal(
    rooftopIdForDeal({ rep_id: "rep-caddy", location_id: "loc-honda" }, people),
    "loc-cadillac",
  );
  assert.equal(
    rooftopIdForDeal({ rep_id: "rep-missing", location_id: "loc-honda" }, people),
    "loc-honda",
  );
});

test("admin saves for another rep stamp that employee's rooftop, never the admin store", () => {
  assert.equal(
    locationIdForRepSave({
      existingDealLocation: "loc-admin",
      targetRepId: "rep-1",
      actorId: "admin-1",
      actorLocationId: "loc-admin",
      targetRepLocationId: "loc-cadillac",
    }),
    "loc-cadillac",
  );
  assert.equal(
    locationIdForRepSave({
      existingDealLocation: null,
      targetRepId: "rep-1",
      actorId: "admin-1",
      actorLocationId: "loc-admin",
      targetRepLocationId: "loc-cadillac",
    }),
    "loc-cadillac",
  );
  assert.equal(
    locationIdForRepSave({
      existingDealLocation: null,
      targetRepId: "rep-1",
      actorId: "admin-1",
      actorLocationId: "loc-admin",
      targetRepLocationId: null,
    }),
    null,
  );
});
