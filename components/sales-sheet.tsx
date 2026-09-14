"use client";

import type { ReactNode, RefObject } from "react";
import { ArrowDown, Trash2 } from "lucide-react";
import { MoneyCell } from "@/components/money-cell";
import {
  countTrades,
  countUnits,
  frontEndPay,
  getCommissionRate,
  saleCommission,
  sumField,
} from "@/lib/commission";
import { formatMoney } from "@/lib/format";
import { DEAL_TYPES, dealTypeLabel, parseDealType } from "@/lib/deal-types";
import { optionsForSelect } from "@/lib/vehicles";
import type { ComparedSale, SaleCompareField } from "@/lib/sheet-compare";
import type { Sale, VehicleTypeOption } from "@/lib/types";

export type SalesSheetProps = {
  sales: Sale[];
  vehicleTypes: VehicleTypeOption[];
  onUpdate: (id: string, patch: Partial<Sale>) => void;
  onRemove: (id: string) => void;
  firstInputRef?: RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
  compared?: ComparedSale[];
  showCopy?: boolean;
  onCopyField?: (saleId: string, field: SaleCompareField) => void;
  emptyNote?: string;
};

const dealColumns = [
  "Stock #",
  "Customer name",
  "Deal type",
  "Vehicle",
  "Trade",
  "Gross",
  "Flat",
  "F & I",
  "Service",
  "Commission",
] as const;

function comparedFor(saleId: string, compared?: ComparedSale[]): ComparedSale | undefined {
  return compared?.find((row) => row.sale.id === saleId);
}

function cellClass(compared: ComparedSale | undefined, field?: SaleCompareField): string {
  if (!compared) return "";
  if (compared.kind === "extra" || compared.kind === "missing") return "sheet-compare-row-cell";
  if (field && compared.fields.includes(field)) return "sheet-compare-cell";
  return "";
}

function CopyMyValue({
  show,
  label,
  onCopy,
}: {
  show: boolean;
  label: string;
  onCopy: () => void;
}) {
  if (!show) return null;
  return (
    <button type="button" className="copy-my-value" aria-label={`Copy my ${label}`} onClick={onCopy}>
      <ArrowDown className="size-3.5" />
      <span>Copy my value</span>
    </button>
  );
}

function CompareCell({
  compared,
  field,
  showCopy,
  onCopy,
  children,
}: {
  compared?: ComparedSale;
  field?: SaleCompareField;
  showCopy?: boolean;
  onCopy?: () => void;
  children: ReactNode;
}) {
  const highlighted = Boolean(
    compared && (compared.kind !== "matched" || (field && compared.fields.includes(field))),
  );
  return (
    <td className={cellClass(compared, field)}>
      <div className="sheet-compare-inner">
        {children}
        <CopyMyValue show={Boolean(showCopy && highlighted && onCopy)} label={field ?? "value"} onCopy={onCopy!} />
      </div>
    </td>
  );
}

