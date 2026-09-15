"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";
import { bannerCopy, headerAlertCount } from "@/lib/notifications";
import { dismissNotification, useUserNotifications } from "@/lib/notification-store";

export function NotificationBell() {
  const { unreadCount } = useUserNotifications();
  const { pending } = useRepPendingPush();
  const count = headerAlertCount(unreadCount, pending);
  if (count === 0) return null;
  return (
    <span className="notification-bell" title={`${count} unread notification${count === 1 ? "" : "s"}`}>
      <Bell aria-hidden="true" />
      <span className="notification-bell-count">{count > 9 ? "9+" : count}</span>
      <span className="sr-only">
        {count} unread pay {count === 1 ? "notification" : "notifications"}
      </span>
    </span>
  );
}

export function PayPushNotice() {
  const { latestUnread } = useUserNotifications();
  const { pending } = useRepPendingPush();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!latestUnread) return null;
  if (pending && latestUnread.kind === "pay_sheet") return null;
  const copy = bannerCopy(latestUnread);

  async function handleDismiss() {
    setBusy(true);
    setError("");
    const message = await dismissNotification(latestUnread.id);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <section className="summary-card no-print pay-push-banner" role="status" aria-live="polite">
      <div className="pay-push-banner-head">
        <Bell aria-hidden="true" />
        <h2>{copy.title}</h2>
      </div>
      <p className="pay-push-banner-lead">{copy.body}</p>
      <div className="cloud-setup-actions">
        <Button type="button" disabled={busy} onClick={() => void handleDismiss()}>
          {busy ? "Saving…" : "Mark as Read"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void handleDismiss()}>
          Dismiss
        </Button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
