"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, useEntryRepId } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";

export function PushToEmployeeButton() {
  const org = useOrg();
  const { pushToEmployee } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const draftCount = entryRepId
    ? org.draftsForEntry.filter((row) => row.rep_id === entryRepId).length
    : 0;

  if (!entryRepId) return null;

  async function handlePush() {
    if (!entryRepId) return;
    setBusy(true);
    setMessage("");
    const error = await pushToEmployee(entryRepId);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("Pushed to employee");
    retryCloudSync();
  }

  return (
    <div className="submit-deals no-print">
      <Button disabled={busy || draftCount === 0} onClick={() => void handlePush()}>
        Push to employee
      </Button>
      {message ? <p className="empty-note">{message}</p> : null}
    </div>
  );
}
