"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { DualSheetReview } from "@/components/dual-sheet-review";
import { PushReviewBanner, PushReviewSlot } from "@/components/push-review-banner";
import { Button } from "@/components/ui/button";
import { clearIncomingPush, flushTrackerSave, retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { findMonth, findSheet } from "@/lib/records";
import { shouldDockHomePushBanner } from "@/lib/push-review";
import { onOpenPushReview, PUSH_REVIEW_SLOT_ID } from "@/lib/push-review-ui";
import { dismissSheetPushNotifications } from "@/lib/notification-store";
import { extrasFromSheet, applyManagerSheetToState, stagedSheetFor } from "@/lib/sheet-compare";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ManagerReviewHost() {
  const { acceptPushedSheet, flagReviewDispute } = useOrgActions();
  const org = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useTrackerStore();
  const canPortal = useBrowserDocument();
  const { mine, targets, pending, unreadPushes } = useRepPendingPush();
  const [compareOpen, setCompareOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "dismiss" | "dispute" | null>(null);
  const [error, setError] = useState("");
  const [bannerSlot, setBannerSlot] = useState<HTMLElement | null>(null);

  const primary = targets[0] ?? null;
  const showBanner = Boolean(
    shouldDockHomePushBanner({
      role: org.profile?.role,
      unread: unreadPushes,
      rows: mine,
    }) || compareOpen,
  );

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
  }, [canPortal, pathname, showBanner]);

  useEffect(() => {
    return onOpenPushReview(() => {
      if (!primary) return;
      setError("");
      setEditMode(false);
      setCompareOpen(true);
    });
  }, [primary]);

  useEffect(() => {
    if (pending || compareOpen) return;
    setDisputeOpen(false);
    setEditMode(false);
  }, [pending, compareOpen]);

  useEffect(() => {
    if (!compareOpen && !disputeOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCompareOpen(false);
      setEditMode(false);
      if (!busy) setDisputeOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, compareOpen, disputeOpen]);

  function handleReview() {
    if (!primary) return;
    setError("");
    setEditMode(false);
    setCompareOpen(true);
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
    setCompareOpen(false);
    setEditMode(false);
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
    setCompareOpen(false);
    setEditMode(false);
    await dismissSheetPushNotifications();
    retryCloudSync();
    router.refresh();
  }

  const liveMonth = primary ? findMonth(state, primary.monthId) : undefined;
  const liveSheet = primary && liveMonth ? findSheet(liveMonth, primary.sheetId) : undefined;

  const compareModal =
    compareOpen && primary && canPortal
      ? createPortal(
          <div
            className="account-modal-backdrop no-print"
            role="presentation"
            onClick={() => {
              setCompareOpen(false);
              setEditMode(false);
            }}
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
                  <p className="workbook-kicker">Pushed numbers review</p>
                  <h2 id="pushed-sheet-title">{primary.label}</h2>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCompareOpen(false);
                    setEditMode(false);
                  }}
                >
                  Close
                </Button>
              </div>
              <DualSheetReview
                monthId={primary.monthId}
                sheetId={primary.sheetId}
                year={primary.year ?? liveMonth?.year ?? 0}
                month={primary.month ?? liveMonth?.month ?? 1}
                liveSales={liveSheet?.sales ?? []}
                liveExtras={extrasFromSheet(liveSheet)}
                vehicleTypes={state.vehicleTypes ?? []}
                mode={editMode ? "edit" : "summary"}
                onEditAdjust={() => setEditMode(true)}
                onAccepted={() => {
                  setCompareOpen(false);
                  setEditMode(false);
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
      extraCount={targets.length}
      busy={busy === "accept" || busy === "dismiss" ? busy : null}
      error={error && !disputeOpen ? error : ""}
      onReview={handleReview}
      onAccept={() => void handleAccept()}
      onDismiss={() => void handleDismiss()}
    />
  ) : null;

  const portaledBanner = banner && canPortal && bannerSlot ? createPortal(banner, bannerSlot) : null;

  return (
    <>
      {portaledBanner}
      {compareModal}
      {disputeModal}
    </>
  );
}

export function HomePushReviewDock() {
  return <PushReviewSlot />;
}

export function MonthPushReviewDock({ monthId: _monthId }: { monthId?: string }) {
  return <PushReviewSlot />;
}
