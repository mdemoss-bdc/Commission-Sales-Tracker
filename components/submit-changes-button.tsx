"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  SUBMIT_CHANGES_TO_MANAGER_LABEL,
  SUBMITTED_TO_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_LABEL,
} from "@/lib/approval-chain";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { showSyncToast } from "@/lib/sync-feedback";
import { flushTrackerSave, getTrackerSnapshot, retryCloudSync } from "@/lib/tracker-store";

export function SubmitChangesToManagerButton() {
  const org = useOrg();
  const { submitChangesToManager } = useOrgActions();
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (org.profile?.role !== "rep") return null;

  async function handleClick() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await flushTrackerSave();
      const message = await submitChangesToManager(getTrackerSnapshot());
      if (message) {
        console.error("Submit Changes to Manager failed:", message);
        setError(message);
        window.alert(message);
        showSyncToast(message);
        return;
      }
      setSubmitted(true);
      setSuccess(SUBMITTED_TO_MANAGER_BANNER);
      showSyncToast(SUBMITTED_TO_MANAGER_BANNER);
      retryCloudSync();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      console.error("Submit Changes to Manager failed:", cause);
      const fallback = text || "Could not submit changes to your manager.";
      setError(fallback);
      window.alert(fallback);
      showSyncToast(fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="submit-changes-to-manager no-print">
      <Button type="button" disabled={busy} onClick={() => void handleClick()}>
        {busy ? "Submitting…" : submitted ? SUBMITTED_TO_MANAGER_LABEL : SUBMIT_CHANGES_TO_MANAGER_LABEL}
      </Button>
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
