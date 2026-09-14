"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, useCloudStatus } from "@/lib/tracker-store";
import { SUPABASE_SETUP_SQL } from "@/lib/supabase-schema";

export function CloudStatusCard() {
  const status = useCloudStatus();
  const [copied, setCopied] = useState(false);

  if (status === "local" || status === "syncing" || status === "synced") {
    if (status === "synced") {
      return (
        <p className="cloud-status-note no-print">Saved to Supabase and this browser.</p>
      );
    }
    if (status === "syncing") {
      return <p className="cloud-status-note no-print">Connecting to Supabase…</p>;
    }
    return null;
  }

  if (status === "offline") {
    return (
      <section className="summary-card no-print">
        <h2>Cloud save paused</h2>
        <p className="empty-note">
          Could not reach Supabase. Deals still save in this browser. Retry when you are online.
        </p>
        <Button variant="outline" onClick={retryCloudSync}>
          Retry cloud save
        </Button>
      </section>
    );
  }

  async function copySql() {
    await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="summary-card no-print">
      <h2>Finish Supabase setup</h2>
      <p className="empty-note">
        The project keys are in place, but the pay tracker table is not. Paste this once in the{" "}
        <a
          href="https://supabase.com/dashboard/project/orcmzzgyljmtxaovyluy/sql/new"
          target="_blank"
          rel="noreferrer"
        >
          Supabase SQL editor
        </a>
        , run it, then tap Recheck.
      </p>
      <pre className="sql-block">{SUPABASE_SETUP_SQL}</pre>
      <div className="cloud-setup-actions">
        <Button variant="outline" onClick={copySql}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy SQL"}
        </Button>
        <Button onClick={retryCloudSync}>Recheck</Button>
      </div>
    </section>
  );
}
