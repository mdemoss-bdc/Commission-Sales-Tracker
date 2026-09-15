"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { DualSheetReview } from "@/components/dual-sheet-review";
import { PushReviewBanner } from "@/components/push-review-banner";
import { Button } from "@/components/ui/button";
import { clearIncomingPush, flushTrackerSave, retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { findMonth, findSheet } from "@/lib/records";
import { shouldDockMonthPushBanner } from "@/lib/push-review";
import { dismissSheetPushNotifications } from "@/lib/notification-store";
import { extrasFromSheet, applyManagerSheetToState, stagedSheetFor, type ReviewSheetTarget } from "@/lib/sheet-compare";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function PushReviewSession({
  docked,
  monthId,
}: {
  docked?: boolean;
  monthId?: string;
}) {
  const { acceptPushedSheet, flagReviewDispute } = useOrgActions();
  const org = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useTrackerStore();
  const canPortal = useBrowserDocument();
  const { mine, targets, pending, unreadPushes } = useRepPendingPush();
  const [compareTarget, setCompareTarget] = useState<ReviewSheetTarget | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "dismiss" | "dispute" | null>(null);
  const [error, setError] = useState("");

  const monthTargets = monthId ? targets.filter((target) => target.monthId === monthId) : targets;
  const primary = monthTargets[0] ?? targets[0] ?? null;
  const onMatchingSheet = targets.some((target) => pathname === `/m/${target.monthId}/s/${target.sheetId}`);
  const onMonthPage = /^\/m\/[^/]+$/.test(pathname);
  const dockMonth = Boolean(
    docked &&
      monthId &&
      shouldDockMonthPushBanner({
        monthId,
        role: org.profile?.role,
        unread: unreadPushes,
        rows: mine,
      }),
  );
  const showBanner = docked
    ? Boolean(dockMonth || reviewing || compareTarget)
    : Boolean(pending && !onMatchingSheet && !onMonthPage);

  useEffect(() => {
    if (pending || reviewing) return;
    setCompareTarget(null);
    setDisputeOpen(false);
  }, [pending, reviewing]);

  useEffect(() => {
    if (!compareTarget && !disputeOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCompareTarget(null);
      if (!busy) setDisputeOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, compareTarget, disputeOpen]);

  async function handleReview() {
    if (!primary) return;
    setError("");
    setReviewing(true);
    setCompareTarget(primary);
    await dismissSheetPushNotifications();
  }

  async function handleDismiss() {
    setBusy("dismiss");
    setError("");
    const message = await dismissSheetPushNotifications();
    setBusy(null);
    if (message) setError(message);
  }

  async function handleAccept() {
    if (!primary) return;
    setBusy("accept");
    setError("");
    const pushed = stagedSheetFor(mine, primary.monthId, primary.sheetId);
    clearIncomingPush();
    if (pushed) {
      setState((current) =>
        applyManagerSheetToState(current, primary.monthId, primary.sheetId, pushed, {
          year: primary.year,
          month: primary.month,
        }),
      );
    }
    const message = await acceptPushedSheet(primary.monthId, primary.sheetId);
    await flushTrackerSave();
    setBusy(null);
    if (message) {
      setError(message);
      return;
    }
    setReviewing(false);
    setCompareTarget(null);
    retryCloudSync();
    router.refresh();
  }

  async function handleDispute() {
    if (!primary) return;
    setBusy("dispute");
    setError("");
    const message = await flagReviewDispute(disputeNote, primary.monthId, primary.sheetId);
    setBusy(null);
    if (message) {
      setError(message);
      return;
    }
    setDisputeOpen(false);
    setDisputeNote("");
    setReviewing(false);
    await dismissSheetPushNotifications();
    retryCloudSync();
    router.refresh();
  }

  const liveMonth = compareTarget ? findMonth(state, compareTarget.monthId) : undefined;
  const liveSheet = compareTarget && liveMonth ? findSheet(liveMonth, compareTarget.sheetId) : undefined;

  const compareModal =
    compareTarget && canPortal
      ? createPortal(
          <div
            className="account-modal-backdrop no-print"
            role="presentation"
            onClick={() => setCompareTarget(null)}
          >
            <div
              className="account-modal pushed-sheet-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pushed-sheet-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="account-modal-head">
                <div>
                  <p className="workbook-kicker">Pushed sheet review</p>
                  <h2 id="pushed-sheet-title">{compareTarget.label}</h2>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setCompareTarget(null)}>
                  Close
                </Button>
              </div>
              <DualSheetReview
                monthId={compareTarget.monthId}
                sheetId={compareTarget.sheetId}
                year={compareTarget.year ?? liveMonth?.year ?? 0}
                month={compareTarget.month ?? liveMonth?.month ?? 1}
                liveSales={liveSheet?.sales ?? []}
                liveExtras={extrasFromSheet(liveSheet)}
                vehicleTypes={state.vehicleTypes ?? []}
                onAccepted={() => {
                  setReviewing(false);
                  setCompareTarget(null);
                }}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  const disputeModal =
    disputeOpen && canPortal
      ? createPortal(
          <div
            className="account-modal-backdrop no-print"
            role="presentation"
            onClick={() => (busy ? undefined : setDisputeOpen(false))}
          >
            <div
              className="account-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dispute-note-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="account-modal-head">
                <div>
                  <p className="workbook-kicker">Employee review</p>
                  <h2 id="dispute-note-title">Flag Dispute / Leave Note</h2>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => setDisputeOpen(false)}>
                  Close
                </Button>
              </div>
              <p className="empty-note">
                Keep your current worksheet values and send a note to your manager. They will see the dispute on the
                pending approval queue.
              </p>
              <label className="auth-lead" htmlFor="dispute-note">
                Note
              </label>
              <textarea
                id="dispute-note"
                value={disputeNote}
                onChange={(event) => setDisputeNote(event.target.value)}
                rows={5}
                placeholder="What should your manager review?"
              />
              {error ? <p className="form-error">{error}</p> : null}
              <div className="cloud-setup-actions">
                <Button type="button" disabled={busy === "dispute"} onClick={() => void handleDispute()}>
                  {busy === "dispute" ? "Sending…" : "Send dispute"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const banner = showBanner ? (
    <PushReviewBanner
      primary={primary}
      extraCount={monthId ? monthTargets.length : targets.length}
      busy={busy === "accept" || busy === "dismiss" ? busy : null}
      error={error && !disputeOpen ? error : ""}
      onReview={() => void handleReview()}
      onAccept={() => void handleAccept()}
      onDismiss={() => void handleDismiss()}
    />
  ) : null;

  if (docked) {
    return (
      <>
        {banner}
        {compareModal}
        {disputeModal}
      </>
    );
  }

  if (!banner) {
    return (
      <>
        {compareModal}
        {disputeModal}
      </>
    );
  }

  return (
    <>
      <div className="workbook no-print" data-review-host="true">
        {banner}
      </div>
      {compareModal}
      {disputeModal}
    </>
  );
}

export function ManagerReviewHost() {
  return <PushReviewSession />;
}

export function MonthPushReviewDock({ monthId }: { monthId: string }) {
  return <PushReviewSession docked monthId={monthId} />;
}
