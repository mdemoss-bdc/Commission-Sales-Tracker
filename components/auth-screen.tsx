"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandHomeLink } from "@/components/brand-home-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sendPasswordResetEmail,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth-session";
import { ensureOwnProfile, listSignupLocations, updateOwnFullName, updateOwnLocationId } from "@/lib/org";
import { canSubmitSignup } from "@/lib/signup";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { LocationRecord } from "@/lib/roles";

type AuthMode = "signin" | "signup" | "forgot";

export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [fullName, setFullName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [locationsReady, setLocationsReady] = useState(false);
  const [locationsError, setLocationsError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();
  const signupReady = canSubmitSignup(fullName, locationId);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      const stores = await listSignupLocations();
      if (cancelled) return;
      setLocations(stores);
      setLocationsReady(true);
      setLocationsError(stores.length === 0 ? "No stores are listed yet. Ask an admin to add dealerships, then refresh." : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError("");
    setMessage("");

    if (mode === "forgot") {
      const resetError = await sendPasswordResetEmail(email.trim());
      setBusy(false);
      if (resetError) {
        setError(resetError);
        return;
      }
      setMessage("If that email has an account, a reset link is on the way.");
      return;
    }

    if (mode === "signup" && !signupReady) {
      setBusy(false);
      setError("Enter your full name and select a dealership store.");
      return;
    }

    const result =
      mode === "signin"
        ? await signInWithPassword(email.trim(), password)
        : await signUpWithPassword(email.trim(), password, fullName.trim(), locationId.trim());
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
    if (mode === "signup") {
      if (fullName.trim()) await updateOwnFullName(fullName.trim());
      if (locationId.trim()) await updateOwnLocationId(locationId.trim());
    }
    setPassword("");
    setBusy(false);
    router.replace("/");
  }

  return (
    <div className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-heading">
        <BrandHomeLink headingId="auth-heading" />
        <p className="auth-lead">
          {mode === "signin"
            ? "Sign in to open your worksheets, pack pay, and deal records."
            : mode === "forgot"
              ? "We’ll email a link so you can choose a new password."
              : "Create an account with your name and dealership store. New accounts start as sales reps."}
        </p>

        {!configured ? (
          <p className="form-error">
            Cloud sign-in is not configured. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> before using Pay Tracker.
          </p>
        ) : (
          <>
            {mode !== "forgot" ? (
              <div className="auth-toggle" role="tablist" aria-label="Account">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signin"}
                  className={mode === "signin" ? "active" : ""}
                  onClick={() => switchMode("signin")}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  className={mode === "signup" ? "active" : ""}
                  onClick={() => switchMode("signup")}
                >
                  Create Account
                </button>
              </div>
            ) : null}

            <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
              {mode === "signup" ? (
                <>
                  <label>
                    Full Name
                    <Input
                      type="text"
                      autoComplete="name"
                      required
                      minLength={2}
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="e.g. John Doe"
                    />
                  </label>
                  <label>
                    Store Location
                    <select
                      className="auth-select"
                      required
                      value={locationId}
                      disabled={!locationsReady || locations.length === 0}
                      onChange={(event) => setLocationId(event.target.value)}
                    >
                      <option value="">Select your dealership store...</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {locationsError ? <p className="form-error">{locationsError}</p> : null}
                </>
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
              {mode !== "forgot" ? (
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
              ) : null}
              {mode === "signin" ? (
                <button type="button" className="auth-text-link" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              ) : null}
              <Button
                type="submit"
                disabled={busy || (mode === "signup" && (!signupReady || locations.length === 0))}
              >
                {busy
                  ? "Please wait…"
                  : mode === "signin"
                    ? "Sign In"
                    : mode === "forgot"
                      ? "Send reset link"
                      : "Create Account"}
              </Button>
              {mode === "forgot" ? (
                <button type="button" className="auth-text-link" onClick={() => switchMode("signin")}>
                  Back to Sign In
                </button>
              ) : null}
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
        <BrandHomeLink />
        <p className="auth-lead">Loading your session…</p>
      </section>
    </div>
  );
}
