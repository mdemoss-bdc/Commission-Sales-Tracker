"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandHomeLink } from "@/components/brand-home-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSessionUser,
  sendPasswordResetEmail,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth-session";
import { ensureOwnProfile, lookupStoresByOrgCode, registerNewDealershipAdmin, updateOwnFullName, updateOwnLocationId } from "@/lib/org";
import {
  canSubmitNewDealership,
  canSubmitSignup,
  DEALERSHIP_TAKEN_MESSAGE,
  normalizeOrgCode,
  type OrgCodeLookup,
} from "@/lib/signup";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { LocationRecord } from "@/lib/roles";

type AuthMode = "signin" | "signup" | "forgot";
type SignupKind = "join" | "register";

export function AuthScreen({ initialMode = "signin" }: { initialMode?: AuthMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [signupKind, setSignupKind] = useState<SignupKind>("join");
  const [fullName, setFullName] = useState("");
  const [dealershipName, setDealershipName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgLookup, setOrgLookup] = useState<OrgCodeLookup | null>(null);
  const [orgCodeError, setOrgCodeError] = useState("");
  const [orgCodeChecking, setOrgCodeChecking] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();
  const lookupTimer = useRef<number | null>(null);
  const lookupRequest = useRef(0);
  const connectedStores: LocationRecord[] = orgLookup?.stores ?? [];
  const orgConnected = Boolean(orgLookup);
  const joinReady = canSubmitSignup(fullName, locationId, orgConnected);
  const registerReady = canSubmitNewDealership(dealershipName, fullName);
  const signupReady = signupKind === "register" ? registerReady : joinReady;

  useEffect(() => {
    return () => {
      if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    };
  }, []);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
    setMessage("");
    setNameTaken(false);
  }

  function switchSignupKind(next: SignupKind) {
    setSignupKind(next);
    setError("");
    setMessage("");
    setNameTaken(false);
    setOrgLookup(null);
    setOrgCodeError("");
    setLocationId("");
    setOrgCode("");
  }

  async function resolveOrgCode(raw: string) {
    const cleaned = normalizeOrgCode(raw);
    if (!cleaned) {
      setOrgLookup(null);
      setOrgCodeError("");
      setLocationId("");
      setOrgCodeChecking(false);
      return;
    }
    const requestId = ++lookupRequest.current;
    setOrgCodeChecking(true);
    const result = await lookupStoresByOrgCode(cleaned);
    if (requestId !== lookupRequest.current) return;
    setOrgCodeChecking(false);
    if (!result) {
      setOrgLookup(null);
      setLocationId("");
      setOrgCodeError("Invalid dealership code.");
      return;
    }
    setOrgLookup(result);
    setOrgCodeError("");
    setLocationId((current) => (result.stores.some((store) => store.id === current) ? current : ""));
  }

  function scheduleOrgLookup(raw: string) {
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    lookupTimer.current = window.setTimeout(() => {
      void resolveOrgCode(raw);
    }, 400);
  }

  async function handleRegisterDealership() {
    if (!registerReady) {
      setError("Enter a dealership name and your full name.");
      return false;
    }
    if (!getSessionUser()) {
      const result = await signUpWithPassword(email.trim(), password, fullName.trim(), null, "new_dealership");
      if (result.status === "error") {
        setError(result.message);
        return false;
      }
      if (result.status === "confirm-email") {
        setMessage("Check your email to confirm the account, then sign in.");
        setMode("signin");
        return false;
      }
    }
    const registered = await registerNewDealershipAdmin({
      orgName: dealershipName,
      adminFullName: fullName,
    });
    if (registered.error) {
      setNameTaken(registered.field === "org_name");
      if (!registered.field) setError(registered.error);
      return false;
    }
    await ensureOwnProfile();
    if (fullName.trim()) await updateOwnFullName(fullName.trim());
    return true;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setError("");
    setMessage("");
    setNameTaken(false);

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

    if (mode === "signup" && signupKind === "register") {
      const ok = await handleRegisterDealership();
      setPassword("");
      setBusy(false);
      if (ok) router.replace("/");
      return;
    }

    if (mode === "signup" && !signupReady) {
      setBusy(false);
      setError("Enter your full name, a valid dealership code, and select your store.");
      return;
    }

    const result =
      mode === "signin"
        ? await signInWithPassword(email.trim(), password)
        : await signUpWithPassword(email.trim(), password, fullName.trim(), locationId.trim(), "join");
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
    await ensureOwnProfile(mode === "signup" ? locationId.trim() : null);
    if (mode === "signup") {
      if (fullName.trim()) await updateOwnFullName(fullName.trim());
      if (locationId.trim()) await updateOwnLocationId(locationId.trim());
    }
    setPassword("");
    setBusy(false);
    router.replace("/");
  }

  const signupLead =
    signupKind === "register"
      ? "Register a new dealership group. You become the Admin. A unique join code is created for your team."
      : "Create an account with your name, dealership group code, and rooftop. New accounts start as sales reps locked to that store.";

  return (
    <div className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-heading">
        <BrandHomeLink headingId="auth-heading" />
        <p className="auth-lead">
          {mode === "signin"
            ? "Sign in to open your worksheets, pack pay, and deal records."
            : mode === "forgot"
              ? "We’ll email a link so you can choose a new password."
              : signupLead}
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

            {mode === "signup" ? (
              <div className="auth-toggle" role="tablist" aria-label="Signup type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={signupKind === "join"}
                  className={signupKind === "join" ? "active" : ""}
                  onClick={() => switchSignupKind("join")}
                >
                  Join Existing Team
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={signupKind === "register"}
                  className={signupKind === "register" ? "active" : ""}
                  onClick={() => switchSignupKind("register")}
                >
                  Register New Dealership
                </button>
              </div>
            ) : null}

            <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
              {mode === "signup" && signupKind === "register" ? (
                <>
                  <label>
                    Dealership / Group Name
                    <Input
                      type="text"
                      autoComplete="organization"
                      required
                      minLength={2}
                      value={dealershipName}
                      onChange={(event) => {
                        setDealershipName(event.target.value);
                        setNameTaken(false);
                      }}
                      placeholder="e.g. Acme Automotive Group"
                    />
                    {nameTaken ? (
                      <p className="signup-org-bad" role="alert">
                        {DEALERSHIP_TAKEN_MESSAGE}
                      </p>
                    ) : null}
                  </label>
                  <label>
                    Your Full Name
                    <Input
                      type="text"
                      autoComplete="name"
                      required
                      minLength={2}
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="e.g. Jane Owner"
                    />
                  </label>
                </>
              ) : null}
              {mode === "signup" && signupKind === "join" ? (
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
                    Dealership Code
                    <Input
                      type="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      value={orgCode}
                      onChange={(event) => {
                        const next = normalizeOrgCode(event.target.value);
                        setOrgCode(next);
                        setOrgLookup(null);
                        setOrgCodeError("");
                        setLocationId("");
                        scheduleOrgLookup(next);
                      }}
                      onBlur={() => void resolveOrgCode(orgCode)}
                      placeholder="e.g. 7K9X2B"
                      required
                    />
                  </label>
                  {orgCodeChecking ? <p className="empty-note">Checking dealership code…</p> : null}
                  {orgLookup ? (
                    <p className="signup-org-ok" role="status">
                      ✓ Connected to {orgLookup.org_name}
                    </p>
                  ) : null}
                  {orgCodeError ? (
                    <p className="signup-org-bad" role="alert">
                      ✗ Invalid dealership code.
                    </p>
                  ) : null}
                  {orgLookup ? (
                    <label>
                      Select Your Location / Store
                      <select
                        className="auth-select"
                        required
                        value={locationId}
                        disabled={connectedStores.length === 0}
                        onChange={(event) => setLocationId(event.target.value)}
                      >
                        <option value="">Select your dealership store...</option>
                        {connectedStores.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {orgLookup && connectedStores.length === 0 ? (
                    <p className="form-error">This group has no rooftops yet. Ask an admin to add locations.</p>
                  ) : null}
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
              <Button type="submit" disabled={busy || (mode === "signup" && !signupReady)}>
                {busy
                  ? "Please wait…"
                  : mode === "signin"
                    ? "Sign In"
                    : mode === "forgot"
                      ? "Send reset link"
                      : signupKind === "register"
                        ? "Register Dealership"
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
