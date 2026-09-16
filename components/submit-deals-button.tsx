"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  buildEmployeePushPayload,
  isInFlightEmployeePush,
  PUSH_SUCCESS_MESSAGE,
  RECALL_CONFIRM_MESSAGE,
  RECALL_SUCCESS_MESSAGE,
} from "@/lib/employee-push";
import { DELETE_RESET_PUSH_LABEL, PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL, isResettablePushStatus } from "@/lib/approval-chain";
import { ADMIN_DRAFT_SAVED_TOAST, SAVE_ADMIN_DRAFT_LABEL } from "@/lib/admin-roster";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { canManageOrg } from "@/lib/roles";
import { flushTrackerSave, getTrackerSnapshot, retryCloudSync, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";
import { hasTrackerData } from "@/lib/storage";
import { showSyncToast } from "@/lib/sync-feedback";

export { ADMIN_DRAFT_SAVED_TOAST };
export function PushToEmployeeButton() {
  const org = useOrg();
  const { pushToEmployee, recallPush } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [state] = useTrackerStore();
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [message, setMessage] = useState("");
  const admin = canManageOrg(org.profile?.role);
  const draftCount = entryRepId
    ? org.draftsForEntry.filter((row) => row.rep_id === entryRepId).length
    : 0;
  const chain = org.approvalChains.find((row) => row.employeeId === entryRepId);
  const canReset = Boolean(
    entryRepId &&
      (isResettablePushStatus(chain?.status) ||
        org.allDeals.some((row) => row.rep_id === entryRepId && isInFlightEmployeePush(row.status))),
  );
  const canPush = Boolean(entryRepId) && (hasTrackerData(state) || draftCount > 0);

  if (!entryRepId || !admin) return null;

  async function handleSaveDraft() {
    if (!entryRepId) return;
    setSavingDraft(true);
    setMessage("");
    try {
      const status = await flushTrackerSave();
      if (status === "synced" || status === undefined) {
        showSyncToast(ADMIN_DRAFT_SAVED_TOAST);
        setMessage(ADMIN_DRAFT_SAVED_TOAST);
        return;
      }
      if (status === "signed-out") {
        const err = "Sign in again to save the admin draft.";
        console.error(err);
        window.alert(err);
        setMessage(err);
        return;
      }
      if (status === "error" || status === "retry") {
        const err = "Couldn't save draft to the admin ledger. Check the console for details.";
        console.error("Admin draft save failed with status:", status);
        window.alert(err);
        setMessage(err);
        return;
      }
      showSyncToast(ADMIN_DRAFT_SAVED_TOAST);
      setMessage(ADMIN_DRAFT_SAVED_TOAST);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handlePush() {
    if (!entryRepId) return;
    setBusy(true);
    setMessage("");
    try {
      const saveStatus = await flushTrackerSave();
      if (saveStatus === "error") {
        const err = "Couldn't save the admin draft before pushing. Check the console for details.";
        console.error(err);
        window.alert(err);
        setMessage(err);
        return;
      }
      if (saveStatus === "signed-out") {
        const err = "Sign in again to push this sheet.";
        console.error(err);
        window.alert(err);
        setMessage(err);
        return;
      }
      const payload = buildEmployeePushPayload(getTrackerSnapshot());
      const error = await pushToEmployee(entryRepId, payload);
      if (error) {
        console.error(error);
        window.alert(error);
        setMessage(error);
        return;
      }
      setMessage(PUSH_SUCCESS_MESSAGE);
      retryCloudSync();
    } finally {
      setBusy(false);
    }
  }

  async function handleRecall() {
    if (!entryRepId) return;
    if (!window.confirm(RECALL_CONFIRM_MESSAGE)) return;
    setBusy(true);
    setMessage("");
    const error = await recallPush(entryRepId);
    setBusy(false);
    if (error) {
      console.error(error);
      window.alert(error);
      setMessage(error);
      return;
    }
    setMessage(RECALL_SUCCESS_MESSAGE);
    retryCloudSync();
  }

  const working = busy || savingDraft;

  return (
    <div className="submit-deals no-print">
      <Button type="button" variant="outline" disabled={working} onClick={() => void handleSaveDraft()}>
        {savingDraft ? "Saving…" : SAVE_ADMIN_DRAFT_LABEL}
      </Button>
      <Button disabled={working || !canPush} onClick={() => void handlePush()}>
        {busy ? "Working…" : PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL}
      </Button>
      {canReset ? (
        <Button variant="destructive" disabled={working} onClick={() => void handleRecall()}>
          {DELETE_RESET_PUSH_LABEL}
        </Button>
      ) : null}
      {message ? (
        <p
          className={
            message === PUSH_SUCCESS_MESSAGE ||
            message === RECALL_SUCCESS_MESSAGE ||
            message === ADMIN_DRAFT_SAVED_TOAST
              ? "form-success"
              : "empty-note"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
