"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setReviewMode, useReviewMode } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { payloadLabel, workingPayload } from "@/lib/deal-records";
import { displayName } from "@/lib/names";

export function ReviewSubmissions() {
  const org = useOrg();
  const { acceptAsIs, modifyAndSubmit } = useOrgActions();
  const reviewMode = useReviewMode();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const show = Boolean(org.profile && org.profile.role === "rep" && org.stagedForRep.length > 0);

  useEffect(() => {
    if (!show && reviewMode) setReviewMode(false);
  }, [show, reviewMode]);

  if (!show) return null;

  async function handleAccept() {
    setBusy(true);
    setMessage("");
    const error = await acceptAsIs();
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setReviewMode(false);
    retryCloudSync();
    setMessage("Accepted as-is. Those deals are now on your live tracker.");
  }

  async function handleModify() {
    if (!reviewMode) {
      setReviewMode(true);
      setMessage("Edit the staged deals below, then tap Modify & Submit so your manager can review the diff.");
      return;
    }
    setBusy(true);
    const error = await modifyAndSubmit();
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setReviewMode(false);
    retryCloudSync();
    setMessage("Sent to your manager as pending approval.");
  }

  return (
    <section className="summary-card review-banner no-print">
      <h2>Review manager submissions</h2>
      <p className="empty-note">
        Your manager sent {org.stagedForRep.length} staged record
        {org.stagedForRep.length === 1 ? "" : "s"}. Accept as-is to put them on your live tracker, or
        modify the numbers and submit them back for approval.
      </p>
      <ul className="org-list">
        {org.stagedForRep.map((row) => {
          const sender = org.people.find((person) => person.id === row.created_by);
          return (
            <li key={row.id}>
              {payloadLabel(workingPayload(row))}
              {sender ? ` · from ${displayName(sender)}` : ""}
            </li>
          );
        })}
      </ul>
      <div className="cloud-setup-actions">
        <Button disabled={busy} onClick={() => void handleAccept()}>
          Accept as-is
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void handleModify()}>
          {reviewMode ? "Modify & submit" : "Modify staged deals"}
        </Button>
      </div>
      {reviewMode ? (
        <p className="empty-note">
          You are editing the staged batch, not your live tracker. Submit when the numbers are right.
        </p>
      ) : null}
      {message ? (
        <p className={message.startsWith("Accepted") || message.startsWith("Sent") ? "form-success" : "form-error"}>
          {message}
        </p>
      ) : null}
    </section>
  );
}
