import { rowsForMonth } from "./deal-records.ts";
import { unreadNotifications, type UserNotification } from "./notifications.ts";
import { isPushedPayTrackerStatus } from "./pay-tracker-state.ts";
import { isPushedSheetStatus } from "./roles.ts";
import { reviewTargetsFromRows } from "./sheet-compare.ts";
import type { DealRow } from "./deal-records.ts";

export const AWAITING_EMPLOYEE_REVIEW_TITLE = "Awaiting Employee Review";
export const AWAITING_EMPLOYEE_REVIEW_MESSAGE =
  "Your manager has pushed an updated pay sheet.";
export const REVIEW_PUSHED_NUMBERS_LABEL = "Review Pushed Numbers & Sync";

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
