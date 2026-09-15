import { formatMoney } from "@/lib/format";
import { vehicleLabel } from "@/lib/vehicles";
import type { Sale, VehicleTypeOption } from "@/lib/types";

type ByVehicleSectionProps = {
  sales: Sale[];
  vehicleTypes: VehicleTypeOption[];
};

export function ByVehicleSection({ sales, vehicleTypes }: ByVehicleSectionProps) {
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
                const gross = rows.reduce((sum, sale) => sum + sale.gross, 0);
                return (
                  <tr key={type.id} className="print:hidden">
                    <th scope="row">
                      {type.label.trim() || "Untitled"}
                      <span className="count-pill">{rows.length}</span>
                    </th>
                    <td>{formatMoney(gross)}</td>
                  </tr>
                );
              })}
              {sales.some((sale) => !sale.vehicleType) ? (
                <tr className="print:hidden">
                  <th scope="row">
                    Unspecified
                    <span className="count-pill">{sales.filter((sale) => !sale.vehicleType).length}</span>
                  </th>
                  <td>
                    {formatMoney(
                      sales.filter((sale) => !sale.vehicleType).reduce((sum, sale) => sum + sale.gross, 0),
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
