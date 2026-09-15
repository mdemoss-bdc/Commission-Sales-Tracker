"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invalidateOrgCache } from "@/lib/org-store";
import { refreshFromCloud } from "@/lib/tracker-store";
import { showSyncToast } from "@/lib/sync-feedback";

export function CheckForUpdatesButton({ monthId }: { monthId?: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    await invalidateOrgCache();
    await refreshFromCloud(monthId);
    setBusy(false);
    showSyncToast("Checked the server for pushed sheets.");
  }

  return (
    <Button type="button" variant="outline" disabled={busy} className="no-print" onClick={() => void handleClick()}>
      <RefreshCw data-icon="inline-start" />
      {busy ? "Checking…" : "Check for Updates"}
    </Button>
  );
}
