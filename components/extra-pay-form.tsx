"use client";

import { Plus, Trash2 } from "lucide-react";
import { MoneyCell } from "@/components/money-cell";
import { Button } from "@/components/ui/button";
import { vacationPayAmount } from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import type { ExtraPay } from "@/lib/types";

type ExtraPayFormProps = {
  vacationHours: number;
  vacationRate: number;
  vacationPay?: number;
  bonuses: ExtraPay[];
  onVacationChange: (hours: number, rate: number) => void;
  onAddBonus: () => void;
  onUpdateBonus: (id: string, patch: Partial<ExtraPay>) => void;
  onRemoveBonus: (id: string) => void;
};

export function ExtraPayForm({
  vacationHours,
  vacationRate,
  vacationPay: storedVacationPay = 0,
  bonuses,
  onVacationChange,
  onAddBonus,
  onUpdateBonus,
  onRemoveBonus,
}: ExtraPayFormProps) {
  const vacationPay = vacationPayAmount(vacationHours, vacationRate, storedVacationPay);
  const bonusTotal = bonuses.reduce((sum, bonus) => sum + (bonus.amount || 0), 0);

  return (
    <section className="summary-card extra-pay-card no-print">
      <h2>Other pay</h2>
      <p className="empty-note no-print">
        Vacation total is hours × hourly rate. Named bonuses add on top of that.
      </p>
      <div className="vacation-fields">
        <label htmlFor="vacation-hours">
          Vacation hours
          <input
            id="vacation-hours"
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 40"
            aria-label="Vacation hours"
            value={vacationHours === 0 ? "" : String(vacationHours)}
            onChange={(event) => {
              const hours = Number(event.target.value);
              onVacationChange(Number.isFinite(hours) && hours > 0 ? hours : 0, vacationRate);
            }}
            className="sheet-input text-right tabular-nums"
          />
        </label>
        <label htmlFor="vacation-rate">
          Hourly rate ($ / hr)
          <input
            id="vacation-rate"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 18.50"
            aria-label="Vacation hourly rate"
            value={vacationRate === 0 ? "" : String(vacationRate)}
            onChange={(event) => {
              const rate = Number(event.target.value);
              onVacationChange(vacationHours, Number.isFinite(rate) && rate > 0 ? rate : 0);
            }}
            className="sheet-input text-right tabular-nums"
          />
        </label>
        <p className="vacation-total-line">
          <span>Vacation total</span>
          <strong>{formatMoney(vacationPay)}</strong>
        </p>
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
