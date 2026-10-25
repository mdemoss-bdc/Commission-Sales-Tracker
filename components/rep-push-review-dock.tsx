"use client";

import { useEffect, useMemo, useState } from "react";
import { DualSheetReview } from "@/components/dual-sheet-review";
import { PushReviewBanner, PushReviewSlot } from "@/components/push-review-banner";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { useUserNotifications } from "@/lib/notification-store";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";
import {
  dismissPushReviewSession,
  isPushReviewSessionDismissed,
  shouldDockMonthPushBanner,
} from "@/lib/push-review";
import { onOpenPushReview, scrollToPushReviewBanner } from "@/lib/push-review-ui";
import type { ReviewSheetTarget } from "@/lib/sheet-compare";
import { extrasFromSheet } from "@/lib/sheet-compare";
import { findMonth, findSheet } from "@/lib/records";
import { payPeriodKey, periodFromSheet } from "@/lib/pay-period";
import { useTrackerStore } from "@/lib/tracker-store";

/**
 * Rep-side push review dock (rebuild restoration).
 *
 * The detection layer (useRepPendingPush), the banner (PushReviewBanner) and
 * the side-by-side review (DualSheetReview) all existed, but nothing mounted
 * them: the bell fired an open event nobody listened to and scrolled to a
 * banner that was never rendered, so a rep could not see what the office
 * changed versus their own log. This dock wires them back together on the
 * month and sheet pages. Non-rep roles keep the previous empty slot.
 */
export function RepPushReviewDock({ monthId }: { monthId?: string }) {
  const org = useOrg();
  const { acceptPushedSheet } = useOrgActions();
  const { unread } = useUserNotifications();
  const { mine, targets, adminLedgerActive } = useRepPendingPush();
  const [state] = useTrackerStore();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const [error, setError] = useState("");
  const [sessionDismissed, setSessionDismissed] = useState(false);

  const role = org.profile?.role;
  const userId = org.profile?.id ?? "";
  const chain = org.approvalChains.find((row) => row.employeeId === userId);
  const effectiveMonthId = monthId ?? chain?.monthId ?? "";

  useEffect(() => {
    if (!userId || !effectiveMonthId) {
      setSessionDismissed(false);
      return;
    }
    setSessionDismissed(isPushReviewSessionDismissed(userId, effectiveMonthId));
  }, [userId, effectiveMonthId]);

  const docked =
    role === "rep" &&
    Boolean(effectiveMonthId) &&
    shouldDockMonthPushBanner({
      monthId: effectiveMonthId,
      role,
      unread,
      rows: mine,
      payTrackerStatus: chain?.status,
      payTrackerMonthId: chain?.monthId,
      adminLedgerActive,
      sessionDismissed,
    });

  const primary = useMemo<ReviewSheetTarget | null>(() => {
    // Prefer the actually-pushed workbook (the chain's admin baseline):
    // row-derived targets only exist when proposed deal rows were stamped,
    // which never happens for a period the rep has no rows in yet.
    const baseline = chain?.adminBaseline;
    if (baseline) {
      for (const month of baseline.months ?? []) {
        const sheet =
          month.sheets?.find((candidate) => (candidate.sales?.length ?? 0) > 0) ?? month.sheets?.[0];
        if (sheet) {
          return {
            monthId: month.id,
            sheetId: sheet.id,
            label: "Pushed pay sheet",
            year: month.year,
            month: month.month,
          };
        }
      }
    }
    const fromRows = targets.find((target) => target.monthId === effectiveMonthId) ?? targets[0];
    if (fromRows) return fromRows;
    if (!effectiveMonthId) return null;
    const month = findMonth(state, effectiveMonthId);
    const sheet = month?.sheets[0];
    if (!month || !sheet) return null;
    return {
      monthId: effectiveMonthId,
      sheetId: sheet.id,
      label: "Pushed pay sheet",
      year: month.year,
      month: month.month,
    };
  }, [chain?.adminBaseline, targets, effectiveMonthId, state]);

  useEffect(() => {
    if (!docked) return;
    return onOpenPushReview(() => {
      scrollToPushReviewBanner();
      if (primary) setReviewOpen(true);
    });
  }, [docked, primary]);

  if (role !== "rep") return <PushReviewSlot />;
  if (!docked) return <PushReviewSlot />;

  const month = primary ? findMonth(state, primary.monthId) : null;
  const sheet = month && primary ? findSheet(month, primary.sheetId) : null;
  // The rep's live sheet for the pushed period usually has a different id
  // than the office's sheet (their month record may be keyed by another
  // period), so fall back to matching by pay period.
  const liveSheet = (() => {
    if (sheet) return sheet;
    if (!primary?.year || !primary?.month) return null;
    const baselineSheet = (chain?.adminBaseline?.months ?? [])
      .flatMap((row) => row.sheets ?? [])
      .find((candidate) => candidate.id === primary.sheetId);
    if (!baselineSheet) return null;
    const key = payPeriodKey(primary.year, primary.month, baselineSheet.startDay >= 16 ? "part2" : "part1");
    for (const liveMonth of state.months ?? []) {
      for (const candidate of liveMonth.sheets ?? []) {
        if (periodFromSheet(candidate, liveMonth).key === key) return candidate;
      }
    }
    return null;
  })();

  async function handleAccept() {
    if (!primary) return;
    setBusy("accept");
    setError("");
    const message = await acceptPushedSheet(primary.monthId, primary.sheetId);
    setBusy(null);
    if (message) {
      setError(message);
      return;
    }
    setReviewOpen(false);
  }

  function handleDismiss() {
    if (!userId || !effectiveMonthId) return;
    dismissPushReviewSession(userId, effectiveMonthId);
    setSessionDismissed(true);
    setReviewOpen(false);
  }

  return (
    <>
      <PushReviewSlot />
      <PushReviewBanner
        primary={primary}
        extraCount={targets.length}
        busy={busy}
        error={error}
        onReview={() => {
          if (primary) setReviewOpen(true);
        }}
        onAccept={() => void handleAccept()}
        onDismiss={handleDismiss}
      />
      {reviewOpen && primary ? (
        <div
          className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Review pushed pay sheet"
          onClick={() => setReviewOpen(false)}
        >
          <div
            className="mx-auto max-w-5xl rounded-2xl bg-[var(--background)] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <DualSheetReview
              monthId={primary.monthId}
              sheetId={primary.sheetId}
              year={primary.year ?? month?.year ?? new Date().getFullYear()}
              month={primary.month ?? month?.month ?? new Date().getMonth() + 1}
              liveSales={liveSheet?.sales ?? []}
              liveExtras={extrasFromSheet(liveSheet)}
              vehicleTypes={state.vehicleTypes ?? []}
              onAccepted={() => setReviewOpen(false)}
              onClose={() => setReviewOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
