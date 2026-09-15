"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrg, useOrgActions } from "@/lib/org-store";

export function OrganizationCodeCard() {
  const org = useOrg();
  const { updateOrganizationCode } = useOrgActions();
  const current = org.organization;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current?.join_code ?? "MOSES");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  if (!current) {
    return (
      <section className="summary-card no-print">
        <h2>Organization</h2>
        <p className="empty-note">
          Re-run supabase/schema.sql in the SQL editor to enable the dealership group join code.
        </p>
      </section>
    );
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setBusy(true);
    setError("");
    setSaved(false);
    const message = await updateOrganizationCode(current.id, draft);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setEditing(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <section className="summary-card no-print">
      <h2>Organization</h2>
      <p className="empty-note">
        New sales reps must enter this dealership group code, then pick a rooftop. Current group: {current.name}.
      </p>
      <p className="org-code-display">
        Dealership Group Code: <strong>{current.join_code}</strong>
      </p>
      {editing ? (
        <form className="auth-form" onSubmit={(event) => void handleSave(event)}>
          <label>
            Edit Code
            <Input
              value={draft}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value.toUpperCase())}
              placeholder="e.g. MOSES"
              required
            />
          </label>
          <div className="cloud-setup-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save code"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(current.join_code);
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(current.join_code);
            setEditing(true);
            setError("");
          }}
        >
          Edit Code
        </Button>
      )}
      {saved ? <p className="form-success">Join code updated.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
