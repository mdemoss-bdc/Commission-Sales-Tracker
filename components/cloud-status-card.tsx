"use client";

import { useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInWithPassword, signOut, signUpWithPassword } from "@/lib/auth-session";
import { SUPABASE_SETUP_SQL } from "@/lib/supabase-schema";
import { isSupabaseConfigured } from "@/lib/supabase";
import { retryCloudSync, useCloudStatus } from "@/lib/tracker-store";
import { useAuthSession } from "@/lib/use-auth-session";

export function CloudStatusCard() {
  const status = useCloudStatus();
  const { ready, user } = useAuthSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  if (!isSupabaseConfigured()) return null;

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const action = mode === "signin" ? signInWithPassword : signUpWithPassword;
    const result = await action(email.trim(), password);
    setBusy(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    if (result.status === "confirm-email") {
      setMessage("Check your email to confirm the account, then sign in.");
      return;
    }
    setPassword("");
  }

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

  if (!ready || status === "syncing") {
    return <p className="cloud-status-note no-print">Connecting to your account…</p>;
  }

  if (!user || status === "signed-out") {
    return (
      <section id="account" className="summary-card no-print">
        <h2>{mode === "signin" ? "Sign in to save in the cloud" : "Create your account"}</h2>
        <p className="empty-note">
          Each salesperson has a profile, a store, and deal records with staged and live data. Sign
        in so saves use your user id. The first account becomes the only admin.
        </p>
        <form className="auth-form" onSubmit={(event) => void handleAuth(event)}>
          <label>
            Email
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <Input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="cloud-setup-actions">
            <Button type="submit" disabled={busy}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setMessage("");
              }}
            >
              {mode === "signin" ? "Need an account?" : "Have an account?"}
            </Button>
          </div>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}
      </section>
    );
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
            Sign out
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
            Sign out
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
            Sign out
          </Button>
        </div>
      </section>
    );
  }

  return (
    <p id="account" className="cloud-status-note no-print">
      Saved to your account ({user.email ?? user.id.slice(0, 8)}) and this browser.
    </p>
  );
}
