"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Trash2 } from "lucide-react";
import { DuplicateSaleWarning } from "@/components/duplicate-sale-warning";
import { MoneyCell } from "@/components/money-cell";
import {
  countTrades,
  countUnits,
  frontEndPay,
  getCommissionRate,
  saleCommission,
  saleHasData,
  shouldAppendLeadRowOnTab,
  sumField,
} from "@/lib/commission";
import { duplicateSaleIds } from "@/lib/duplicate-sales";
import { formatMoney } from "@/lib/format";
import { useOrg, usePayTiers } from "@/lib/org-store";
import { canReviewDeals } from "@/lib/roles";
import { optionsForSelect } from "@/lib/vehicles";
import type { ComparedSale, SaleCompareField } from "@/lib/sheet-compare";
import type { Sale, VehicleTypeOption } from "@/lib/types";

export type SalesSheetProps = {
  sales: Sale[];
  vehicleTypes: VehicleTypeOption[];
  onUpdate: (id: string, patch: Partial<Sale>) => void;
  onRemove: (id: string) => void;
  onAddRow?: () => void;
  onConfirmDuplicate?: (id: string) => void;
  onRemoveDuplicate?: (id: string) => void;
  monthSales?: Sale[];
  firstInputRef?: RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
  compared?: ComparedSale[];
  emptyNote?: string;
  /** When omitted, Deal Type is shown for sales reps only (hidden for admin/manager). */
  showDealType?: boolean;
  /** When false, hides the Trade checkbox column (used for print layouts). Default true. */
  showTrade?: boolean;
};

