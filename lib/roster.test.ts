import assert from "node:assert/strict";
import test from "node:test";
import { allRepsReady, rosterBadgeLabel, rosterStatus, sortByFullName, activeRosterLocationId } from "./roster.ts";
import type { UserProfile } from "./roles.ts";

function person(patch: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    email: `${patch.id}@dealer.test`,
    full_name: patch.full_name ?? patch.id,
    location_id: patch.location_id ?? "loc1",
    roster_ready: false,
    ...patch,
  };
}

test("sortByFullName orders A–Z by full name", () => {
  const sorted = sortByFullName([
    person({ id: "z", role: "rep", full_name: "Zane Ward" }),
    person({ id: "a", role: "rep", full_name: "Amy Cole" }),
    person({ id: "m", role: "rep", full_name: "morgan lee" }),
  ]);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["a", "m", "z"],
  );
});

test("pending_manager_approval and roster_ready both count as green", () => {
  const submitted = person({ id: "rep1", role: "rep" });
  const skipped = person({ id: "rep2", role: "rep", roster_ready: true });
  assert.equal(
    rosterStatus(submitted, [{ rep_id: "rep1", status: "pending_manager_approval" }]),
    "ready",
  );
  assert.equal(rosterStatus(skipped, []), "ready");
  assert.equal(
    rosterStatus(person({ id: "rep3", role: "rep" }), [{ rep_id: "rep3", status: "pending_rep_review" }]),
    "awaiting",
  );
  assert.equal(rosterBadgeLabel("awaiting"), "Awaiting Employee Review");
  assert.equal(rosterStatus(person({ id: "rep4", role: "rep" }), []), "idle");
});

test("amber is only pending_rep_review; leftover staged does not keep Awaiting Employee", () => {
  assert.equal(
    rosterStatus(person({ id: "rep5", role: "rep" }), [{ rep_id: "rep5", status: "staged" }]),
    "idle",
  );
  assert.equal(
    rosterStatus(person({ id: "rep6", role: "rep" }), [
      { rep_id: "rep6", status: "pending_manager_approval" },
      { rep_id: "rep6", status: "staged" },
    ]),
    "ready",
  );
  assert.equal(
    rosterStatus(person({ id: "rep7", role: "rep" }), [
      { rep_id: "rep7", status: "pending_manager_approval" },
      { rep_id: "rep7", status: "pending_rep_review" },
    ]),
    "awaiting",
  );
});

test("Push All stays locked until every visible rep is ready", () => {
  const amy = person({ id: "amy", role: "rep", full_name: "Amy" });
  const zane = person({ id: "zane", role: "rep", full_name: "Zane", roster_ready: true });
  assert.equal(allRepsReady([amy, zane], [{ rep_id: "amy", status: "staged" }]), false);
  assert.equal(
    allRepsReady([amy, zane], [{ rep_id: "amy", status: "pending_manager_approval" }]),
    true,
  );
  assert.equal(allRepsReady([], []), false);
});

test("managers use their store; admins use the selected store filter", () => {
  assert.equal(
    activeRosterLocationId(person({ id: "mgr", role: "manager", location_id: "loc-honda" }), null),
    "loc-honda",
  );
  assert.equal(
    activeRosterLocationId(person({ id: "admin", role: "admin", location_id: null }), "loc-honda"),
    "loc-honda",
  );
  assert.equal(activeRosterLocationId(person({ id: "admin", role: "admin", location_id: null }), null), null);
});
