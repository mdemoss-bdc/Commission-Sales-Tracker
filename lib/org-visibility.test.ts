import assert from "node:assert/strict";
import test from "node:test";
import { entryRepsFor, visibleDeals, visiblePeople } from "./org-visibility.ts";
import type { UserProfile } from "./roles.ts";

function person(patch: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    email: `${patch.id}@dealer.test`,
    full_name: patch.full_name ?? patch.id,
    location_id: patch.location_id ?? null,
    ...patch,
  };
}

const cadillac = "loc-cadillac";
const toyota = "loc-toyota";

const admin = person({ id: "admin", role: "admin", location_id: null });
const cadillacManager = person({ id: "mgr-caddy", role: "manager", location_id: cadillac });
const toyotaManager = person({ id: "mgr-toyota", role: "manager", location_id: toyota });
const cadillacRep = person({ id: "rep-caddy", role: "rep", location_id: cadillac });
const toyotaRep = person({ id: "rep-toyota", role: "rep", location_id: toyota });
const unassignedRep = person({ id: "rep-none", role: "rep", location_id: null });
const people = [admin, cadillacManager, toyotaManager, cadillacRep, toyotaRep, unassignedRep];

test("managers only see people at their assigned store", () => {
  const visible = visiblePeople(cadillacManager, people).map((row) => row.id).sort();
  assert.deepEqual(visible, ["mgr-caddy", "rep-caddy"]);
  assert.equal(
    visiblePeople(toyotaManager, people).some((row) => row.id === "rep-caddy"),
    false,
  );
});

test("managers only see staged deals and pending approvals for their store", () => {
  const rows = [
    { id: "1", rep_id: cadillacRep.id, location_id: cadillac, status: "staged" },
    { id: "2", rep_id: toyotaRep.id, location_id: toyota, status: "pending_manager_approval" },
    { id: "3", rep_id: cadillacRep.id, location_id: null, status: "staged" },
  ];
  assert.deepEqual(
    visibleDeals(cadillacManager, rows).map((row) => row.id),
    ["1"],
  );
  assert.deepEqual(
    visibleDeals(toyotaManager, rows).map((row) => row.id),
    ["2"],
  );
});

test("employee entry for a manager is limited to reps at that store", () => {
  const reps = entryRepsFor(cadillacManager, people, null).map((row) => row.id);
  assert.deepEqual(reps, ["rep-caddy"]);
});

test("employee roster is sorted A–Z by full name", () => {
  const zane = person({ id: "rep-z", role: "rep", full_name: "Zane Ward", location_id: cadillac });
  const amy = person({ id: "rep-a", role: "rep", full_name: "Amy Cole", location_id: cadillac });
  const reps = entryRepsFor(admin, [...people, zane, amy], cadillac).map((row) => row.id);
  assert.deepEqual(reps, ["rep-a", "rep-caddy", "rep-z"]);
});

test("admins still see every person and deal", () => {
  assert.equal(visiblePeople(admin, people).length, people.length);
  assert.equal(
    visibleDeals(admin, [{ id: "x", rep_id: toyotaRep.id, location_id: toyota }]).length,
    1,
  );
});
