import assert from "node:assert/strict";
import test from "node:test";
import { classifyCloudWriteError, shouldKeepLocalOverCloud } from "./cloud-sync.ts";

test("transient cloud write failures retry", () => {
  assert.equal(classifyCloudWriteError("Failed to fetch"), "retry");
  assert.equal(classifyCloudWriteError("JSON object requested, multiple (or no) rows returned"), "retry");
  assert.equal(classifyCloudWriteError("JWT expired"), "retry");
});

test("permanent cloud write failures do not retry forever", () => {
  assert.equal(
    classifyCloudWriteError("Could not find the table 'public.deal_records' in the schema cache"),
    "error",
  );
  assert.equal(classifyCloudWriteError("new row violates row-level security policy"), "error");
  assert.equal(classifyCloudWriteError("permission denied for table admin_employee_sheets"), "error");
  assert.equal(classifyCloudWriteError("Only an admin can update this ledger."), "error");
  assert.equal(classifyCloudWriteError("missing-admin-employee-sheets"), "error");
});

test("incoming admin pushes never replace a sales rep working sheet", () => {
  assert.equal(
    shouldKeepLocalOverCloud({ incomingPush: true, cloudHasData: false, localHasData: true }),
    true,
  );
  assert.equal(
    shouldKeepLocalOverCloud({ incomingPush: true, cloudHasData: true, localHasData: true }),
    false,
  );
  assert.equal(
    shouldKeepLocalOverCloud({ incomingPush: false, cloudHasData: true, localHasData: true }),
    false,
  );
  assert.equal(
    shouldKeepLocalOverCloud({ incomingPush: false, cloudHasData: false, localHasData: true }),
    true,
  );
});
