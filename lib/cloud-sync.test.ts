import assert from "node:assert/strict";
import test from "node:test";
import { classifyCloudWriteError } from "./cloud-sync.ts";

test("failed cloud writes retry instead of pausing sync", () => {
  assert.equal(classifyCloudWriteError("Failed to fetch"), "retry");
  assert.equal(classifyCloudWriteError("JSON object requested, multiple (or no) rows returned"), "retry");
  assert.equal(classifyCloudWriteError("Could not find the table 'public.deal_records' in the schema cache"), "retry");
  assert.equal(classifyCloudWriteError("JWT expired"), "retry");
});
