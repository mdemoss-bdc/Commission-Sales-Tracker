"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleCard } from "@/components/collapsible-card";
import { draftPayTiers, packLabel, parseDraftPayTiers } from "@/lib/commission";
import { useOrg, useOrgActions, usePayTiers } from "@/lib/org-store";
import { needsDealershipLink } from "@/lib/signup";

export function OrganizationPayPlanCard() {
  const org = useOrg();
  const tiers = usePayTiers();
  const { savePayTiers } = useOrgActions();
  const [drafts, setDrafts] = useState(() => draftPayTiers(tiers));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDrafts(draftPayTiers(tiers));
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

  function updateDraft(index: number, patch: Partial<(typeof drafts)[number]>) {
    setDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    setSaved(false);
    setError("");
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDraftPayTiers(drafts);
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
        Unit tiers and pack percentages apply to every worksheet in {org.organization.name}. Leave Max Units blank
        for an open-ended top tier (for example 12+). Saving updates commission on every rep and manager sheet.
      </p>
      <form className="pay-tier-editor" onSubmit={(event) => void handleSave(event)}>
        <div className="pay-tier-head">
          <span>Min Units</span>
          <span>Max Units</span>
          <span>Pack %</span>
          <span className="sr-only">Remove</span>
        </div>
        {drafts.map((draft, index) => (
          <div key={index} className="pay-tier-row">
            <label>
              <span className="sr-only">Min units</span>
              <Input
                inputMode="numeric"
                value={draft.min}
                onChange={(event) => updateDraft(index, { min: event.target.value })}
                placeholder="0"
                required
              />
            </label>
            <label>
              <span className="sr-only">Max units</span>
              <Input
                inputMode="numeric"
                value={draft.max}
                onChange={(event) => updateDraft(index, { max: event.target.value })}
                placeholder="open"
              />
            </label>
            <label>
              <span className="sr-only">Pack percent</span>
              <Input
                inputMode="decimal"
                value={draft.percent}
                onChange={(event) => updateDraft(index, { percent: event.target.value })}
                placeholder="20"
                required
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Remove tier ${index + 1}`}
              disabled={drafts.length <= 1 || busy}
              onClick={() => {
                setDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index));
                setSaved(false);
              }}
            >
              <Trash2 data-icon="inline-start" />
            </Button>
          </div>
        ))}
        <ul className="tier-list pay-tier-preview">
          {(() => {
            const preview = parseDraftPayTiers(drafts);
            if (preview.error) return null;
            return preview.tiers.map((tier) => <li key={packLabel(tier)}>{packLabel(tier)}</li>);
          })()}
        </ul>
        <div className="cloud-setup-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDrafts((current) => [...current, { min: "", max: "", percent: "" }]);
              setSaved(false);
            }}
          >
            <Plus data-icon="inline-start" />
            Add tier
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save & Apply to All Sheets"}
          </Button>
        </div>
      </form>
      {saved ? <p className="form-success">Pay plan applied to every worksheet in this group.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </CollapsibleCard>
  );
}
