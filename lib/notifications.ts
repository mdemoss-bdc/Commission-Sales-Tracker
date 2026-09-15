import { getSupabase } from "./supabase.ts";
import { isMissingRelation } from "./org.ts";

export const USER_NOTIFICATIONS_TABLE = "user_notifications";
export const USER_NOTIFICATION_SELECT = "id,user_id,location_id,title,message,kind,is_read,created_at";

export const PAY_PLAN_PUSH_TITLE = "New Pay Plan Pushed";
export const PAY_PLAN_PUSH_MESSAGE = "Admin has published an updated pay plan for your store.";
export const PAY_SHEET_PUSH_TITLE = "Pay Sheet Updated";
export const PAY_SHEET_LOCKED_MESSAGE =
  "Your pay sheet has been updated and locked by management for this pay period.";
export const REP_SHEET_REVIEW_MESSAGE = "Manager has pushed an updated pay sheet for your review.";

export type UserNotification = {
  id: string;
  user_id: string;
  location_id: string | null;
  title: string;
  message: string;
  kind: string;
  is_read: boolean;
  created_at: string;
};

export function parseUserNotification(row: unknown): UserNotification | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.user_id !== "string") return null;
  if (typeof record.title !== "string" || typeof record.message !== "string") return null;
  return {
    id: record.id,
    user_id: record.user_id,
    location_id: typeof record.location_id === "string" ? record.location_id : null,
    title: record.title,
    message: record.message,
    kind: typeof record.kind === "string" && record.kind.trim() ? record.kind : "pay_push",
    is_read: record.is_read === true,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
  };
}

export function headerAlertCount(unreadCount: number, pendingReview: boolean): number {
  if (unreadCount > 0) return unreadCount;
  return pendingReview ? 1 : 0;
}

export function unreadNotifications(rows: UserNotification[]): UserNotification[] {
  return rows
    .filter((row) => !row.is_read)
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function bannerCopy(row: UserNotification): { title: string; body: string } {
  if (row.kind === "pay_plan") {
    return { title: row.title || PAY_PLAN_PUSH_TITLE, body: row.message || PAY_PLAN_PUSH_MESSAGE };
  }
  return {
    title: row.title || PAY_SHEET_PUSH_TITLE,
    body: row.message?.trim() || REP_SHEET_REVIEW_MESSAGE,
  };
}

export async function notifyRepsOnPayPush(input: {
  locationId?: string | null;
  title: string;
  message: string;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("notify_reps_on_pay_push", {
    p_location_id: input.locationId || null,
    p_title: input.title,
    p_message: input.message,
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    console.warn("notify_reps_on_pay_push is missing. Re-run supabase/schema.sql.");
    return null;
  }
  console.error("notify_reps_on_pay_push failed:", error.message);
  return null;
}

export async function notifyRepOnSheetPush(input: {
  userId: string;
  locationId?: string | null;
  title?: string;
  message?: string;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const title = input.title || PAY_SHEET_PUSH_TITLE;
  const message = input.message || REP_SHEET_REVIEW_MESSAGE;
  const rpc = await supabase.rpc("notify_rep_on_sheet_push", {
    p_user_id: input.userId,
    p_location_id: input.locationId || null,
    p_title: title,
    p_message: message,
  });
  if (!rpc.error) return null;
  if (!isMissingRelation(rpc.error.message, rpc.error.code)) {
    console.error("notify_rep_on_sheet_push failed:", rpc.error.message);
  }
  const { error } = await supabase.from(USER_NOTIFICATIONS_TABLE).insert({
    user_id: input.userId,
    location_id: input.locationId || null,
    title,
    message,
    kind: "pay_sheet",
    is_read: false,
  });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    console.warn("user_notifications insert is missing. Re-run supabase/schema.sql.");
    return null;
  }
  console.error("user_notifications insert failed:", error.message);
  return null;
}

export async function loadUserNotifications(userId: string): Promise<UserNotification[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(USER_NOTIFICATIONS_TABLE)
    .select(USER_NOTIFICATION_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    if (!isMissingRelation(error.message, error.code)) {
      console.error("user_notifications select failed:", error.message);
    }
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map(parseUserNotification).filter((row): row is UserNotification => Boolean(row));
}

export async function markNotificationRead(id: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (!error) return null;
  if (isMissingRelation(error.message, error.code)) {
    const { error: updateError } = await supabase
      .from(USER_NOTIFICATIONS_TABLE)
      .update({ is_read: true })
      .eq("id", id);
    if (!updateError) return null;
    if (isMissingRelation(updateError.message, updateError.code)) return null;
    return updateError.message;
  }
  return error.message;
}

export function mergeNotification(
  rows: UserNotification[],
  next: UserNotification,
): UserNotification[] {
  const without = rows.filter((row) => row.id !== next.id);
  return [next, ...without].sort((left, right) => right.created_at.localeCompare(left.created_at));
}
