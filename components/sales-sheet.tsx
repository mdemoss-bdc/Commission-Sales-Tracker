"use client";

import type { RefObject } from "react";
import { Trash2 } from "lucide-react";
import { MoneyCell } from "@/components/money-cell";
import {
  backendPay,
  countTrades,
  countUnits,
  frontEndPay,
  getCommissionRate,
  saleCommission,
  sumField,
} from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import { optionsForSelect } from "@/lib/vehicles";
import type { Sale, SheetTab, VehicleTypeOption } from "@/lib/types";

type SalesSheetProps = {
  sales: Sale[];
  vehicleTypes: VehicleTypeOption[];
  tab: SheetTab;
  onUpdate: (id: string, patch: Partial<Sale>) => void;
  onRemove: (id: string) => void;
  firstInputRef: RefObject<HTMLInputElement | null>;
};

const dealColumns = [
  "Stock #",
  "Customer name",
  "Vehicle",
  "Trade",
  "Gross",
  "Flat",
  "F & I",
  "Service",
  "Commission",
] as const;

const backendColumns = [
  "Stock #",
  "Customer name",
  "F & I",
  "Service",
  "Backend total",
] as const;

export function SalesSheet({
  sales,
  vehicleTypes,
  tab,
  onUpdate,
  onRemove,
  firstInputRef,
}: SalesSheetProps) {
  const units = countUnits(sales);
  const rate = getCommissionRate(units);
  const trades = countTrades(sales);
  const isDeals = tab === "deals";
  const headers = isDeals ? dealColumns : backendColumns;

  const totalGross = sumField(sales, "gross");
  const totalFlat = sumField(sales, "flat");
  const totalFi = sumField(sales, "fi");
  const totalService = sumField(sales, "service");
  const totalCommission = sales.reduce(
    (sum, sale) => sum + saleCommission(sale, rate),
    0,
  );
  const totalBackend = sales.reduce((sum, sale) => sum + backendPay(sale), 0);

  return (
    <div className="sheet-frame">
      <div className="overflow-x-auto">
        <table className={isDeals ? "sheet-table" : "sheet-table compact"}>
          <thead>
            <tr>
              <th className="row-head" scope="col">
                #
              </th>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
              <th className="action-head" scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr>
                <td className="row-head">1</td>
                <td colSpan={headers.length + 1} className="empty-cell">
                  No sales yet. Click Add New Sale to log a deal.
                </td>
              </tr>
            ) : (
              sales.map((sale, index) => (
                <tr key={sale.id}>
                  <td className="row-head">{index + 1}</td>
                  <td>
                    <input
                      ref={index === sales.length - 1 ? firstInputRef : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`Stock number, row ${index + 1}`}
                      value={sale.stockNumber}
                      onChange={(event) =>
                        onUpdate(sale.id, { stockNumber: event.target.value })
                      }
                      className="sheet-input"
                    />
                  </td>
                  <td>
                    <input
                      autoComplete="off"
                      aria-label={`Customer name, row ${index + 1}`}
                      value={sale.customerName}
                      onChange={(event) =>
                        onUpdate(sale.id, { customerName: event.target.value })
                      }
                      className="sheet-input"
                    />
                  </td>
                  {isDeals ? (
                    <>
                      <td>
                        <select
                          aria-label={`Vehicle type, row ${index + 1}`}
                          value={sale.vehicleType}
                          onChange={(event) =>
                            onUpdate(sale.id, {
                              vehicleType: event.target.value,
                            })
                          }
                          className="sheet-input"
                        >
                          <option value="">Select</option>
                          {optionsForSelect(vehicleTypes, sale.vehicleType).map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.label.trim() || "Untitled"}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`Trade-in, row ${index + 1}`}
                          checked={sale.tradeIn}
                          onChange={(event) =>
                            onUpdate(sale.id, { tradeIn: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <MoneyCell
                          value={sale.gross}
                          ariaLabel={`Gross, row ${index + 1}`}
                          onChange={(gross) => onUpdate(sale.id, { gross })}
                        />
                      </td>
                      <td>
                        <MoneyCell
                          value={sale.flat}
                          ariaLabel={`Flat amount, row ${index + 1}`}
                          onChange={(flat) => onUpdate(sale.id, { flat })}
                        />
                      </td>
                    </>
                  ) : null}
                  <td>
                    <MoneyCell
                      value={sale.fi}
                      ariaLabel={`F&I, row ${index + 1}`}
                      onChange={(fi) => onUpdate(sale.id, { fi })}
                    />
                  </td>
                  <td>
                    <MoneyCell
                      value={sale.service}
                      ariaLabel={`Service, row ${index + 1}`}
                      onChange={(service) => onUpdate(sale.id, { service })}
                    />
                  </td>
                  <td className="formula-cell">
                    {formatMoney(
                      isDeals ? saleCommission(sale, rate) : backendPay(sale),
                    )}
                  </td>
                  <td className="action-cell">
                    <button
                      type="button"
                      aria-label={`Remove sale ${index + 1}`}
                      onClick={() => onRemove(sale.id)}
                      className="remove-btn"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="row-head" />
              <td colSpan={2} className="total-label">
                TOTAL
              </td>
              {isDeals ? (
                <>
                  <td />
                  <td className="formula-cell">{trades}</td>
                  <td className="formula-cell">{formatMoney(totalGross)}</td>
                  <td className="formula-cell">{formatMoney(totalFlat)}</td>
                </>
              ) : null}
              <td className="formula-cell">{formatMoney(totalFi)}</td>
              <td className="formula-cell">{formatMoney(totalService)}</td>
              <td className="formula-cell grand">
                {formatMoney(isDeals ? totalCommission : totalBackend)}
              </td>
              <td />
            </tr>
            {isDeals ? (
              <tr className="pack-row">
                <td className="row-head" />
                <td colSpan={4} className="total-label">
                  Front-end pack ({Math.round(rate * 100)}% of gross)
                </td>
                <td className="formula-cell">
                  {formatMoney(frontEndPay(totalGross, rate))}
                </td>
                <td colSpan={5} />
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
