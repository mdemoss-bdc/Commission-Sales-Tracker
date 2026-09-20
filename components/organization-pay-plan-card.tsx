"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { draftsFromTiers, PayTierEditor, tiersFromDrafts } from "@/components/pay-tier-editor";
import { useOrg, useOrgActions, usePayTiers } from "@/lib/org-store";
import { needsDealershipLink } from "@/lib/signup";

export function OrganizationPayPlanCard() {
  const org = useOrg();
  const tiers = usePayTiers();
  const { savePayTiers } = useOrgActions();
  const [drafts, setDrafts] = useState(() => draftsFromTiers(tiers));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDrafts(draftsFromTiers(tiers));
  }, [tiers]);

  if (!org.organization) {
    if (needsDealershipLink(org.profile)) return null;
    return (
      <CollapsibleCard title="Organization Pay Plan">
        <p className="empty-note">
          Re-run supabase/schema.sql in the SQL editor to enable organization-wide unit tiers.
        </p>
      </CollapsibleCard>
    );
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const parsed = tiersFromDrafts(drafts);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    const message = await savePayTiers(parsed.tiers);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <CollapsibleCard title="Organization Pay Plan">
      <p className="empty-note">
        Dealership unit tiers and pack percentages override every linked sales rep’s personal plan and lock their Pay
        Plan sidebar. Leave Max Units blank for an open-ended top tier (for example 12+). Saving updates commission on
        every worksheet in {org.organization.name} immediately.
      </p>
      <form className="pay-tier-editor" onSubmit={(event) => void handleSave(event)}>
        <PayTierEditor
          drafts={drafts}
          onChange={(next) => {
            setDrafts(next);
            setSaved(false);
            setError("");
          }}
          busy={busy}
          idPrefix="org"
        />
        <div className="cloud-setup-actions" style={{ marginTop: "0.5rem" }}>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save & Apply to All Sheets"}
          </Button>
        </div>
      </form>
      {saved ? (
        <p className="form-success">Pay plan applied — all connected reps inherit these brackets immediately.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </CollapsibleCard>
  );
}
