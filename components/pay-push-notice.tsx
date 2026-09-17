"use client";

import { Bell } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { bannerCopy, headerAlertCount } from "@/lib/notifications";
import { isSheetPushKind } from "@/lib/push-review";
import { requestOpenPushReview, scrollToPushReviewBanner } from "@/lib/push-review-ui";
import { dismissNotification, useUserNotifications } from "@/lib/notification-store";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";
import { managerActionItemCount } from "@/lib/approval-chain";
import { dealsForView, useOrg } from "@/lib/org-store";
import { latestRowByRep } from "@/lib/latest-submission";

export function NotificationBell() {
  const org = useOrg();
  const { unreadCount } = useUserNotifications();
  const { pending } = useRepPendingPush();
  const role = org.profile?.role;

  const managerCount = useMemo(() => {
    if (role !== "manager") return 0;
    const waitingIds = latestRowByRep(dealsForView(org, org.waitingOnRep)).map((row) => row.rep_id);
    return managerActionItemCount({
      chains: org.approvalChains,
      waitingOnRepIds: waitingIds,
      includeWaitingOnEmployee: true,
    });
  }, [role, org.approvalChains, org.waitingOnRep, org.people, org.profile, org.locationFilterId, org.allDeals]);

  const count = role === "manager" ? managerCount : headerAlertCount(unreadCount, pending);
  if (count === 0) return null;

  function handleClick() {
    requestOpenPushReview();
    scrollToPushReviewBanner();
  }

  return (
    <button
      type="button"
      className="notification-bell z-50"
      title={`${count} action item${count === 1 ? "" : "s"}`}
      aria-label={
        role === "manager"
          ? `Open manager queues. ${count} sheet${count === 1 ? "" : "s"} need attention`
          : `Open pushed pay review. ${count} unread pay ${count === 1 ? "notification" : "notifications"}`
      }
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
