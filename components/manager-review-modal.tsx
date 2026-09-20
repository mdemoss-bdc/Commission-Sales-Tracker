"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PushReviewSlot } from "@/components/push-review-banner";
import { useOrg } from "@/lib/org-store";
import {
  AUTHORIZED_BY_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_BANNER,
  isManagerApprovedStatus,
  isRejectedByManager,
  isSubmittedToManagerStatus,
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
  const ownChain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const isRep = org.profile?.role === "rep" && !canReviewDeals(org.profile?.role);
  const rejected = isRejectedByManager(ownChain?.status);
  const submitted = isSubmittedToManagerStatus(ownChain?.status);
  const authorized = isManagerApprovedStatus(ownChain?.status);
  const showBanner = Boolean(isRep && (rejected || submitted || authorized));

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

  if (!showBanner || !canPortal || !bannerSlot) return null;

  const message = rejected
    ? ownChain?.denyReason
      ? `Manager rejected your last submit: ${ownChain.denyReason}`
      : "Manager rejected your last submit. Fix the sheet and re-submit."
    : authorized
      ? AUTHORIZED_BY_MANAGER_BANNER
      : SUBMITTED_TO_MANAGER_BANNER;

  return createPortal(
    <section className="summary-card review-banner pay-push-banner z-50" role="status" aria-live="polite">
      <p className={rejected ? "form-error" : "empty-note"}>{message}</p>
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
