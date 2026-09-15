"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { DualSheetReview } from "@/components/dual-sheet-review";
import { Button } from "@/components/ui/button";
import { retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import { useOrgActions } from "@/lib/org-store";
import { findMonth, findSheet } from "@/lib/records";
import { REP_SHEET_REVIEW_MESSAGE } from "@/lib/notifications";
import { extrasFromSheet, hasActiveRepPush, type ReviewSheetTarget } from "@/lib/sheet-compare";
import { useRepPendingPush } from "@/lib/use-rep-pending-push";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function ManagerReviewHost() {
  const { resolveReview, acceptPushedSheet, flagReviewDispute } = useOrgActions();
  const pathname = usePathname();
  const router = useRouter();
  const [state] = useTrackerStore();
  const canPortal = useBrowserDocument();
  const { mine, targets, pending, classified } = useRepPendingPush();
  const [compareTarget, setCompareTarget] = useState<ReviewSheetTarget | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "dispute" | null>(null);
  const [error, setError] = useState("");

  const onMatchingSheet = targets.some((target) => pathname === `/m/${target.monthId}/s/${target.sheetId}`);
  const showBanner = Boolean(pending && !onMatchingSheet);
  const primary = targets[0] ?? null;
  const autoKey = classified.autoResolve.map((item) => item.id).sort().join(",");

  useEffect(() => {
    if (pending) return;
    setCompareTarget(null);
    setDisputeOpen(false);
  }, [pending]);

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

  useEffect(() => {
    if (classified.items.length > 0 || !autoKey) return;
    if (hasActiveRepPush(mine) && targets.length > 0) return;
    let cancelled = false;
    void resolveReview(classified.autoResolve).then((message) => {
      if (cancelled || message) return;
      retryCloudSync();
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [classified.items.length, autoKey, classified.autoResolve, mine, resolveReview, router, targets.length]);

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

  if (!showBanner) {
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
      <section className="summary-card review-banner pay-push-banner" role="status" aria-live="polite">
        <div className="pay-push-banner-head">
          <h2>Pay Sheet Updated</h2>
        </div>
        <p className="pay-push-banner-lead">{REP_SHEET_REVIEW_MESSAGE}</p>
        {primary ? (
          <p className="empty-note">
            {primary.label}
            {targets.length > 1 ? ` · ${targets.length} worksheets waiting` : ""}
          </p>
        ) : null}
        <div className="cloud-setup-actions">
          <Button
            type="button"
            disabled={!primary}
            onClick={() => {
              setError("");
              setCompareTarget(primary);
            }}
          >
            Review Pushed Sheet
          </Button>
          <Button type="button" variant="outline" disabled={!primary || Boolean(busy)} onClick={() => void handleAccept()}>
            {busy === "accept" ? "Saving…" : "Accept & Lock"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!primary || Boolean(busy)}
            onClick={() => {
              setError("");
              setDisputeOpen(true);
            }}
          >
            Flag Dispute / Leave Note
          </Button>
        </div>
        {error && !disputeOpen ? <p className="form-error">{error}</p> : null}
      </section>
      </div>
      {compareModal}
      {disputeModal}
    </>
  );
}
