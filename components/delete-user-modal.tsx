"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { personDeleteLabel } from "@/lib/names";
import type { UserProfile } from "@/lib/roles";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function DeleteUserModal({
  person,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  person: UserProfile | null;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canPortal = useBrowserDocument();
  if (!person || !canPortal) return null;
  return createPortal(
    <DeleteUserPanel
      person={person}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
    document.body,
  );
}

function DeleteUserPanel({
  person,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  person: UserProfile;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const label = personDeleteLabel(person);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="account-modal-backdrop" onClick={() => (busy ? undefined : onCancel())}>
      <section
        className="account-modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="workbook-kicker">People</p>
        <h2 id={titleId}>Delete account</h2>
        <p className="auth-lead">
          Are you sure you want to permanently delete {label}? This will revoke their access and remove their
          profile immediately.
        </p>
        <div className="confirm-modal-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete Account"}
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>
  );
}
