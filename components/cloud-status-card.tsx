"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-session";
import { SUPABASE_SETUP_SQL } from "@/lib/supabase-schema";
import { isSupabaseConfigured } from "@/lib/supabase";
import { retryCloudSync, useCloudStatus } from "@/lib/tracker-store";
import { useAuthSession } from "@/lib/use-auth-session";

export function CloudStatusCard() {
  const status = useCloudStatus();
  const { user } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isSupabaseConfigured() || !user) return null;

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  async function copySql() {
    await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (status === "offline") {
    return (
      <section id="account" className="summary-card no-print">
        <h2>Cloud save paused</h2>
        <p className="empty-note">
          Signed in as {user.email ?? "your account"}, but Supabase could not be reached. Deals still
          save in this browser. Retry when you are online.
        </p>
        <div className="cloud-setup-actions">
          <Button variant="outline" onClick={retryCloudSync}>
            Retry cloud save
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void handleSignOut()}>
            Sign Out
          </Button>
        </div>
      </section>
    );
  }

  if (status === "blocked") {
    return (
      <section id="account" className="summary-card no-print">
        <h2>Cloud save blocked</h2>
        <p className="empty-note">
          Signed in as {user.email ?? "your account"}, but Supabase refused the write. Confirm you
          are signed in, your profile exists, and deal rows use your user id.
        </p>
        <div className="cloud-setup-actions">
          <Button onClick={retryCloudSync}>Retry</Button>
          <Button variant="outline" disabled={busy} onClick={() => void handleSignOut()}>
            Sign Out
          </Button>
        </div>
      </section>
    );
  }

  if (status === "setup") {
    return (
      <section id="account" className="summary-card no-print">
        <h2>Finish Supabase setup</h2>
        <p className="empty-note">
          You are signed in as {user.email ?? "your account"}, but the locations, profile, or deal
          tables are missing. Paste <code>supabase/schema.sql</code> in the{" "}
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
          <Button variant="outline" disabled={busy} onClick={() => void handleSignOut()}>
            Sign Out
          </Button>
        </div>
      </section>
    );
  }

  if (status === "syncing") {
    return (
      <p className="cloud-status-note no-print">Saving to your account…</p>
    );
  }

  return (
    <p id="account" className="cloud-status-note no-print">
      Saved to your account ({user.email ?? user.id.slice(0, 8)}) and this browser.
    </p>
  );
}
