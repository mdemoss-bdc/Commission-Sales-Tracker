import {
  getActiveTier,
  getCommissionRate,
  nextPackGoal,
  PACK_LABELS,
  sumField,
} from "@/lib/commission";
import { VehicleTypesForm } from "@/components/vehicle-types-form";
import { DealTypeSummary } from "@/components/deal-type-summary";
import { formatMoney, formatPercent } from "@/lib/format";
import { vehicleLabel } from "@/lib/vehicles";
import type { ExtraPay, Sale, Totals, VehicleTypeOption } from "@/lib/types";

type TotalsPanelProps = {
  sales: Sale[];
  totals: Totals;
  bonuses: ExtraPay[];
  vehicleTypes: VehicleTypeOption[];
  onVehicleTypesChange: (types: VehicleTypeOption[]) => void;
};

export function TotalsPanel({
  sales,
  totals,
  bonuses,
  vehicleTypes,
  onVehicleTypesChange,
}: TotalsPanelProps) {
  const units = totals.units;
  const rate = getCommissionRate(units);
  const tier = getActiveTier(units);
  const goal = nextPackGoal(units);
  const counted = sales.filter(
    (sale) => sale.stockNumber.trim() || sale.customerName.trim(),
  );
  const productRows = [
    { label: "F & I", value: sumField(sales, "fi") },
    { label: "Service", value: sumField(sales, "service") },
    { label: "Flat", value: sumField(sales, "flat") },
  ];
  const frontEnd = totals.gross * rate;
  const typeIds = new Set(vehicleTypes.map((type) => type.id));
  const extraTypeIds = [
    ...new Set(
      counted
        .map((sale) => sale.vehicleType)
        .filter((id) => id && !typeIds.has(id)),
    ),
  ];

  return (
    <aside className="flex flex-col gap-4">
      <VehicleTypesForm types={vehicleTypes} onChange={onVehicleTypesChange} compact />
      <section className="summary-card pay-plan-card">
        <h2>Pay plan</h2>
        <p className="summary-kicker">
          {units} {units === 1 ? "unit" : "units"} · {formatPercent(rate)} pack
        </p>
        <ul className="tier-list">
          {PACK_LABELS.map((label, index) => {
            const active =
              (index === 0 && units < 4) ||
              (index === 1 && units >= 4 && units <= 7) ||
              (index === 2 && units >= 8 && units <= 11) ||
              (index === 3 && units >= 12);
            return (
              <li key={label} className={active ? "active" : undefined}>
                {label}
              </li>
            );
          })}
        </ul>
        <p className="goal-copy">
          {goal
            ? `${goal.unitsNeeded} more ${goal.unitsNeeded === 1 ? "unit" : "units"} to ${formatPercent(goal.rate)}.`
            : `${tier.label} — top pack rate.`}
        </p>
      </section>

      <section className="summary-card">
        <h2>Section totals</h2>
        <table className="mini-sheet">
          <tbody>
            <tr>
              <th scope="row">Gross</th>
              <td>{formatMoney(totals.gross)}</td>
            </tr>
            <tr>
              <th scope="row">Front-end pack</th>
              <td>{formatMoney(frontEnd)}</td>
            </tr>
            <tr>
              <th scope="row">Trade-ins</th>
              <td>{totals.trades}</td>
            </tr>
            {productRows.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td>{formatMoney(item.value)}</td>
              </tr>
            ))}
            {bonuses.map((bonus, index) => (
              <tr key={bonus.id}>
                <th scope="row">{bonus.label.trim() || `Bonus ${index + 1}`}</th>
                <td>{formatMoney(bonus.amount || 0)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Vacation pay</th>
              <td>{formatMoney(totals.vacation)}</td>
            </tr>
            <tr className="mini-grand">
              <th scope="row">Total</th>
              <td>{formatMoney(totals.pay)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="summary-card">
        <h2>By deal type</h2>
        <DealTypeSummary sales={counted} />
      </section>

      <section className="summary-card">
        <h2>By vehicle</h2>
        {counted.length === 0 ? (
          <p className="empty-note">Vehicle mix shows once deals are entered.</p>
        ) : (
          <table className="mini-sheet">
            <tbody>
              {[...vehicleTypes, ...extraTypeIds.map((id) => ({ id, label: vehicleLabel(vehicleTypes, id) }))].map(
                (type) => {
                  const rows = counted.filter((sale) => sale.vehicleType === type.id);
                  const gross = rows.reduce((sum, sale) => sum + sale.gross, 0);
                  return (
                    <tr key={type.id}>
                      <th scope="row">
                        {type.label.trim() || "Untitled"}
                        <span className="count-pill">{rows.length}</span>
                      </th>
                      <td>{formatMoney(gross)}</td>
                    </tr>
                  );
                },
              )}
              {counted.some((sale) => !sale.vehicleType) ? (
                <tr>
                  <th scope="row">
                    Unspecified
                    <span className="count-pill">
                      {counted.filter((sale) => !sale.vehicleType).length}
                    </span>
                  </th>
                  <td>
                    {formatMoney(
                      counted
                        .filter((sale) => !sale.vehicleType)
                        .reduce((sum, sale) => sum + sale.gross, 0),
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>
    </aside>
  );
}
