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
import { useOrg, useOrgActions } from "@/lib/org-store";
import { canManageOrg } from "@/lib/roles";
import { flushTrackerSave, getTrackerSnapshot, retryCloudSync, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";
import { hasTrackerData } from "@/lib/storage";

export function PushToEmployeeButton() {
  const org = useOrg();
  const { pushToEmployee, recallPush } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [state] = useTrackerStore();
  const [busy, setBusy] = useState(false);
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

  async function handlePush() {
    if (!entryRepId) return;
    setBusy(true);
    setMessage("");
    await flushTrackerSave();
    const payload = buildEmployeePushPayload(getTrackerSnapshot());
    const error = await pushToEmployee(entryRepId, payload);
    setBusy(false);
    if (error) {
      console.error(error);
      window.alert(error);
      setMessage(error);
      return;
    }
    setMessage(PUSH_SUCCESS_MESSAGE);
    retryCloudSync();
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

  return (
    <div className="submit-deals no-print">
      <Button disabled={busy || !canPush} onClick={() => void handlePush()}>
        {busy ? "Working…" : PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL}
      </Button>
      {canReset ? (
        <Button variant="destructive" disabled={busy} onClick={() => void handleRecall()}>
          {DELETE_RESET_PUSH_LABEL}
        </Button>
      ) : null}
      {message ? (
        <p className={message === PUSH_SUCCESS_MESSAGE || message === RECALL_SUCCESS_MESSAGE ? "form-success" : "empty-note"}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
