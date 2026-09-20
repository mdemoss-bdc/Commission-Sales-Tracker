import { formatMoney } from "@/lib/format";
import { DEAL_TYPES } from "@/lib/deal-types";
import { dealTypeStats } from "@/lib/summaries";
import type { Sale, VehicleTypeOption } from "@/lib/types";

const CATEGORY_LABELS: Record<(typeof DEAL_TYPES)[number], string> = {
  new: "New",
  used: "Used",
  lease_buyout: "Other",
};

export function DealTypeSummary({
  sales,
  vehicleTypes,
  hideGross = false,
}: {
  sales: Sale[];
  vehicleTypes?: VehicleTypeOption[] | null;
  hideGross?: boolean;
}) {
  const mix = dealTypeStats(sales, vehicleTypes);
  const total = DEAL_TYPES.reduce((sum, type) => sum + mix[type].units, 0);
  if (total === 0) {
    return <p className="empty-note">Deal type mix shows once deals are entered.</p>;
  }

  return (
    <table className="mini-sheet">
      <thead>
        <tr>
          <th scope="col">Deal type</th>
          <th scope="col">Units</th>
          {hideGross ? null : <th scope="col">Gross</th>}
          <th scope="col">Trades</th>
        </tr>
      </thead>
      <tbody>
        {DEAL_TYPES.map((type) => (
          <tr key={type}>
            <th scope="row">{CATEGORY_LABELS[type]}</th>
            <td>{mix[type].units}</td>
            {hideGross ? null : <td>{formatMoney(mix[type].gross)}</td>}
            <td>{mix[type].trades}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
