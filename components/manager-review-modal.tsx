"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { PushReviewSlot } from "@/components/push-review-banner";
import { useOrg } from "@/lib/org-store";
import {
  AUTHORIZED_BY_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_BANNER,
  clearReturnBannerDismiss,
  dismissReturnBanner,
  isManagerApprovedStatus,
  isRejectedByManager,
  isReturnBannerDismissed,
  isSubmittedToManagerStatus,
  sheetReturnedByManagerMessage,
} from "@/lib/approval-chain";
import { PUSH_REVIEW_SLOT_ID } from "@/lib/push-review-ui";
import { canReviewDeals } from "@/lib/roles";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Rep status dock — no DualSheetReview. Rejected / submitted / authorized banners only. */
export function ManagerReviewHost() {
  const org = useOrg();
  const canPortal = useBrowserDocument();
  const [bannerSlot, setBannerSlot] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const ownChain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const userId = org.profile?.id ?? null;
  const periodKey = ownChain?.monthId ?? null;
  const denyReason = ownChain?.denyReason ?? null;
  const isRep = org.profile?.role === "rep" && !canReviewDeals(org.profile?.role);
  const rejected = isRejectedByManager(ownChain?.status);
  const submitted = isSubmittedToManagerStatus(ownChain?.status);
  const authorized = isManagerApprovedStatus(ownChain?.status);
  const storageDismissed = isReturnBannerDismissed(userId, periodKey, denyReason);
  const hideRejected = dismissed || storageDismissed;
  const showRejected = Boolean(isRep && rejected && !hideRejected);
  const showOther = Boolean(isRep && !rejected && (submitted || authorized));
  const showBanner = showRejected || showOther;

  useEffect(() => {
    if (!canPortal) return;
    function findSlot() {
      setBannerSlot(document.getElementById(PUSH_REVIEW_SLOT_ID));
    }
    findSlot();
    const timer = window.setInterval(findSlot, 100);
    const stop = window.setTimeout(() => window.clearInterval(timer), 2500);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [canPortal, showBanner]);

  // Re-submit / leave rejected → clear dismiss so a later reject can surface again.
  useEffect(() => {
    if (!userId) return;
    if (!rejected) {
      clearReturnBannerDismiss(userId, periodKey);
      setDismissed(false);
    }
  }, [rejected, userId, periodKey]);

  // New rejection fingerprint (different reason) should show even if an old dismiss exists.
  useEffect(() => {
    if (!rejected || !userId) return;
    setDismissed(isReturnBannerDismissed(userId, periodKey, denyReason));
  }, [rejected, userId, periodKey, denyReason]);

  if (!showBanner || !canPortal || !bannerSlot) return null;

  if (showRejected) {
    const message = sheetReturnedByManagerMessage(denyReason);
    return createPortal(
      <section
        className="manager-return-banner mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800"
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
          <p className="m-0 text-sm font-medium leading-snug">{message}</p>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 hover:text-rose-900"
          onClick={() => {
            dismissReturnBanner(userId, periodKey, denyReason);
            setDismissed(true);
          }}
        >
          Dismiss
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </section>,
      bannerSlot,
    );
  }

  const message = authorized ? AUTHORIZED_BY_MANAGER_BANNER : SUBMITTED_TO_MANAGER_BANNER;
  return createPortal(
    <section className="summary-card review-banner pay-push-banner z-50" role="status" aria-live="polite">
      <p className="empty-note">{message}</p>
    </section>,
    bannerSlot,
  );
}

export function HomePushReviewDock() {
  return <PushReviewSlot />;
}

export function MonthPushReviewDock({ monthId: _monthId }: { monthId?: string }) {
  return <PushReviewSlot />;
}
