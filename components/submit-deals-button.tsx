"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrg, useOrgActions } from "@/lib/org-store";

export function SubmitDealsButton() {
  const org = useOrg();
  const { submitDeals } = useOrgActions();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!org.profile) return null;

  async function handleSubmit() {
    setBusy(true);
    setMessage("");
    const error = await submitDeals();
    setBusy(false);
    setMessage(error ? error : "Sent to your manager for approval.");
  }

  return (
    <div className="submit-deals no-print">
      <Button variant="outline" disabled={busy} onClick={() => void handleSubmit()}>
        Submit for manager approval
      </Button>
      {message ? <p className="empty-note">{message}</p> : null}
    </div>
  );
}
