import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeOnboardingEmailText,
  employeeOnboardingSections,
  guideDealershipName,
  guideJoinCode,
} from "./employee-onboarding.ts";

test("guide copy uses the live dealership name and share code", () => {
  assert.equal(guideDealershipName(" Moses Auto "), "Moses Auto");
  assert.equal(guideJoinCode("7k9x2b"), "7K9X2B");
  assert.equal(guideDealershipName(""), "your dealership");
  assert.equal(guideJoinCode("  "), "[Dealership Share Code]");
});

test("onboarding sections cover join, store, deals, review, and print", () => {
  const titles = employeeOnboardingSections({ orgName: "Moses", joinCode: "7K9X2B" }).map(
    (section) => section.title,
  );
  assert.deepEqual(titles, [
    "Register and join the store",
    "Select your store location",
    "Log deals and track pay",
    "Review and approve manager pushes",
    "Print a clean turn-in worksheet",
  ]);
});

test("email text is plain text with the live join code", () => {
  const text = employeeOnboardingEmailText({ orgName: "Moses Auto Group", joinCode: "7k9x2b" });
  assert.match(text, /Moses Auto Group — Employee Quick-Start Guide/);
  assert.match(text, /Dealership share code: 7K9X2B/);
  assert.match(text, /Join Existing Team/);
  assert.match(text, /amber banner/);
  assert.match(text, /Accept & Lock \(Accept & Sync\)/);
  assert.match(text, /Print sheet/);
  assert.equal(text.includes("<"), false);
});
