"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  buildEmployeePushPayload,
  isAwaitingEmployeePush,
  PUSH_SUCCESS_MESSAGE,
  RECALL_CONFIRM_MESSAGE,
  RECALL_SUCCESS_MESSAGE,
} from "@/lib/employee-push";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { flushTrackerSave, getTrackerSnapshot, retryCloudSync, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";

export function PushToEmployeeButton() {
  const org = useOrg();
  const { pushToEmployee, recallPush } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [state] = useTrackerStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const draftCount = entryRepId
    ? org.draftsForEntry.filter((row) => row.rep_id === entryRepId).length
    : 0;
  const awaiting = Boolean(
    entryRepId &&
      org.allDeals.some((row) => row.rep_id === entryRepId && isAwaitingEmployeePush(row.status)),
  );
  const canPush = Boolean(entryRepId) && (draftCount > 0 || state.months.length > 0);

  if (!entryRepId) return null;

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
        {busy ? "Working…" : "Push to employee"}
      </Button>
      {awaiting ? (
        <Button variant="destructive" disabled={busy} onClick={() => void handleRecall()}>
          Cancel / Delete Push
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
