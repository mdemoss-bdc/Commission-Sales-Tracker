import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitNewDealership,
  canSubmitSignup,
  dealershipJoinCodeBanner,
  DEALERSHIP_CODE_COPIED_MESSAGE,
  generateDealershipJoinCode,
  isValidEmail,
  isValidOrgCode,
  joinedDealershipMessage,
  metadataLocationId,
  needsDealershipLink,
  normalizeEmail,
  normalizeOrgCode,
  parseJoinOrganizationResult,
  parseOrgCodeLookup,
} from "./signup.ts";

test("signup stays disabled until name, location, and org code are present", () => {
  assert.equal(canSubmitSignup("", "store-1", true), false);
  assert.equal(canSubmitSignup("M", "store-1", true), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "", true), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "store-1", false), false);
  assert.equal(canSubmitSignup("Matthew DeMoss", "store-1", true), true);
});

test("new dealership registration requires a group name and admin name", () => {
  assert.equal(canSubmitNewDealership("", "Jane Owner"), false);
  assert.equal(canSubmitNewDealership("Acme Automotive Group", "J"), false);
  assert.equal(canSubmitNewDealership("Acme Automotive Group", "Jane Owner"), true);
});

test("generated join codes are six uppercase alphanumeric characters", () => {
  let step = 0;
  const sequence = [0, 0.1, 0.25, 0.5, 0.75, 0.99];
  const code = generateDealershipJoinCode(() => sequence[step++] ?? 0);
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(dealershipJoinCodeBanner("7k9x2b"), "DEALERSHIP JOIN CODE: 7K9X2B");
  assert.equal(
    DEALERSHIP_CODE_COPIED_MESSAGE,
    "Dealership code copied! Share this with your managers and salespeople.",
  );
});

test("signup metadata location_id is a trimmed string", () => {
  assert.equal(metadataLocationId({ location_id: "  abc  " }), "abc");
  assert.equal(metadataLocationId({ location_id: "" }), null);
  assert.equal(metadataLocationId({ full_name: "Matthew" }), null);
});

test("join prompts hide once a location_id is assigned", () => {
  assert.equal(needsDealershipLink(null), true);
  assert.equal(needsDealershipLink({ org_id: null, location_id: null }), true);
  assert.equal(needsDealershipLink({ org_id: "org-1", location_id: null }), true);
  assert.equal(needsDealershipLink({ org_id: null, location_id: "loc-1" }), false);
  assert.equal(needsDealershipLink({ org_id: "org-1", location_id: "loc-1" }), false);
  assert.equal(joinedDealershipMessage("Moses Auto Group"), "Connected to dealership successfully!");
  assert.equal(
    parseJoinOrganizationResult([{ org_id: "org-1", org_name: "Moses Auto Group", location_id: "loc-1" }])
      ?.location_id,
    "loc-1",
  );
  assert.equal(parseJoinOrganizationResult({ org_name: "  Acme  " })?.org_name, "Acme");
  assert.equal(parseJoinOrganizationResult(null), null);
});

test("signup emails are trimmed, lowercased, and accept any TLD", () => {
  assert.equal(normalizeEmail("  Alex@MosesCars.ME  "), "alex@mosescars.me");
  assert.equal(isValidEmail("  Alex@MosesCars.ME  "), true);
  assert.equal(isValidEmail("rep@dealer.app"), true);
  assert.equal(isValidEmail("gm@group.co"), true);
  assert.equal(isValidEmail("owner@store.io"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("missing-tld@dealer"), false);
  assert.equal(isValidEmail("spaces emma@dealer.com"), false);
});

test("org join codes are trimmed and uppercased", () => {
  assert.equal(normalizeOrgCode("  moses "), "MOSES");
  assert.equal(normalizeOrgCode("7k9x2b"), "7K9X2B");
  assert.equal(isValidOrgCode("7k9x2b"), true);
  assert.equal(isValidOrgCode("MOSES"), true);
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

test("parseOrgCodeLookup reads live row-list RPC results", () => {
  const parsed = parseOrgCodeLookup([
    {
      org_id: "org-1",
      org_name: "Moses Auto Group",
      location_id: "loc-1",
      location_name: "Cadillac",
    },
    {
      org_id: "org-1",
      org_name: "Moses Auto Group",
      location_id: "loc-2",
      location_name: "Nissan",
    },
  ]);
  assert.equal(parsed?.org_name, "Moses Auto Group");
  assert.equal(parsed?.stores.length, 2);
  assert.equal(parsed?.stores[0]?.id, "loc-1");
  assert.equal(parsed?.stores[1]?.name, "Nissan");
  assert.equal(parseOrgCodeLookup([]), null);
});
