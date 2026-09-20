"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { draftPayTiers, packLabel, parseDraftPayTiers } from "@/lib/commission";
import type { CommissionTier } from "@/lib/types";

export type PayTierDraft = { min: string; max: string; percent: string };

type PayTierEditorProps = {
  drafts: PayTierDraft[];
  onChange: (drafts: PayTierDraft[]) => void;
  busy?: boolean;
  idPrefix?: string;
};

export function PayTierEditor({ drafts, onChange, busy = false, idPrefix = "tier" }: PayTierEditorProps) {
  function updateDraft(index: number, patch: Partial<PayTierDraft>) {
    onChange(drafts.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  const preview = parseDraftPayTiers(drafts);

  return (
    <div className="pay-tier-editor">
      <div className="pay-tier-head">
        <span>Min Units</span>
        <span>Max Units</span>
        <span>Pack %</span>
        <span className="sr-only">Remove</span>
      </div>
      {drafts.map((draft, index) => (
        <div key={`${idPrefix}-${index}`} className="pay-tier-row">
          <label>
            <span className="sr-only">Min units</span>
            <Input
              inputMode="numeric"
              value={draft.min}
              onChange={(event) => updateDraft(index, { min: event.target.value })}
              placeholder="0"
              required
              disabled={busy}
            />
          </label>
          <label>
            <span className="sr-only">Max units</span>
            <Input
              inputMode="numeric"
              value={draft.max}
              onChange={(event) => updateDraft(index, { max: event.target.value })}
              placeholder="open"
              disabled={busy}
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
              disabled={busy}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Remove tier ${index + 1}`}
            disabled={drafts.length <= 1 || busy}
            onClick={() => onChange(drafts.filter((_, rowIndex) => rowIndex !== index))}
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </div>
      ))}
      <ul className="tier-list pay-tier-preview">
        {preview.error
          ? null
          : preview.tiers.map((tier) => <li key={packLabel(tier)}>{packLabel(tier)}</li>)}
      </ul>
      <div className="cloud-setup-actions">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onChange([...drafts, { min: "", max: "", percent: "" }])}
        >
          <Plus data-icon="inline-start" />
          Add tier
        </Button>
      </div>
    </div>
  );
}

export function draftsFromTiers(tiers: CommissionTier[]): PayTierDraft[] {
  return draftPayTiers(tiers);
}

export function tiersFromDrafts(drafts: PayTierDraft[]): { tiers: CommissionTier[]; error: string | null } {
  return parseDraftPayTiers(drafts);
}
