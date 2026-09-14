import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSignup, metadataLocationId } from "./signup.ts";

test("signup stays disabled until name and location are both present", () => {
  assert.equal(canSubmitSignup("", "store-1"), false);
  assert.equal(canSubmitSignup("M", "store-1"), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", ""), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "   "), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "store-1"), true);
});

test("signup metadata location_id is a trimmed string", () => {
  assert.equal(metadataLocationId({ location_id: "  abc  " }), "abc");
  assert.equal(metadataLocationId({ location_id: "" }), null);
  assert.equal(metadataLocationId({ full_name: "Matthew" }), null);
});
