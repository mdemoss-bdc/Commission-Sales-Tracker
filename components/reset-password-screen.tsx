"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandHomeLink } from "@/components/brand-home-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSessionPassword } from "@/lib/auth-session";
import { useAuthSession } from "@/lib/use-auth-session";

export function ResetPasswordScreen() {
  const router = useRouter();
  const { user, passwordRecovery } = useAuthSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await updateSessionPassword(password);
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    router.replace("/");
  }

  const waiting = !user && !passwordRecovery;

  return (
    <div className="auth-screen">
      <section className="auth-card" aria-labelledby="reset-heading">
        <BrandHomeLink pageTitle="Choose a new password" headingId="reset-heading" />
        {waiting ? (
          <p className="auth-lead">
            Open the reset link from your email to continue. If this page opened on its own, go back to Sign In and
            tap Forgot password to send a new link.
          </p>
        ) : (
          <>
            <p className="auth-lead">
              Set a password of at least 6 characters. You will return to Pay Tracker after it is saved.
            </p>
            <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
              <label>
                New password
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm password
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Update password"}
              </Button>
            </form>
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>
  );
}
