import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSignup, metadataLocationId, normalizeOrgCode, parseOrgCodeLookup } from "./signup.ts";

test("signup stays disabled until name, location, and org code are present", () => {
  assert.equal(canSubmitSignup("", "store-1", true), false);
  assert.equal(canSubmitSignup("M", "store-1", true), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "", true), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "store-1", false), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "store-1", true), true);
});

test("signup metadata location_id is a trimmed string", () => {
  assert.equal(metadataLocationId({ location_id: "  abc  " }), "abc");
  assert.equal(metadataLocationId({ location_id: "" }), null);
  assert.equal(metadataLocationId({ full_name: "Matthew" }), null);
});

test("org join codes are trimmed and uppercased", () => {
  assert.equal(normalizeOrgCode("  moses "), "MOSES");
});

test("parseOrgCodeLookup reads org name and rooftops", () => {
  const parsed = parseOrgCodeLookup({
    org_id: "org-1",
    org_name: "Moses",
    join_code: "MOSES",
    stores: [
      { id: "loc-1", name: "Honda / Volkswagen" },
      { id: "loc-2", name: "Nissan" },
    ],
  });
  assert.equal(parsed?.org_name, "Moses");
  assert.equal(parsed?.stores.length, 2);
  assert.equal(parseOrgCodeLookup(null), null);
  assert.equal(parseOrgCodeLookup({ org_name: "Moses" }), null);
  assert.equal(
    parseOrgCodeLookup(JSON.stringify({ org_id: "org-1", org_name: "Moses", stores: [] }))?.org_name,
    "Moses",
  );
});
