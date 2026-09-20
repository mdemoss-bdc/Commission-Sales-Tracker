"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { draftsFromTiers, PayTierEditor, tiersFromDrafts } from "@/components/pay-tier-editor";
import { SAVE_PAY_PLAN_LABEL, savePersonalPayTiers } from "@/lib/pay-plan";
import type { CommissionTier } from "@/lib/types";

export function PersonalPayPlanModal({
  userId,
  tiers,
  onClose,
  onSaved,
}: {
  userId: string | null;
  tiers: CommissionTier[];
  onClose: () => void;
  onSaved: (tiers: CommissionTier[]) => void;
}) {
  const [drafts, setDrafts] = useState(() => draftsFromTiers(tiers));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDrafts(draftsFromTiers(tiers));
  }, [tiers]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    const parsed = tiersFromDrafts(drafts);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    const message = savePersonalPayTiers(userId, parsed.tiers);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    onSaved(parsed.tiers);
    onClose();
  }

  return (
    <div className="account-modal-backdrop no-print" role="presentation" onClick={() => (busy ? undefined : onClose())}>
      <div
        className="account-modal max-w-lg w-[94vw]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-pay-plan-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="account-modal-head">
          <div>
            <p className="workbook-kicker">Personal pay plan</p>
            <h2 id="personal-pay-plan-title">Edit unit tiers</h2>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="empty-note">
          Adjust unit ranges and pack percentages for your worksheets. Leave Max Units blank for an open-ended top
          tier (for example 12+). This plan applies only while you are not linked to a dealership pay plan.
        </p>
        <form onSubmit={(event) => void handleSave(event)}>
          <PayTierEditor drafts={drafts} onChange={setDrafts} busy={busy} idPrefix="personal" />
          <div className="cloud-setup-actions" style={{ marginTop: "0.75rem" }}>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : SAVE_PAY_PLAN_LABEL}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </div>
  );
}
