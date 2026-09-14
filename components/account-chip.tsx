"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signOut, updateSessionFullName } from "@/lib/auth-session";
import { displayName } from "@/lib/names";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { signedInRoleBadge } from "@/lib/roles";
import { useAuthSession } from "@/lib/use-auth-session";

export function AccountChip() {
  const { user } = useAuthSession();
  const org = useOrg();
  const { updateOwnName } = useOrgActions();
  const profile = org.profile;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");

  if (!user) return null;

  const sessionUser = user;
  const shownName = displayName({
    full_name: profile?.full_name ?? sessionUser.fullName,
    email: sessionUser.email,
  });

  const badge =
    profile || org.ready ? signedInRoleBadge(profile?.role, !profile) : null;

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  function startEdit() {
    setNameDraft(profile?.full_name?.trim() || sessionUser.fullName || "");
    setError("");
    setEditing(true);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const cleaned = nameDraft.trim();
    if (!cleaned) {
      setError("Enter your full name.");
      return;
    }
    setBusy(true);
    setError("");
    const metaError = await updateSessionFullName(cleaned);
    const profileError = await updateOwnName(cleaned);
    setBusy(false);
    if (metaError && profileError) {
      setError(profileError);
      return;
    }
    setEditing(false);
  }

  return (
    <div className="account-chip no-print">
      {editing ? (
        <form className="account-name-form" onSubmit={(event) => void saveName(event)}>
          <Input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            aria-label="Full name"
            autoComplete="name"
            required
            minLength={2}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setError("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <button type="button" className="account-name-btn" onClick={startEdit}>
          {shownName}
        </button>
      )}
      {badge ? <span className="role-badge">{badge}</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleSignOut()}>
        Sign Out
      </Button>
      {error ? <p className="account-name-error">{error}</p> : null}
    </div>
  );
}
