import { rowsForMonth } from "./deal-records.ts";
import { unreadNotifications, type UserNotification } from "./notifications.ts";
import { isPushedPayTrackerStatus } from "./pay-tracker-state.ts";
import { isPushedSheetStatus } from "./roles.ts";
import { isAwaitingRepAction, isPayPeriodLockedForRep } from "./approval-chain.ts";
import { managerSheetHasEdits, reviewTargetsFromRows } from "./sheet-compare.ts";
import type { DealRow } from "./deal-records.ts";
import type { PaySheet } from "./types.ts";
import type { AdminEmployeeSheet } from "./admin-employee-sheets.ts";
import { ADMIN_SHEET_DRAFT, isPaidAdminSheet } from "./admin-employee-sheets.ts";
import { sheetHasPayrollContent } from "./pay-period.ts";

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

const PUSH_REVIEW_DISMISS_PREFIX = "pay-tracker:push-review-dismissed:";

export function pushReviewDismissStorageKey(userId: string, periodKey: string): string {
  return `${PUSH_REVIEW_DISMISS_PREFIX}${userId}:${periodKey}`;
}

export function isPushReviewSessionDismissed(userId: string, periodKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(pushReviewDismissStorageKey(userId, periodKey)) === "1";
  } catch {
    return false;
  }
}

export function dismissPushReviewSession(userId: string, periodKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(pushReviewDismissStorageKey(userId, periodKey), "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPushReviewSession(userId: string, periodKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(pushReviewDismissStorageKey(userId, periodKey));
    window.localStorage.removeItem(pushReviewDismissStorageKey(userId, periodKey));
    window.localStorage.removeItem(`pay-tracker:push-compare:${userId}:${periodKey}`);
    window.sessionStorage.removeItem(`pay-tracker:push-compare:${userId}:${periodKey}`);
  } catch {
    /* ignore */
  }
}

/** True when a sheet has deals / vacation / bonuses worth reviewing. */
export function hasMeaningfulPushSheet(sheet: PaySheet | null | undefined): boolean {
  return managerSheetHasEdits(sheet) || sheetHasPayrollContent(sheet);
}

/**
 * Admin ledger row is an active push the rep must review.
 * Missing row, draft, paid, or blank sheet_data after reset → not active.
 */
export function isAdminLedgerActivelyPushed(row: AdminEmployeeSheet | null | undefined): boolean {
  if (!row) return false;
  if (isPaidAdminSheet(row.status, row.isPaid)) return false;
  const status = (row.status ?? "").trim().toLowerCase();
  if (!status || status === ADMIN_SHEET_DRAFT || status === "draft") return false;
  if (status === "submitted_to_payroll" || status === "admin_final_approved" || status === "approved_final") {
    return false;
  }
  const state = row.state;
  const hasStateContent = Boolean(
    state?.months?.some((month) => month.sheets?.some((sheet) => hasMeaningfulPushSheet(sheet))),
  );
  if (hasStateContent) return status === "pushed" || status === "admin_pushed" || status === "awaiting_review";
  // Blank sheet_data after admin reset/delete — never treat as an active push.
  return false;
}

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
  adminLedgerActive?: boolean | null;
  sessionDismissed?: boolean;
}): boolean {
  if (input.role && input.role !== "rep") return false;
  if (input.sessionDismissed) return false;
  if (input.adminLedgerActive === false) return false;
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
  adminLedgerActive?: boolean | null;
  sessionDismissed?: boolean;
}): boolean {
  if (input.role && input.role !== "rep") return false;
  if (input.sessionDismissed) return false;
  if (isPayPeriodLockedForRep(input.chainStatus)) return false;
  // Clearinghouse: reps do not reconcile admin pushes in a split modal.
  // Only rejected sheets still need a rep action dock.
  return isAwaitingRepAction(input.chainStatus);
}
