"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { bannerCopy, headerAlertCount } from "@/lib/notifications";
import { isSheetPushKind } from "@/lib/push-review";
import { requestOpenPushReview, scrollToPushReviewBanner } from "@/lib/push-review-ui";
import { dismissNotification, useUserNotifications } from "@/lib/notification-store";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";

export function NotificationBell() {
  const { unreadCount } = useUserNotifications();
  const { pending } = useRepPendingPush();
  const count = headerAlertCount(unreadCount, pending);
  if (count === 0) return null;

  function handleClick() {
    requestOpenPushReview();
    scrollToPushReviewBanner();
  }

  return (
    <button
      type="button"
      className="notification-bell z-50"
      title={`${count} unread notification${count === 1 ? "" : "s"}`}
      aria-label={`Open pushed pay review. ${count} unread pay ${count === 1 ? "notification" : "notifications"}`}
      onClick={handleClick}
    >
      <Bell aria-hidden="true" />
      <span className="notification-bell-count">{count > 9 ? "9+" : count}</span>
    </button>
  );
}

export function PayPushNotice() {
  const { latestUnread } = useUserNotifications();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!latestUnread) return null;
  if (isSheetPushKind(latestUnread.kind)) return null;
  const copy = bannerCopy(latestUnread);

  async function handleDismiss() {
    setBusy(true);
    setError("");
    const message = await dismissNotification(latestUnread.id);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <section className="summary-card no-print pay-push-banner z-50" role="status" aria-live="polite">
      <div className="pay-push-banner-head">
        <Bell aria-hidden="true" />
        <h2>{copy.title}</h2>
      </div>
      <p className="pay-push-banner-lead">{copy.body}</p>
      <div className="cloud-setup-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void handleDismiss()}>
          {busy ? "Saving…" : "Dismiss"}
        </Button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
