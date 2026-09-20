"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { PushReviewSlot } from "@/components/push-review-banner";
import { useOrg } from "@/lib/org-store";
import {
  AUTHORIZED_BY_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_BANNER,
  isManagerApprovedStatus,
  isRejectedByManager,
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

function managerReturnDismissKey(periodKey: string | null | undefined, reason: string | null | undefined): string {
  const period = (periodKey ?? "").trim() || "default";
  const fingerprint = (reason ?? "").trim() || "general";
  return `dismissed_manager_return_${period}_${fingerprint}`;
}

function readManagerReturnDismissed(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Rep status dock — no DualSheetReview. Rejected / submitted / authorized banners only. */
export function ManagerReviewHost() {
  const org = useOrg();
  const canPortal = useBrowserDocument();
  const [bannerSlot, setBannerSlot] = useState<HTMLElement | null>(null);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const ownChain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const isRep = org.profile?.role === "rep" && !canReviewDeals(org.profile?.role);
  const rejected = isRejectedByManager(ownChain?.status);
  const submitted = isSubmittedToManagerStatus(ownChain?.status);
  const authorized = isManagerApprovedStatus(ownChain?.status);
  const periodKey = ownChain?.monthId ?? null;
  const denyReason = ownChain?.denyReason ?? null;
  const dismissKey = managerReturnDismissKey(periodKey, denyReason);
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

  // Sync dismiss flag from localStorage for this rejection fingerprint.
  useEffect(() => {
    if (!rejected) {
      setIsBannerDismissed(false);
      return;
    }
    setIsBannerDismissed(readManagerReturnDismissed(dismissKey));
  }, [rejected, dismissKey]);

  if (!showBanner || !canPortal || !bannerSlot) return null;

  if (rejected) {
    if (isBannerDismissed || readManagerReturnDismissed(dismissKey)) return null;

    const message = sheetReturnedByManagerMessage(denyReason);
    return createPortal(
      <section
        className="summary-card review-banner pay-push-banner z-50 flex items-center justify-between gap-3"
        role="status"
        aria-live="polite"
      >
        <p className="form-error m-0 min-w-0 flex-1">{message}</p>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
          onClick={() => {
            setIsBannerDismissed(true);
            try {
              window.localStorage.setItem(dismissKey, "true");
            } catch {
              /* ignore quota / private mode */
            }
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
