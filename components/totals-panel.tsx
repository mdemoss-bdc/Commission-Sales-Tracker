import {
  getActiveTier,
  getCommissionRate,
  nextPackGoal,
  packLabel,
  sumField,
} from "@/lib/commission";
import { VehicleTypesForm } from "@/components/vehicle-types-form";
import { DealTypeSummary } from "@/components/deal-type-summary";
import { ByVehicleSection } from "@/components/by-vehicle-section";
import { formatMoney, formatPercent } from "@/lib/format";
import { usePayTiers } from "@/lib/org-store";
import { printAddonRows } from "@/lib/summaries";
import type { ExtraPay, Sale, Totals, VehicleTypeOption } from "@/lib/types";

type TotalsPanelProps = {
  sales: Sale[];
  totals: Totals;
  bonuses: ExtraPay[];
  vacationHours?: number;
  vacationRate?: number;
  vehicleTypes: VehicleTypeOption[];
  onVehicleTypesChange: (types: VehicleTypeOption[]) => void;
};

export function TotalsPanel({
  sales,
  totals,
  bonuses,
  vacationHours = 0,
  vacationRate = 0,
  vehicleTypes,
  onVehicleTypesChange,
}: TotalsPanelProps) {
  const tiers = usePayTiers();
  const units = totals.units;
  const rate = getCommissionRate(units, tiers);
  const tier = getActiveTier(units, tiers);
  const goal = nextPackGoal(units, tiers);
  const counted = sales.filter(
    (sale) => sale.stockNumber.trim() || sale.customerName.trim(),
  );
  const productRows = [
    { label: "F & I", value: sumField(sales, "fi") },
    { label: "Service", value: sumField(sales, "service") },
    { label: "Flat", value: sumField(sales, "flat") },
  ];
  const frontEnd = totals.gross * rate;

  const printDealTotals = [
    { label: "Gross", value: formatMoney(totals.gross) },
    { label: "Pack", value: formatMoney(frontEnd) },
    { label: "Trades", value: String(totals.trades) },
    { label: "Flats", value: formatMoney(sumField(sales, "flat")) },
    { label: "Service", value: formatMoney(sumField(sales, "service")) },
    { label: "F&I", value: formatMoney(sumField(sales, "fi")) },
  ];
  const addonRows = printAddonRows({
    totals,
    vacationHours,
    vacationRate,
  });

  return (
    <aside className="totals-panel flex flex-col gap-4 print:w-full">
      <VehicleTypesForm types={vehicleTypes} onChange={onVehicleTypesChange} compact />
      <section className="summary-card pay-plan-card">
        <h2>Pay plan</h2>
        <p className="summary-kicker">
          {units} {units === 1 ? "unit" : "units"} · {formatPercent(rate)} pack
        </p>
        <ul className="tier-list">
          {tiers.map((item) => (
            <li key={packLabel(item)} className={item.min === tier.min && item.max === tier.max ? "active" : undefined}>
              {packLabel(item)}
            </li>
          ))}
        </ul>
        <p className="goal-copy">
          {goal
            ? `${goal.unitsNeeded} more ${goal.unitsNeeded === 1 ? "unit" : "units"} to ${formatPercent(goal.rate)}.`
            : `${tier.label} — top pack rate.`}
        </p>
      </section>

      <section className="summary-card section-totals-card print:w-full">
        <h2>Section totals</h2>
        <table className="mini-sheet section-totals-screen print:hidden">
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
              <tr key={bonus.id} className="print:hidden">
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
        <dl className="section-totals-print hidden print:grid">
          {printDealTotals.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <table className="print-addons hidden print:table">
          <caption>Vacation</caption>
          <tbody>
            {addonRows.map((row) => (
              <tr key={row.key} className={row.kind === "grand" ? "print-addon-grand" : undefined}>
                <th scope="row">
                  <span className="print-addon-label">{row.label}</span>
                  {row.detail ? <span className="print-addon-detail">{row.detail}</span> : null}
                </th>
                <td>{formatMoney(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="summary-card by-deal-type print:hidden">
        <h2>By deal type</h2>
        <DealTypeSummary sales={counted} />
      </section>

      <ByVehicleSection sales={counted} vehicleTypes={vehicleTypes} />
    </aside>
  );
}
