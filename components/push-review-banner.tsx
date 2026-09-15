"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACCEPT_APPLY_LABEL,
  AWAITING_EMPLOYEE_REVIEW_MESSAGE,
  AWAITING_EMPLOYEE_REVIEW_TITLE,
  REVIEW_PUSHED_NUMBERS_LABEL,
} from "@/lib/push-review";
import { PUSH_REVIEW_BANNER_ID } from "@/lib/push-review-ui";
import type { ReviewSheetTarget } from "@/lib/sheet-compare";

export function PushReviewSlot() {
  return <div id="push-review-slot" className="push-review-dock z-50" />;
}

export function PushReviewBanner({
  primary,
  extraCount = 0,
  busy = null,
  error = "",
  onReview,
  onAccept,
  onDismiss,
}: {
  primary: ReviewSheetTarget | null;
  extraCount?: number;
  busy?: "accept" | "dismiss" | null;
  error?: string;
  onReview: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      id={PUSH_REVIEW_BANNER_ID}
      className="summary-card review-banner pay-push-banner z-50"
      role="status"
      aria-live="polite"
    >
      <div className="pay-push-banner-head">
        <Bell aria-hidden="true" />
        <h2>{AWAITING_EMPLOYEE_REVIEW_TITLE}</h2>
      </div>
      <p className="pay-push-banner-lead">{AWAITING_EMPLOYEE_REVIEW_MESSAGE}</p>
      {primary ? (
        <p className="empty-note">
          {primary.label}
          {extraCount > 1 ? ` · ${extraCount} worksheets waiting` : ""}
        </p>
      ) : null}
      <div className="cloud-setup-actions">
        <Button type="button" onClick={onReview}>
          {REVIEW_PUSHED_NUMBERS_LABEL}
        </Button>
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onAccept}>
          {busy === "accept" ? "Saving…" : ACCEPT_APPLY_LABEL}
        </Button>
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onDismiss}>
          {busy === "dismiss" ? "Saving…" : "Dismiss"}
        </Button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
