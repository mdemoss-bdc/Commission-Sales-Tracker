"use client";

import { Plus, Trash2 } from "lucide-react";
import { MoneyCell } from "@/components/money-cell";
import { Button } from "@/components/ui/button";
import { isHourlyPayMode, regularPayAmount, vacationPayAmount } from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import type { ExtraPayHighlights } from "@/lib/sheet-compare";
import type { ExtraPay } from "@/lib/types";

type ExtraPayFormProps = {
  regularHours?: number;
  hourlyRate?: number;
  vacationHours: number;
  vacationRate: number;
  vacationPay?: number;
  bonuses: ExtraPay[];
  onRegularChange?: (hours: number, rate: number) => void;
  onVacationChange: (hours: number, rate: number) => void;
  onAddBonus: () => void;
  onUpdateBonus: (id: string, patch: Partial<ExtraPay>) => void;
  onRemoveBonus: (id: string) => void;
  readOnly?: boolean;
  idPrefix?: string;
  highlights?: ExtraPayHighlights;
};

export function ExtraPayForm({
  regularHours = 0,
  hourlyRate = 0,
  vacationHours,
  vacationRate,
  vacationPay: storedVacationPay = 0,
  bonuses,
  onRegularChange,
  onVacationChange,
  onAddBonus,
  onUpdateBonus,
  onRemoveBonus,
  readOnly = false,
  idPrefix = "extra",
  highlights,
}: ExtraPayFormProps) {
  const vacationPay = vacationPayAmount(vacationHours, vacationRate, storedVacationPay);
  const regularPay = regularPayAmount(regularHours, hourlyRate);
  const hourlyMode = isHourlyPayMode({ regularHours, hourlyRate });
  const bonusTotal = bonuses.reduce((sum, bonus) => sum + (bonus.amount || 0), 0);
  const regularHoursId = `${idPrefix}-regular-hours`;
  const hourlyRateId = `${idPrefix}-hourly-rate`;
  const hoursId = `${idPrefix}-vacation-hours`;
  const rateId = `${idPrefix}-vacation-rate`;

  return (
    <section className="summary-card extra-pay-card no-print">
      <h2>Other pay</h2>
      <p className="empty-note no-print">
        Regular hours use an hourly rate instead of deal commissions. Vacation hours stay separate. Named bonuses
        always add on top.
      </p>

      <div className="vacation-fields">
        <p className="field-label" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Regular hours
        </p>
        <label
          htmlFor={regularHoursId}
          className={highlights?.regularHours ? "sheet-compare-cell extra-compare-field" : undefined}
        >
          Hours worked
          <input
            id={regularHoursId}
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 40"
            readOnly={readOnly || !onRegularChange}
            aria-label="Hours worked"
            value={regularHours === 0 ? "" : String(regularHours)}
            onChange={(event) => {
              if (readOnly || !onRegularChange) return;
              const hours = Number(event.target.value);
              onRegularChange(Number.isFinite(hours) && hours > 0 ? hours : 0, hourlyRate);
            }}
            className="sheet-input text-right tabular-nums"
          />
        </label>
        <label
          htmlFor={hourlyRateId}
          className={highlights?.hourlyRate ? "sheet-compare-cell extra-compare-field" : undefined}
        >
          Hourly pay rate ($ / hr)
          {readOnly || !onRegularChange ? (
            <span id={hourlyRateId} className="formula-cell">
              {hourlyRate === 0 ? "—" : formatMoney(hourlyRate)}
            </span>
          ) : (
            <MoneyCell
              id={hourlyRateId}
              value={hourlyRate}
              ariaLabel="Hourly pay rate"
              placeholder="e.g. 18.50"
              onChange={(rate) => onRegularChange(regularHours, rate > 0 ? rate : 0)}
            />
          )}
        </label>
        <p className="vacation-total-line">
          <span>Regular pay</span>
          <strong>{formatMoney(regularPay)}</strong>
        </p>
        {hourlyMode ? (
          <p className="empty-note" style={{ gridColumn: "1 / -1" }}>
            Hourly mode on — deal table commissions/flats are excluded from Total Pay. Bonuses and vacation still
            count.
          </p>
        ) : null}
      </div>

      <div className="vacation-fields">
        <p className="field-label" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Vacation hours
        </p>
        <label htmlFor={hoursId} className={highlights?.hours ? "sheet-compare-cell extra-compare-field" : undefined}>
          Vacation hours
          <input
            id={hoursId}
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 40"
            readOnly={readOnly}
            aria-label="Vacation hours"
            value={vacationHours === 0 ? "" : String(vacationHours)}
            onChange={(event) => {
              if (readOnly) return;
              const hours = Number(event.target.value);
              onVacationChange(Number.isFinite(hours) && hours > 0 ? hours : 0, vacationRate);
            }}
            className="sheet-input text-right tabular-nums"
          />
        </label>
        <label htmlFor={rateId} className={highlights?.rate ? "sheet-compare-cell extra-compare-field" : undefined}>
          Vacation hourly rate ($ / hr)
          {readOnly ? (
            <span id={rateId} className="formula-cell">
              {vacationRate === 0 ? "—" : formatMoney(vacationRate)}
            </span>
          ) : (
            <MoneyCell
              id={rateId}
              value={vacationRate}
              ariaLabel="Vacation hourly rate"
              placeholder="e.g. 18.50"
              onChange={(rate) => onVacationChange(vacationHours, rate > 0 ? rate : 0)}
            />
          )}
        </label>
        <p className={`vacation-total-line ${highlights?.pay ? "sheet-compare-cell extra-compare-field" : ""}`}>
          <span>Vacation total</span>
          <strong>{formatMoney(vacationPay)}</strong>
        </p>
      </div>

      {bonuses.length === 0 ? <p className="empty-note">No bonuses on this worksheet.</p> : null}
      <ul className="bonus-list">
        {bonuses.map((bonus, index) => (
          <li
            key={bonus.id}
            className={`bonus-row ${readOnly ? "bonus-row-readonly" : ""} ${highlights?.bonusIds?.has(bonus.id) ? "sheet-compare-cell extra-compare-field" : ""}`}
          >
            <input
              aria-label={`Bonus ${index + 1} reason`}
              placeholder="Bonus is for"
              readOnly={readOnly}
              value={bonus.label}
              onChange={(event) => {
                if (readOnly) return;
                onUpdateBonus(bonus.id, { label: event.target.value });
              }}
              className="sheet-input bonus-reason"
            />
            {readOnly ? (
              <span className="formula-cell">{formatMoney(bonus.amount)}</span>
            ) : (
              <MoneyCell
                value={bonus.amount}
                ariaLabel={`Bonus ${index + 1} amount`}
                onChange={(amount) => onUpdateBonus(bonus.id, { amount })}
              />
            )}
            {readOnly ? null : (
              <button
                type="button"
                aria-label={`Remove bonus ${index + 1}`}
                onClick={() => onRemoveBonus(bonus.id)}
                className="remove-btn"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="extra-pay-actions">
        {readOnly ? null : (
          <Button className="no-print" variant="outline" onClick={onAddBonus}>
            <Plus data-icon="inline-start" />
            Add bonus
          </Button>
        )}
        <p className="extra-pay-total">
          Regular + vacation + bonuses {formatMoney(regularPay + vacationPay + bonusTotal)}
        </p>
      </div>
    </section>
  );
}
