import {
  getActiveTier,
  getCommissionRate,
  nextPackGoal,
  PACK_LABELS,
  sumField,
} from "@/lib/commission";
import { formatMoney, formatPercent } from "@/lib/format";
import { summarizeSales } from "@/lib/summaries";
import { VEHICLE_TYPES, type Sale } from "@/lib/types";

type TotalsPanelProps = {
  sales: Sale[];
  trades: number;
};

export function TotalsPanel({ sales, trades }: TotalsPanelProps) {
  const totals = summarizeSales(sales);
  const units = totals.units;
  const rate = getCommissionRate(units);
  const tier = getActiveTier(units);
  const goal = nextPackGoal(units);
  const counted = sales.filter(
    (sale) => sale.stockNumber.trim() || sale.customerName.trim(),
  );
  const productRows = [
    { label: "GAP", value: sumField(sales, "gap") },
    { label: "CarCare", value: sumField(sales, "carCare") },
    { label: "F & I", value: sumField(sales, "fi") },
    { label: "SERVICE", value: sumField(sales, "service") },
    { label: "Drive 360", value: sumField(sales, "drive360") },
    { label: "Flat", value: sumField(sales, "flat") },
  ];
  const productTotal = productRows.reduce((sum, item) => sum + item.value, 0);
  const frontEnd = totals.gross * rate;

  return (
    <aside className="flex flex-col gap-4">
      <section className="summary-card">
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
              <td>{trades}</td>
            </tr>
            {productRows.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td>{formatMoney(item.value)}</td>
              </tr>
            ))}
            <tr className="mini-total">
              <th scope="row">Backend products</th>
              <td>{formatMoney(productTotal)}</td>
            </tr>
            <tr className="mini-grand">
              <th scope="row">Total</th>
              <td>{formatMoney(totals.pay)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="summary-card">
        <h2>By vehicle</h2>
        {counted.length === 0 ? (
          <p className="empty-note">Vehicle mix shows once deals are entered.</p>
        ) : (
          <table className="mini-sheet">
            <tbody>
              {VEHICLE_TYPES.map((type) => {
                const rows = counted.filter((sale) => sale.vehicleType === type.value);
                const gross = rows.reduce((sum, sale) => sum + sale.gross, 0);
                return (
                  <tr key={type.value}>
                    <th scope="row">
                      {type.label}
                      <span className="count-pill">{rows.length}</span>
                    </th>
                    <td>{formatMoney(gross)}</td>
                  </tr>
                );
              })}
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
