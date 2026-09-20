import { formatMoney } from "@/lib/format";
import { countUnits, saleCommission, getCommissionRate } from "@/lib/commission";
import { usePayTiers } from "@/lib/org-store";
import { vehicleLabel } from "@/lib/vehicles";
import type { Sale, VehicleTypeOption } from "@/lib/types";

type ByVehicleSectionProps = {
  sales: Sale[];
  vehicleTypes: VehicleTypeOption[];
  hideGross?: boolean;
};

export function ByVehicleSection({ sales, vehicleTypes, hideGross = false }: ByVehicleSectionProps) {
  const tiers = usePayTiers();
  const rate = getCommissionRate(countUnits(sales, vehicleTypes), tiers);
  const typeIds = new Set(vehicleTypes.map((type) => type.id));
  const extraTypeIds = [
    ...new Set(sales.map((sale) => sale.vehicleType).filter((id) => id && !typeIds.has(id))),
  ];

  return (
    <div className="by-vehicle-section no-print print:hidden">
      <section className="summary-card by-vehicle-card print:hidden">
        <h2 className="print:hidden">By vehicle</h2>
        {sales.length === 0 ? (
          <p className="empty-note print:hidden">Vehicle mix shows once deals are entered.</p>
        ) : (
          <table className="mini-sheet by-vehicle-table print:hidden">
            <tbody>
              {[
                ...vehicleTypes,
                ...extraTypeIds.map((id) => ({ id, label: vehicleLabel(vehicleTypes, id) })),
              ].map((type) => {
                const rows = sales.filter((sale) => sale.vehicleType === type.id);
                const units = countUnits(rows, vehicleTypes);
                const gross = rows.reduce((sum, sale) => sum + sale.gross, 0);
                const commission = rows.reduce((sum, sale) => sum + saleCommission(sale, rate), 0);
                return (
                  <tr key={type.id} className="print:hidden">
                    <th scope="row">
                      {type.label.trim() || "Untitled"}
                      <span className="count-pill">{units}</span>
                    </th>
                    <td>{hideGross ? formatMoney(commission) : formatMoney(gross)}</td>
                  </tr>
                );
              })}
              {sales.some((sale) => !sale.vehicleType) ? (
                <tr className="print:hidden">
                  <th scope="row">
                    Unspecified
                    <span className="count-pill">
                      {countUnits(
                        sales.filter((sale) => !sale.vehicleType),
                        vehicleTypes,
                      )}
                    </span>
                  </th>
                  <td>
                    {hideGross
                      ? formatMoney(
                          sales
                            .filter((sale) => !sale.vehicleType)
                            .reduce((sum, sale) => sum + saleCommission(sale, rate), 0),
                        )
                      : formatMoney(
                          sales
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
    </div>
  );
}
