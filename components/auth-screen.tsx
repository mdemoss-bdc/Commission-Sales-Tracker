"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInWithPassword, signUpWithPassword } from "@/lib/auth-session";
import { ensureOwnProfile, updateOwnFullName } from "@/lib/org";
import { isSupabaseConfigured } from "@/lib/supabase";

type AuthMode = "signin" | "signup";

export function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError("");
    setMessage("");
    const result =
      mode === "signin"
        ? await signInWithPassword(email.trim(), password)
        : await signUpWithPassword(email.trim(), password, fullName.trim());
    if (result.status === "error") {
      setBusy(false);
      setError(result.message);
      return;
    }
    if (result.status === "confirm-email") {
      setBusy(false);
      setMessage("Check your email to confirm the account, then sign in.");
      setMode("signin");
      return;
    }
    await ensureOwnProfile();
    if (mode === "signup" && fullName.trim()) {
      await updateOwnFullName(fullName.trim());
    }
    setPassword("");
    setBusy(false);
  }

  return (
    <div className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-heading">
        <p className="workbook-kicker">Sales commission</p>
        <h1 id="auth-heading">Pay Tracker</h1>
        <p className="auth-lead">
          {mode === "signin"
            ? "Sign in to open your worksheets, pack pay, and deal records."
            : "Create an account. The first person to sign up becomes the admin; later accounts are sales reps."}
        </p>

        {!configured ? (
          <p className="form-error">
            Cloud sign-in is not configured. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> before using Pay Tracker.
          </p>
        ) : (
          <>
            <div className="auth-toggle" role="tablist" aria-label="Account">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={mode === "signin" ? "active" : ""}
                onClick={() => {
                  setMode("signin");
                  setError("");
                  setMessage("");
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setMessage("");
                }}
              >
                Create Account
              </button>
            </div>

            <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
              {mode === "signup" ? (
                <label>
                  Full Name
                  <Input
                    type="text"
                    autoComplete="name"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Matthew DeMoss"
                  />
                </label>
              ) : null}
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
              <Button type="submit" disabled={busy}>
                {busy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
              </Button>
            </form>
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

export function AuthLoadingScreen() {
  return (
    <div className="auth-screen">
      <section className="auth-card" aria-busy="true" aria-live="polite">
        <p className="workbook-kicker">Sales commission</p>
        <h1>Pay Tracker</h1>
        <p className="auth-lead">Loading your session…</p>
      </section>
    </div>
  );
}
