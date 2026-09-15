import assert from "node:assert/strict";
import test from "node:test";
import { isRepFinalized, managerSubmissionRows, managerSubmissionSummary } from "./manager-status.ts";
import type { UserProfile } from "./roles.ts";

function person(patch: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    email: `${patch.id}@dealer.test`,
    full_name: patch.full_name ?? patch.id,
    location_id: patch.location_id ?? null,
    roster_ready: false,
    ...patch,
  };
}

const honda = { id: "loc-honda", name: "Honda / Volkswagen" };
const nissan = { id: "loc-nissan", name: "Nissan" };

test("a rep is finalized only after pipeline rows are locked live", () => {
  const amy = person({ id: "amy", role: "rep" });
  assert.equal(isRepFinalized(amy, []), false);
  assert.equal(isRepFinalized(amy, [{ rep_id: "amy", status: "pending_manager_approval" }]), false);
  assert.equal(isRepFinalized(amy, [{ rep_id: "amy", status: "pending_rep_review" }]), false);
  assert.equal(
    isRepFinalized(amy, [
      { rep_id: "amy", status: "active" },
      { rep_id: "amy", status: "pending_manager_approval" },
    ]),
    false,
  );
  assert.equal(isRepFinalized(amy, [{ rep_id: "amy", status: "active" }]), true);
});

test("store rows are red until every rep is pushed live, then green", () => {
  const mgr = person({ id: "mgr", role: "manager", full_name: "Pat Manager", location_id: honda.id });
  const amy = person({ id: "amy", role: "rep", full_name: "Amy Cole", location_id: honda.id });
  const zane = person({ id: "zane", role: "rep", full_name: "Zane Ward", location_id: honda.id });
  const rows = managerSubmissionRows(
    [nissan, honda],
    [mgr, amy, zane],
    [
      { rep_id: "amy", location_id: honda.id, status: "active" },
      { rep_id: "zane", location_id: honda.id, status: "pending_manager_approval" },
    ],
  );
  assert.equal(rows[0]?.storeName, "Honda / Volkswagen");
  assert.equal(rows[0]?.complete, false);
  assert.equal(rows[0]?.pendingLabel, "1 of 2 reps pending submission");
  assert.equal(rows[0]?.managerLabel, "Pat Manager");
  assert.equal(rows[1]?.storeName, "Nissan");
  assert.equal(rows[1]?.managerLabel, "No manager assigned");

  const done = managerSubmissionRows(
    [honda],
    [mgr, amy, zane],
    [
      { rep_id: "amy", location_id: honda.id, status: "active" },
      { rep_id: "zane", location_id: honda.id, status: "approved" },
    ],
  );
  assert.equal(done[0]?.complete, true);
  assert.equal(done[0]?.pendingLabel, "All 2 reps submitted");
});

test("manager submission summary counts complete vs pending stores", () => {
  assert.deepEqual(
    managerSubmissionSummary([{ complete: true }, { complete: false }, { complete: false }]),
    { completeCount: 1, pendingCount: 2 },
  );
});
