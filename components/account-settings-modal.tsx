"use client";

import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSessionEmail, updateSessionFullName, updateSessionPassword } from "@/lib/auth-session";
import { displayName } from "@/lib/names";
import { useOrg, useOrgActions } from "@/lib/org-store";
import type { SessionUser } from "@/lib/auth-session";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function AccountSettingsModal({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: SessionUser;
  onClose: () => void;
}) {
  const canPortal = useBrowserDocument();
  if (!open || !canPortal) return null;
  return createPortal(<AccountSettingsPanel user={user} onClose={onClose} />, document.body);
}

function AccountSettingsPanel({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const org = useOrg();
  const { updateOwnName, updateOwnProfileEmail } = useOrgActions();
  const titleId = useId();
  const [nameDraft, setNameDraft] = useState(org.profile?.full_name?.trim() || user.fullName || "");
  const [emailDraft, setEmailDraft] = useState(org.profile?.email || user.email || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"name" | "email" | "password" | null>(null);
  const [nameMessage, setNameMessage] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const cleaned = nameDraft.trim();
    if (!cleaned) {
      setNameError("Enter your full name.");
      return;
    }
    setBusy("name");
    setNameError("");
    setNameMessage("");
    const metaError = await updateSessionFullName(cleaned);
    const profileError = await updateOwnName(cleaned);
    setBusy(null);
    if (metaError && profileError) {
      setNameError(profileError);
      return;
    }
    setNameMessage("Full name saved.");
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    const cleaned = emailDraft.trim();
    if (!cleaned) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setBusy("email");
    setEmailError("");
    setEmailMessage("");
    const result = await updateSessionEmail(cleaned);
    if (result.status === "error") {
      setBusy(null);
      setEmailError(result.message);
      return;
    }
    if (result.status === "updated") {
      await updateOwnProfileEmail(cleaned);
      setEmailMessage("Email updated.");
    } else {
      setEmailMessage("Check the new inbox to confirm this email change.");
    }
    setBusy(null);
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setPasswordError("Those passwords do not match.");
      return;
    }
    setBusy("password");
    setPasswordError("");
    setPasswordMessage("");
    const result = await updateSessionPassword(password);
    setBusy(null);
    if (result) {
      setPasswordError(result);
      return;
    }
    setPassword("");
    setConfirm("");
    setPasswordMessage("Password updated.");
  }

  return (
    <div className="account-modal-backdrop" onClick={onClose}>
      <section
        className="account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="account-modal-head">
          <div>
            <p className="workbook-kicker">Signed in</p>
            <h2 id={titleId}>Account settings</h2>
            <p className="auth-lead">
              {displayName({
                full_name: org.profile?.full_name ?? user.fullName,
                email: user.email,
              })}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <form className="auth-form" onSubmit={(event) => void saveName(event)}>
          <label>
            Full Name
            <Input
              type="text"
              autoComplete="name"
              required
              minLength={2}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy !== null}>
            {busy === "name" ? "Saving…" : "Save name"}
          </Button>
          {nameError ? <p className="form-error">{nameError}</p> : null}
          {nameMessage ? <p className="form-success">{nameMessage}</p> : null}
        </form>

        <form className="auth-form" onSubmit={(event) => void saveEmail(event)}>
          <label>
            Email
            <Input
              type="email"
              autoComplete="email"
              required
              value={emailDraft}
              onChange={(event) => setEmailDraft(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy !== null}>
            {busy === "email" ? "Saving…" : "Save email"}
          </Button>
          {emailError ? <p className="form-error">{emailError}</p> : null}
          {emailMessage ? <p className="form-success">{emailMessage}</p> : null}
        </form>

        <form className="auth-form" onSubmit={(event) => void savePassword(event)}>
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
          <Button type="submit" disabled={busy !== null}>
            {busy === "password" ? "Saving…" : "Update password"}
          </Button>
          {passwordError ? <p className="form-error">{passwordError}</p> : null}
          {passwordMessage ? <p className="form-success">{passwordMessage}</p> : null}
        </form>
      </section>
    </div>
  );
}
