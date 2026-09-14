"use client";

import { Plus, Trash2 } from "lucide-react";
import { MoneyCell } from "@/components/money-cell";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { ExtraPay } from "@/lib/types";

type ExtraPayFormProps = {
  vacationPay: number;
  bonuses: ExtraPay[];
  onVacationChange: (amount: number) => void;
  onAddBonus: () => void;
  onUpdateBonus: (id: string, patch: Partial<ExtraPay>) => void;
  onRemoveBonus: (id: string) => void;
};

export function ExtraPayForm({
  vacationPay,
  bonuses,
  onVacationChange,
  onAddBonus,
  onUpdateBonus,
  onRemoveBonus,
}: ExtraPayFormProps) {
  const bonusTotal = bonuses.reduce((sum, bonus) => sum + (bonus.amount || 0), 0);

  return (
    <section className="summary-card extra-pay-card no-print">
      <h2>Other pay</h2>
      <p className="empty-note no-print">
        Optional on this sheet. Vacation and named bonuses add to the sheet total.
      </p>
      <div className="extra-pay-row">
        <label htmlFor="vacation-pay">Vacation pay</label>
        <MoneyCell
          id="vacation-pay"
          value={vacationPay}
          ariaLabel="Vacation pay"
          onChange={onVacationChange}
        />
      </div>
      <ul className="bonus-list">
        {bonuses.map((bonus, index) => (
          <li key={bonus.id} className="bonus-row">
            <input
              aria-label={`Bonus ${index + 1} reason`}
              placeholder="Bonus is for"
              value={bonus.label}
              onChange={(event) => onUpdateBonus(bonus.id, { label: event.target.value })}
              className="sheet-input bonus-reason"
            />
            <MoneyCell
              value={bonus.amount}
              ariaLabel={`Bonus ${index + 1} amount`}
              onChange={(amount) => onUpdateBonus(bonus.id, { amount })}
            />
            <button
              type="button"
              aria-label={`Remove bonus ${index + 1}`}
              onClick={() => onRemoveBonus(bonus.id)}
              className="remove-btn"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="extra-pay-actions">
        <Button className="no-print" variant="outline" onClick={onAddBonus}>
          <Plus data-icon="inline-start" />
          Add bonus
        </Button>
        <p className="extra-pay-total">
          Vacation + bonuses {formatMoney(vacationPay + bonusTotal)}
        </p>
      </div>
    </section>
  );
}
