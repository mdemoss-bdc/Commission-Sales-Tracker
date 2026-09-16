import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPT_ADMIN_NUMBERS_LABEL,
  ACCEPT_LOCK_LABEL,
  CLOSE_DISMISS_LABEL,
  EDIT_SHEET_LABEL,
  EDITING_PUSHED_BANNER,
  SUBMIT_RECONCILED_SHEET_LABEL,
  isSheetPushKind,
  shouldAutoResolvePendingReview,
  shouldDockHomePushBanner,
  shouldDockMonthPushBanner,
  shouldMarkNotificationsReadOnMount,
  unreadSheetPushes,
} from "./push-review.ts";

const unreadPush = {
  id: "n1",
  user_id: "rep-1",
  location_id: null,
  title: "Pay Sheet Updated",
  message: "Manager has pushed an updated pay sheet for your review.",
  kind: "pay_push",
  is_read: false,
  created_at: "2026-09-15T12:00:00.000Z",
};

test("sheet push kinds include pay_push and pay_sheet", () => {
  assert.equal(isSheetPushKind("pay_push"), true);
  assert.equal(isSheetPushKind("pay_sheet"), true);
  assert.equal(isSheetPushKind("pay_plan"), false);
});

test("review modal action copy names lock, edit, and dismiss", () => {
  assert.equal(ACCEPT_LOCK_LABEL, "Accept");
  assert.equal(ACCEPT_ADMIN_NUMBERS_LABEL, "Accept Admin Numbers");
  assert.equal(SUBMIT_RECONCILED_SHEET_LABEL, "Submit Reconciled Sheet to Manager");
  assert.equal(EDIT_SHEET_LABEL, "Edit Sheet / Make Corrections");
  assert.equal(CLOSE_DISMISS_LABEL, "Close / Dismiss");
  assert.equal(EDITING_PUSHED_BANNER, "Editing pushed sheet — Submit Changes to Manager when ready.");
});

test("notifications are not marked read on mount and reviews are not auto-resolved", () => {
  assert.equal(shouldMarkNotificationsReadOnMount(), false);
  assert.equal(shouldAutoResolvePendingReview(), false);
});

test("unreadSheetPushes keeps unread pay_push rows", () => {
  const unread = unreadSheetPushes([
    unreadPush,
    { ...unreadPush, id: "n2", kind: "pay_plan" },
    { ...unreadPush, id: "n3", is_read: true },
  ]);
  assert.deepEqual(unread.map((row) => row.id), ["n1"]);
});

test("month page docks the amber banner for unread pay_push or awaiting_review status", () => {
  assert.equal(
    shouldDockMonthPushBanner({
      monthId: "m1",
      role: "rep",
      unread: [unreadPush],
      rows: [],
    }),
    true,
  );
  assert.equal(
    shouldDockMonthPushBanner({
      monthId: "m1",
      role: "rep",
      unread: [],
      rows: [
        {
          id: "push-1",
          rep_id: "rep-1",
          location_id: null,
          created_by: "mgr",
          status: "awaiting_review",
          staged_data: {
            kind: "sale",
            entityId: "d1",
            monthId: "m1",
            sheetId: "s1",
            year: 2026,
            month: 9,
            sale: {
              id: "d1",
              stockNumber: "H1",
              customerName: "Pat",
              vehicleType: "",
              dealType: "new",
              tradeIn: false,
              gross: 500,
              flat: 0,
              fi: 0,
              service: 0,
            },
          },
          live_data: {},
          rep_notes: null,
        },
      ],
    }),
    true,
  );
  assert.equal(
    shouldDockMonthPushBanner({
      monthId: "m1",
      role: "rep",
      unread: [],
      rows: [],
      payTrackerStatus: "pushed",
      payTrackerMonthId: "m1",
    }),
    true,
  );
  assert.equal(
    shouldDockMonthPushBanner({
      monthId: "m1",
      role: "manager",
      unread: [unreadPush],
      rows: [],
    }),
    false,
  );
});

test("home dashboard docks the amber banner for unread pay_push", () => {
  assert.equal(
    shouldDockHomePushBanner({
      role: "rep",
      unread: [unreadPush],
      rows: [],
    }),
    true,
  );
  assert.equal(
    shouldDockHomePushBanner({
      role: "rep",
      unread: [],
      rows: [],
      chainStatus: "rejected_by_manager",
    }),
    true,
  );
  assert.equal(
    shouldDockHomePushBanner({
      role: "rep",
      unread: [],
      rows: [],
      chainStatus: "admin_pushed",
    }),
    true,
  );
  assert.equal(
    shouldDockHomePushBanner({
      role: "manager",
      unread: [unreadPush],
      rows: [],
    }),
    false,
  );
});
