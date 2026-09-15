import assert from "node:assert/strict";
import test from "node:test";
import { shouldRedirectHomeAfterSignIn } from "./auth-redirect.ts";

test("sign-in from a leftover sheet URL goes home", () => {
  assert.equal(shouldRedirectHomeAfterSignIn("/m/month-1/s/sheet-1"), true);
  assert.equal(shouldRedirectHomeAfterSignIn("/m/month-1"), true);
  assert.equal(shouldRedirectHomeAfterSignIn("/"), false);
  assert.equal(shouldRedirectHomeAfterSignIn("/reset-password"), false);
});
