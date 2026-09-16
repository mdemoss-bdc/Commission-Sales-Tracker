import assert from "node:assert/strict";
import test from "node:test";
import {
  PAY_PLAN_PUSH_MESSAGE,
  PAY_PLAN_PUSH_TITLE,
  PAY_SHEET_LOCKED_MESSAGE,
  PAY_SHEET_PUSH_TITLE,
  REP_SHEET_REVIEW_MESSAGE,
  bannerCopy,
  headerAlertCount,
  mergeNotification,
  parseUserNotification,
  repSubmitToManagerMessage,
  unreadNotifications,
} from "./notifications.ts";
import { isMissingRelation } from "./org.ts";

test("parseUserNotification reads unread pay alerts", () => {
  const row = parseUserNotification({
    id: "n1",
    user_id: "rep-1",
    location_id: "loc-honda",
    title: PAY_PLAN_PUSH_TITLE,
    message: PAY_PLAN_PUSH_MESSAGE,
    kind: "pay_plan",
    is_read: false,
    created_at: "2026-09-15T12:00:00.000Z",
  });
  assert.equal(row?.title, PAY_PLAN_PUSH_TITLE);
  assert.equal(row?.is_read, false);
});

test("unreadNotifications returns newest first and skips read rows", () => {
  const unread = unreadNotifications([
    {
      id: "old",
      user_id: "rep-1",
      location_id: null,
      title: "Older",
      message: "Older body",
      kind: "pay_sheet",
      is_read: false,
      created_at: "2026-09-14T12:00:00.000Z",
    },
    {
      id: "read",
      user_id: "rep-1",
      location_id: null,
      title: "Read",
      message: "Read body",
      kind: "pay_sheet",
      is_read: true,
      created_at: "2026-09-16T12:00:00.000Z",
    },
    {
      id: "new",
      user_id: "rep-1",
      location_id: null,
      title: "Newer",
      message: "Newer body",
      kind: "pay_sheet",
      is_read: false,
      created_at: "2026-09-15T12:00:00.000Z",
    },
  ]);
  assert.deepEqual(unread.map((row) => row.id), ["new", "old"]);
});

test("sheet banners keep a custom message and fall back to the review copy", () => {
  const custom = bannerCopy({
    id: "n2",
    user_id: "rep-1",
    location_id: null,
    title: PAY_SHEET_PUSH_TITLE,
    message: PAY_SHEET_LOCKED_MESSAGE,
    kind: "pay_sheet",
    is_read: false,
    created_at: "2026-09-15T12:00:00.000Z",
  });
  assert.equal(custom.body, PAY_SHEET_LOCKED_MESSAGE);
  const fallback = bannerCopy({
    id: "n3",
    user_id: "rep-1",
    location_id: null,
    title: PAY_SHEET_PUSH_TITLE,
    message: "  ",
    kind: "pay_sheet",
    is_read: false,
    created_at: "2026-09-15T12:00:00.000Z",
  });
  assert.equal(fallback.body, REP_SHEET_REVIEW_MESSAGE);
});

test("headerAlertCount shows a pending-review badge when there are no unread rows", () => {
  assert.equal(headerAlertCount(0, false), 0);
  assert.equal(headerAlertCount(0, true), 1);
  assert.equal(headerAlertCount(3, true), 3);
});

test("mergeNotification replaces an existing row and keeps newest first", () => {
  const first = parseUserNotification({
    id: "n1",
    user_id: "rep-1",
    title: "A",
    message: "A",
    kind: "pay_sheet",
    is_read: false,
    created_at: "2026-09-15T10:00:00.000Z",
  });
  const updated = parseUserNotification({
    id: "n1",
    user_id: "rep-1",
    title: "A",
    message: "A",
    kind: "pay_sheet",
    is_read: true,
    created_at: "2026-09-15T10:00:00.000Z",
  });
  assert.ok(first && updated);
  const merged = mergeNotification([first], updated);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.is_read, true);
});

test("notify_reps_on_pay_push is treated as a known RPC in setup errors", () => {
  assert.equal(
    isMissingRelation("Could not find the function public.notify_reps_on_pay_push in the schema cache"),
    true,
  );
  assert.equal(
    isMissingRelation("Could not find the function public.notify_rep_on_sheet_push in the schema cache"),
    true,
  );
  assert.equal(
    isMissingRelation("Could not find the function public.notify_location_managers in the schema cache"),
    true,
  );
  assert.equal(isMissingRelation("Could not find the table 'public.user_notifications' in the schema cache"), true);
});

test("rep submit copy names the employee and pay difference", () => {
  assert.equal(
    repSubmitToManagerMessage("Jordan Lee", "+$125.50"),
    "Jordan Lee submitted worksheet changes for your review (+$125.50 difference).",
  );
});
