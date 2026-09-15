import assert from "node:assert/strict";
import test from "node:test";
import {
  authCallbackKind,
  pathAfterAuthCallback,
  stripAuthCallbackLocation,
} from "./auth-callback.ts";

test("hash access_token from email confirmation is a session callback", () => {
  assert.equal(
    authCallbackKind("", "#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=signup"),
    "session",
  );
  assert.equal(pathAfterAuthCallback("session"), "/");
});

test("query code from email confirmation is a session callback", () => {
  assert.equal(authCallbackKind("?code=pkce-code", ""), "session");
  assert.equal(authCallbackKind("code=pkce-code", ""), "session");
});

test("recovery tokens stay on the reset-password path", () => {
  assert.equal(authCallbackKind("", "#access_token=abc&type=recovery"), "recovery");
  assert.equal(pathAfterAuthCallback("recovery"), "/reset-password");
});

test("plain pages are not auth callbacks", () => {
  assert.equal(authCallbackKind("", ""), "none");
  assert.equal(authCallbackKind("?store=honda", "#section"), "none");
  assert.equal(pathAfterAuthCallback("none"), null);
});

test("confirmation callbacks strip tokens and open the dashboard", () => {
  assert.deepEqual(
    stripAuthCallbackLocation("/signup", "?code=pkce-code", ""),
    { pathname: "/", search: "", hash: "" },
  );
  assert.deepEqual(
    stripAuthCallbackLocation("/", "", "#access_token=abc&type=signup"),
    { pathname: "/", search: "", hash: "" },
  );
});

test("recovery callbacks strip tokens without sending the user to the dashboard", () => {
  assert.deepEqual(
    stripAuthCallbackLocation("/", "", "#access_token=abc&type=recovery"),
    { pathname: "/reset-password", search: "", hash: "" },
  );
});
