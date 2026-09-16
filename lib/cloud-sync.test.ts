import assert from "node:assert/strict";
import test from "node:test";
import { classifyCloudWriteError, shouldKeepLocalOverCloud } from "./cloud-sync.ts";

test("failed cloud writes retry instead of pausing sync", () => {
  assert.equal(classifyCloudWriteError("Failed to fetch"), "retry");
  assert.equal(classifyCloudWriteError("JSON object requested, multiple (or no) rows returned"), "retry");
  assert.equal(classifyCloudWriteError("Could not find the table 'public.deal_records' in the schema cache"), "retry");
  assert.equal(classifyCloudWriteError("JWT expired"), "retry");
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
