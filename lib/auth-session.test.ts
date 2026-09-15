import assert from "node:assert/strict";
import test from "node:test";
import { isMissingAuthSession } from "./auth-session.ts";

test("Auth session missing is treated as signed out, not a thrown overlay error", () => {
  assert.equal(isMissingAuthSession("Auth session missing!"), true);
  assert.equal(isMissingAuthSession(new Error("Auth session missing!")), true);
  assert.equal(isMissingAuthSession({ message: "Auth session missing!" }), true);
  assert.equal(isMissingAuthSession("JWT expired"), false);
  assert.equal(isMissingAuthSession(null), false);
});
