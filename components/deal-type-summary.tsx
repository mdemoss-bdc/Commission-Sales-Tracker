import { formatMoney } from "@/lib/format";
import { DEAL_TYPES, dealTypeLabel } from "@/lib/deal-types";
import { dealTypeStats } from "@/lib/summaries";
import type { Sale } from "@/lib/types";

export function DealTypeSummary({ sales }: { sales: Sale[] }) {
  const mix = dealTypeStats(sales);
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
          <th scope="col">Gross</th>
          <th scope="col">Trades</th>
        </tr>
      </thead>
      <tbody>
        {DEAL_TYPES.map((type) => (
          <tr key={type}>
            <th scope="row">{dealTypeLabel(type)}</th>
            <td>{mix[type].units}</td>
            <td>{formatMoney(mix[type].gross)}</td>
            <td>{mix[type].trades}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
