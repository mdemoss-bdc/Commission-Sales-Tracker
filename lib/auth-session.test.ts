import assert from "node:assert/strict";
import test from "node:test";
import { isMissingAuthSession, mapAuthError } from "./auth-session.ts";

test("Auth session missing is treated as signed out, not a thrown overlay error", () => {
  assert.equal(isMissingAuthSession("Auth session missing!"), true);
  assert.equal(isMissingAuthSession(new Error("Auth session missing!")), true);
  assert.equal(isMissingAuthSession({ message: "Auth session missing!" }), true);
  assert.equal(isMissingAuthSession("JWT expired"), false);
  assert.equal(isMissingAuthSession(null), false);
});

test("signup email rate limits are not shown as invalid TLDs", () => {
  assert.equal(
    mapAuthError("email rate limit exceeded"),
    "Too many signup attempts. Wait a minute and try again.",
  );
  assert.equal(
    mapAuthError("Unable to validate email address: invalid"),
    "Enter a valid email address.",
  );
  assert.equal(mapAuthError("Database error saving new user"), "Database error saving new user");
});
