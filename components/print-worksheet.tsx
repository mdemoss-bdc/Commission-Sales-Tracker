"use client";

import { PrintEmployeeHeader } from "@/components/print-employee-header";
import { SalesSheet } from "@/components/sales-sheet";
import { StatStrip } from "@/components/stat-strip";
import { getCommissionRate, sumField } from "@/lib/commission";
import { formatMoney, formatPercent } from "@/lib/format";
import { monthLabel } from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, printAddonRows, summarizeSheet } from "@/lib/summaries";
import { usePayTiers } from "@/lib/org-store";
import type { MonthRecord, PaySheet } from "@/lib/types";
import type { UserProfile } from "@/lib/roles";

export function PrintWorksheet({
  person,
  month,
  sheets,
  vehicleTypes,
}: {
  person: UserProfile;
  month: MonthRecord;
  sheets: PaySheet[];
  vehicleTypes: { id: string; label: string }[];
}) {
  const pages = sheets.length > 0 ? sheets : [emptySheet()];
  return (
    <div className="print-fit finalized-print-body">
      {pages.map((sheet, index) => (
        <PrintWorksheetPage
          key={sheet.id || `sheet-${index}`}
          person={person}
          month={month}
          sheet={sheet}
          vehicleTypes={vehicleTypes}
        />
      ))}
    </div>
  );
}

function emptySheet(): PaySheet {
  return {
    id: "empty",
    startDay: 1,
    endDay: 15,
    sales: [],
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 0,
    bonuses: [],
  };
}

function PrintWorksheetPage({
  person,
  month,
  sheet,
  vehicleTypes,
}: {
  person: UserProfile;
  month: MonthRecord;
  sheet: PaySheet;
  vehicleTypes: { id: string; label: string }[];
}) {
  const tiers = usePayTiers();
  const totals = summarizeSheet(sheet, tiers);
  const rate = getCommissionRate(totals.units, tiers);
  const frontEnd = totals.gross * rate;
  const printDealTotals = [
    { label: "Gross", value: formatMoney(totals.gross) },
    { label: "Pack", value: formatMoney(frontEnd) },
    { label: "Trades", value: String(totals.trades) },
    { label: "Flats", value: formatMoney(sumField(sheet.sales, "flat")) },
    { label: "Service", value: formatMoney(sumField(sheet.sales, "service")) },
    { label: "F&I", value: formatMoney(sumField(sheet.sales, "fi")) },
  ];
  const addonRows = printAddonRows({
    totals,
    vacationHours: sheet.vacationHours ?? 0,
    vacationRate: sheet.vacationRate ?? 0,
  });
  const range = sheetRangeLabel(sheet.startDay, sheet.endDay, month.year, month.month);

  return (
    <div className="finalized-print-page">
      <header className="workbook-bar">
        <div>
          <p className="workbook-kicker print-heading">{monthLabel(month.year, month.month)}</p>
          <p className="header-sub print-heading">
            {range} · Pack {formatPercent(rate)} · {totals.trades} trade-ins
          </p>
        </div>
        <div className="workbook-bar-end">
          <PrintEmployeeHeader person={person} alwaysShow />
          <StatStrip
            totals={totals}
            extra={[{ label: "Pack", value: formatPercent(rate) }, ...dealTypeStatExtras(sheet.sales ?? [])]}
          />
        </div>
      </header>
      <div className="workspace print:flex print:flex-col">
        <div className="sheet-column">
          <SalesSheet
            sales={sheet.sales ?? []}
            monthSales={sheet.sales ?? []}
            vehicleTypes={vehicleTypes}
            onUpdate={() => undefined}
            onRemove={() => undefined}
            readOnly
            emptyNote="No sales on this finalized worksheet."
          />
        </div>
        <aside className="totals-panel flex flex-col gap-4 print:w-full">
          <section className="summary-card section-totals-card print:w-full">
            <h2>Section totals</h2>
            <dl className="section-totals-print print-ready-totals">
              {printDealTotals.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <table className="print-addons print-ready-addons">
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
        </aside>
      </div>
    </div>
  );
}