const COLUMNS = [
  "Stock #",
  "Customer name",
  "Deal Type",
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

function CompareCell({
  compared,
  field,
  children,
}: {
  compared?: ComparedSale;
  field?: SaleCompareField;
  children: ReactNode;
}) {
  return <td className={cellClass(compared, field)}>{children}</td>;
}

export function SalesSheet({
  sales,
  vehicleTypes,
  onUpdate,
  onRemove,
  onAddRow,
  onConfirmDuplicate,
  onRemoveDuplicate,
  monthSales,
  firstInputRef,
  readOnly = false,
  compared,
  emptyNote = "No sales yet. Click Add New Sale to log a deal.",
  showDealType,
  showTrade = true,
}: SalesSheetProps) {
  const org = useOrg();
  const includeDealType = showDealType ?? !canReviewDeals(org.profile?.role);
  const includeTrade = showTrade;
  const visibleColumns = COLUMNS.filter((header) => {
    if (header === "Deal Type" && !includeDealType) return false;
    if (header === "Trade" && !includeTrade) return false;
    return true;
  });
  const tiers = usePayTiers();
  const units = countUnits(sales);
  const rate = getCommissionRate(units, tiers);
  const trades = countTrades(sales);
  const fallbackFirstInputRef = useRef<HTMLInputElement>(null);
  const stockInputRef = firstInputRef ?? fallbackFirstInputRef;
  const pendingNewRowFocus = useRef(false);
  const duplicates = duplicateSaleIds(monthSales ?? sales);

  useEffect(() => {
    if (!pendingNewRowFocus.current) return;
    const timer = window.setTimeout(() => {
      pendingNewRowFocus.current = false;
      stockInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sales.length, stockInputRef]);

  function handleLastFieldKeyDown(sale: Sale, isLastRow: boolean, event: KeyboardEvent<HTMLInputElement>) {
    if (
      !onAddRow ||
      !shouldAppendLeadRowOnTab(event, {
        isLastRow,
        rowHasContent: saleHasData(sale),
        readOnly,
      })
    ) {
      return;
    }
    event.preventDefault();
    pendingNewRowFocus.current = true;
    onAddRow();
  }

  const totalGross = sumField(sales, "gross");
  const totalFlat = sumField(sales, "flat");
  const totalFi = sumField(sales, "fi");
  const totalService = sumField(sales, "service");
  const totalCommission = sales.reduce((sum, sale) => sum + saleCommission(sale, rate), 0);
  // Pack label spans Stock + Customer + optional Deal Type + optional Trade
  const packLabelSpan = 2 + (includeDealType ? 1 : 0) + (includeTrade ? 1 : 0);
  const packTrailingSpan = 5;
  const tableClass = [
    "sheet-table",
    includeDealType ? "" : "compact",
    includeTrade ? "" : "sheet-table-no-trade",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="sheet-frame">
      <div className="sheet-scroll">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className="row-head" scope="col">
                #
              </th>
              {visibleColumns.map((header) => (
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
                <td colSpan={visibleColumns.length + 1} className="empty-cell">
                  {emptyNote}
                </td>
              </tr>
            ) : (
              sales.map((sale, index) => {
                const row = comparedFor(sale.id, compared);
                const isDuplicate = duplicates.has(sale.id);
                const rowClass = [
                  row?.kind === "extra" ? "sheet-compare-row sheet-compare-added" : "",
                  row?.kind === "missing" ? "sheet-compare-row sheet-compare-removed" : "",
                  row?.kind === "matched" && row.fields.length > 0 ? "sheet-compare-edited" : "",
                  isDuplicate ? "duplicate-sale-row" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={sale.id} className={rowClass || undefined} data-compare-kind={row?.kind}>
                    <td className="row-head">
                      <span className="duplicate-sale-index">
                        {index + 1}
                        {isDuplicate ? (
                          <DuplicateSaleWarning
                            readOnly={readOnly}
                            onConfirm={onConfirmDuplicate ? () => onConfirmDuplicate(sale.id) : undefined}
                            onDelete={() => (onRemoveDuplicate ?? onRemove)(sale.id)}
                          />
                        ) : null}
                      </span>
                    </td>
                    <CompareCell compared={row} field="stockNumber">
                      <input
                        ref={index === sales.length - 1 ? stockInputRef : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        readOnly={readOnly}
                        aria-label={`Stock number, row ${index + 1}`}
                        value={sale.stockNumber}
                        onChange={(event) => onUpdate(sale.id, { stockNumber: event.target.value })}
                        className="sheet-input"
                      />
                    </CompareCell>
                    <CompareCell compared={row} field="customerName">
                      <input
                        autoComplete="off"
                        readOnly={readOnly}
                        aria-label={`Customer name, row ${index + 1}`}
                        value={sale.customerName}
                        onChange={(event) => onUpdate(sale.id, { customerName: event.target.value })}
                        className="sheet-input"
                      />
                    </CompareCell>
                    {includeDealType ? (
                      <CompareCell compared={row} field="vehicleType">
                        <select
                          aria-label={`Deal type, row ${index + 1}`}
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
                    ) : null}
                    {includeTrade ? (
                      <CompareCell compared={row} field="tradeIn">
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
                    ) : null}
                    <CompareCell compared={row} field="gross">
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
                    <CompareCell compared={row} field="flat">
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
                    <CompareCell compared={row} field="fi">
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
                    <CompareCell compared={row} field="service">
                      {readOnly ? (
                        <span className="formula-cell">{formatMoney(sale.service)}</span>
                      ) : (
                        <MoneyCell
                          value={sale.service}
                          ariaLabel={`Service, row ${index + 1}`}
                          onChange={(service) => onUpdate(sale.id, { service })}
                          onKeyDown={(event) => handleLastFieldKeyDown(sale, index === sales.length - 1, event)}
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
              {includeDealType ? <td /> : null}
              {includeTrade ? <td className="formula-cell">{trades}</td> : null}
              <td className="formula-cell">{formatMoney(totalGross)}</td>
              <td className="formula-cell">{formatMoney(totalFlat)}</td>
              <td className="formula-cell">{formatMoney(totalFi)}</td>
              <td className="formula-cell">{formatMoney(totalService)}</td>
              <td className="formula-cell grand">{formatMoney(totalCommission)}</td>
              <td />
            </tr>
            <tr className="pack-row">
              <td className="row-head" />
              <td colSpan={packLabelSpan} className="total-label">
                Front-end pack ({Math.round(rate * 100)}% of gross)
              </td>
              <td className="formula-cell">{formatMoney(frontEndPay(totalGross, rate))}</td>
              <td colSpan={packTrailingSpan} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
