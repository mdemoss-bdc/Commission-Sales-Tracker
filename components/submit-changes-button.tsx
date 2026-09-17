"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  SUBMIT_CHANGES_TO_MANAGER_LABEL,
  SUBMITTED_TO_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_LABEL,
  isPayPeriodLockedForRep,
} from "@/lib/approval-chain";
import { isPaidAdminSheet, loadMyAdminSheetLockStatus } from "@/lib/admin-employee-sheets";
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
  const [ledgerLocked, setLedgerLocked] = useState(false);
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const dealLocked = (org.allDeals ?? []).some(
    (row) => row.rep_id === org.profile?.id && isPayPeriodLockedForRep(row.status),
  );

  useEffect(() => {
    if (org.profile?.role !== "rep") {
      setLedgerLocked(false);
      return;
    }
    let cancelled = false;
    void loadMyAdminSheetLockStatus(null).then((row) => {
      if (cancelled) return;
      setLedgerLocked(
        Boolean(row && (row.isPaid || isPaidAdminSheet(row.status, row.isPaid) || isPayPeriodLockedForRep(row.status))),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [org.profile?.role, org.profile?.id]);

  if (org.profile?.role !== "rep") return null;
  if (ledgerLocked || isPayPeriodLockedForRep(chain?.status) || dealLocked) return null;

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
