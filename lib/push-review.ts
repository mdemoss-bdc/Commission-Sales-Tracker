import { rowsForMonth } from "./deal-records.ts";
import { unreadNotifications, type UserNotification } from "./notifications.ts";
import { isPushedPayTrackerStatus } from "./pay-tracker-state.ts";
import { isPushedSheetStatus } from "./roles.ts";
import { isAwaitingRepAction, isPayPeriodLockedForRep } from "./approval-chain.ts";
import { hasActiveRepPush, reviewTargetsFromRows } from "./sheet-compare.ts";
import type { DealRow } from "./deal-records.ts";

export const AWAITING_EMPLOYEE_REVIEW_TITLE = "Admin Pay Sheet Pushed";
export const AWAITING_EMPLOYEE_REVIEW_MESSAGE =
  "Your admin has sent a pay sheet to you and your manager. Accept it as-is or submit changes to your manager.";
export const REVIEW_PUSHED_NUMBERS_LABEL = "Review Pushed Numbers";
export const ACCEPT_LOCK_LABEL = "Accept";
export const ACCEPT_ADMIN_NUMBERS_LABEL = "Accept Admin Numbers";
export const SUBMIT_RECONCILED_SHEET_LABEL = "Submit Reconciled Sheet to Manager";
export const EDIT_SHEET_LABEL = "Edit Sheet / Make Corrections";
export const CLOSE_DISMISS_LABEL = "Close / Dismiss";
export const EDITING_PUSHED_BANNER = "Editing pushed sheet — Submit Changes to Manager when ready.";
export const PAID_PERIOD_LOCKED_BANNER =
  "PAID / DISBURSED: This pay period has been authorized and disbursed.";
export const ACCEPT_APPLY_LABEL = ACCEPT_LOCK_LABEL;
export const EDIT_ADJUST_LABEL = EDIT_SHEET_LABEL;

export function isSheetPushKind(kind: string | null | undefined): boolean {
  return kind === "pay_push" || kind === "pay_sheet";
}

export function unreadSheetPushes(rows: UserNotification[]): UserNotification[] {
  return unreadNotifications(rows).filter((row) => isSheetPushKind(row.kind));
}

export function shouldAutoResolvePendingReview(): boolean {
  return false;
}

export function shouldMarkNotificationsReadOnMount(): boolean {
  return false;
}

export function monthHasPushedReview(monthId: string, rows: DealRow[]): boolean {
  if (reviewTargetsFromRows(rows).some((target) => target.monthId === monthId)) return true;
  return rowsForMonth(rows, monthId).some((row) => isPushedSheetStatus(row.status));
}

export function shouldDockMonthPushBanner(input: {
  monthId: string;
  role?: string | null;
  unread: UserNotification[];
  rows: DealRow[];
  payTrackerStatus?: string | null;
  payTrackerMonthId?: string | null;
}): boolean {
  if (input.role && input.role !== "rep") return false;
  if (unreadSheetPushes(input.unread).length > 0) return true;
  if (isPushedPayTrackerStatus(input.payTrackerStatus)) {
    if (!input.payTrackerMonthId || input.payTrackerMonthId === input.monthId) return true;
  }
  return monthHasPushedReview(input.monthId, input.rows);
}

export function shouldDockHomePushBanner(input: {
  role?: string | null;
  unread: UserNotification[];
  rows: DealRow[];
  chainStatus?: string | null;
}): boolean {
  if (input.role && input.role !== "rep") return false;
  if (isPayPeriodLockedForRep(input.chainStatus)) return false;
  if (unreadSheetPushes(input.unread).length > 0) return true;
  if (isAwaitingRepAction(input.chainStatus) || isPushedPayTrackerStatus(input.chainStatus)) return true;
  return hasActiveRepPush(input.rows) || reviewTargetsFromRows(input.rows).length > 0;
}