export function SalesSheet({
  sales,
  vehicleTypes,
  onUpdate,
  onRemove,
  firstInputRef,
  readOnly = false,
  compared,
  showCopy = false,
  onCopyField,
  emptyNote = "No sales yet. Click Add New Sale to log a deal.",
}: SalesSheetProps) {
  const units = countUnits(sales);
  const rate = getCommissionRate(units);
  const trades = countTrades(sales);

  const totalGross = sumField(sales, "gross");
  const totalFlat = sumField(sales, "flat");
  const totalFi = sumField(sales, "fi");
  const totalService = sumField(sales, "service");
  const totalCommission = sales.reduce((sum, sale) => sum + saleCommission(sale, rate), 0);

  return (
    <div className="sheet-frame">
      <div className="sheet-scroll">
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="row-head" scope="col">
                #
              </th>
              {dealColumns.map((header) => (
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
                <td colSpan={dealColumns.length + 1} className="empty-cell">
                  {emptyNote}
                </td>
              </tr>
            ) : (
              sales.map((sale, index) => {
                const row = comparedFor(sale.id, compared);
                const copy = (field: SaleCompareField) =>
                  showCopy && row && (row.kind !== "matched" || row.fields.includes(field))
                    ? () => onCopyField?.(sale.id, field)
                    : undefined;
                return (
                  <tr key={sale.id} className={row && row.kind !== "matched" ? "sheet-compare-row" : undefined}>
                    <td className="row-head">{index + 1}</td>
                    <CompareCell compared={row} field="stockNumber" showCopy={showCopy} onCopy={copy("stockNumber")}>
                      <input
                        ref={index === sales.length - 1 ? firstInputRef : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        readOnly={readOnly}
                        aria-label={`Stock number, row ${index + 1}`}
                        value={sale.stockNumber}
                        onChange={(event) => onUpdate(sale.id, { stockNumber: event.target.value })}
                        className="sheet-input"
                      />
                    </CompareCell>
                    <CompareCell compared={row} field="customerName" showCopy={showCopy} onCopy={copy("customerName")}>
                      <input
                        autoComplete="off"
                        readOnly={readOnly}
                        aria-label={`Customer name, row ${index + 1}`}
                        value={sale.customerName}
                        onChange={(event) => onUpdate(sale.id, { customerName: event.target.value })}
                        className="sheet-input"
                      />
                    </CompareCell>
                    <CompareCell compared={row} field="dealType" showCopy={showCopy} onCopy={copy("dealType")}>
                      <select
                        aria-label={`Deal type, row ${index + 1}`}
                        value={parseDealType(sale.dealType)}
                        disabled={readOnly}
                        onChange={(event) =>
                          onUpdate(sale.id, {
                            dealType: parseDealType(event.target.value),
                          })
                        }
                        className="sheet-input"
                      >
                        {DEAL_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {dealTypeLabel(type)}
                          </option>
                        ))}
                      </select>
                    </CompareCell>
                    <CompareCell compared={row} field="vehicleType" showCopy={showCopy} onCopy={copy("vehicleType")}>
                      <select
                        aria-label={`Vehicle type, row ${index + 1}`}
                        value={sale.vehicleType}
                        disabled={readOnly}
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
                    </CompareCell>
                    <CompareCell compared={row} field="tradeIn" showCopy={showCopy} onCopy={copy("tradeIn")}>
                      <div className="check-cell">
                        <input
                          type="checkbox"
                          aria-label={`Trade-in, row ${index + 1}`}
                          checked={sale.tradeIn}
                          disabled={readOnly}
                          onChange={(event) => onUpdate(sale.id, { tradeIn: event.target.checked })}
                        />
                      </div>
                    </CompareCell>
                    <CompareCell compared={row} field="gross" showCopy={showCopy} onCopy={copy("gross")}>
                      {readOnly ? (
                        <span className="formula-cell">{formatMoney(sale.gross)}</span>
                      ) : (
                        <MoneyCell
                          value={sale.gross}
                          ariaLabel={`Gross, row ${index + 1}`}
                          onChange={(gross) => onUpdate(sale.id, { gross })}
                        />
                      )}
                    </CompareCell>
                    <CompareCell compared={row} field="flat" showCopy={showCopy} onCopy={copy("flat")}>
                      {readOnly ? (
                        <span className="formula-cell">{formatMoney(sale.flat)}</span>
                      ) : (
                        <MoneyCell
                          value={sale.flat}
                          ariaLabel={`Flat amount, row ${index + 1}`}
                          onChange={(flat) => onUpdate(sale.id, { flat })}
                        />
                      )}
                    </CompareCell>
                    <CompareCell compared={row} field="fi" showCopy={showCopy} onCopy={copy("fi")}>
                      {readOnly ? (
                        <span className="formula-cell">{formatMoney(sale.fi)}</span>
                      ) : (
                        <MoneyCell
                          value={sale.fi}
                          ariaLabel={`F&I, row ${index + 1}`}
                          onChange={(fi) => onUpdate(sale.id, { fi })}
                        />
                      )}
                    </CompareCell>
                    <CompareCell compared={row} field="service" showCopy={showCopy} onCopy={copy("service")}>
                      {readOnly ? (
                        <span className="formula-cell">{formatMoney(sale.service)}</span>
                      ) : (
                        <MoneyCell
                          value={sale.service}
                          ariaLabel={`Service, row ${index + 1}`}
                          onChange={(service) => onUpdate(sale.id, { service })}
                        />
                      )}
                    </CompareCell>
                    <td
                      className={`formula-cell ${
                        row &&
                        (row.kind !== "matched" ||
                          row.fields.some((field) => ["gross", "flat", "fi", "service"].includes(field)))
                          ? cellClass(row, "gross")
                          : ""
                      }`}
                    >
                      {formatMoney(saleCommission(sale, rate))}
                    </td>
                    <td className="action-cell">
                      {readOnly ? null : (
                        <button
                          type="button"
                          aria-label={`Remove sale ${index + 1}`}
                          onClick={() => onRemove(sale.id)}
                          className="remove-btn"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="row-head" />
              <td colSpan={2} className="total-label">
                TOTAL
              </td>
              <td />
              <td />
              <td className="formula-cell">{trades}</td>
              <td className="formula-cell">{formatMoney(totalGross)}</td>
              <td className="formula-cell">{formatMoney(totalFlat)}</td>
              <td className="formula-cell">{formatMoney(totalFi)}</td>
              <td className="formula-cell">{formatMoney(totalService)}</td>
              <td className="formula-cell grand">{formatMoney(totalCommission)}</td>
              <td />
            </tr>
            <tr className="pack-row">
              <td className="row-head" />
              <td colSpan={5} className="total-label">
                Front-end pack ({Math.round(rate * 100)}% of gross)
              </td>
              <td className="formula-cell">{formatMoney(frontEndPay(totalGross, rate))}</td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
