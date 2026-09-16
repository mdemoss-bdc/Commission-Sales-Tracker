"use client";

import { PrintEmployeeHeader } from "@/components/print-employee-header";
import { SalesSheet } from "@/components/sales-sheet";
import { StatStrip } from "@/components/stat-strip";
import { getCommissionRate, sumField } from "@/lib/commission";
import { formatMoney, formatPercent } from "@/lib/format";
import { comparedSalesForReview, matchingBaselineSheet } from "@/lib/manager-review-sheet";
import { monthLabel } from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, printAddonRows, summarizeSheet } from "@/lib/summaries";
import { NO_CAR_DEALS_EMPTY_NOTE, PRINT_SHEET_CONTAINER_CLASS } from "@/lib/admin-print";
import { rangeForSplit, type PayPeriodIdentity } from "@/lib/pay-period";
import { usePayTiers } from "@/lib/org-store";
import type { MonthRecord, PaySheet, TrackerState } from "@/lib/types";
import type { UserProfile } from "@/lib/roles";

export function PrintWorksheet({
  person,
  month,
  sheets,
  vehicleTypes,
  reviewBaseline,
  period,
  emptyDealsNote = NO_CAR_DEALS_EMPTY_NOTE,
}: {
  person: UserProfile;
  month: MonthRecord;
  sheets: PaySheet[];
  vehicleTypes: { id: string; label: string }[];
  reviewBaseline?: TrackerState | null;
  period?: PayPeriodIdentity | null;
  emptyDealsNote?: string;
}) {
  const pages = sheets.length > 0 ? sheets : [emptySheetForPeriod(month, period)];
  return (
    <div className={`${PRINT_SHEET_CONTAINER_CLASS} print-fit finalized-print-body`}>
      {pages.map((sheet, index) => (
        <PrintWorksheetPage
          key={sheet.id || `sheet-${index}`}
          person={person}
          month={month}
          sheet={sheet}
          vehicleTypes={vehicleTypes}
          reviewBaseline={reviewBaseline}
          emptyDealsNote={emptyDealsNote}
        />
      ))}
    </div>
  );
}

function emptySheetForPeriod(month: MonthRecord, period?: PayPeriodIdentity | null): PaySheet {
  const split =
    period?.split && period.split !== "unknown"
      ? period.split
      : period?.raw?.includes("16") || period?.key?.includes("part2")
        ? "part2"
        : "part1";
  const range = rangeForSplit(split === "full" ? "full" : split === "part2" ? "part2" : "part1", month.year, month.month);
  return {
    id: period?.key ?? "empty",
    startDay: range.startDay,
    endDay: range.endDay,
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
  reviewBaseline,
  emptyDealsNote,
}: {
  person: UserProfile;
  month: MonthRecord;
  sheet: PaySheet;
  vehicleTypes: { id: string; label: string }[];
  reviewBaseline?: TrackerState | null;
  emptyDealsNote: string;
}) {
  const tiers = usePayTiers();
  const totals = summarizeSheet(sheet, tiers);
  const rate = getCommissionRate(totals.units, tiers);
  const frontEnd = totals.gross * rate;
  const review = reviewBaseline
    ? comparedSalesForReview(matchingBaselineSheet(reviewBaseline, month, sheet), sheet)
    : null;
  const baselineSheet = reviewBaseline ? matchingBaselineSheet(reviewBaseline, month, sheet) : null;
  const baselineTotals = baselineSheet ? summarizeSheet(baselineSheet, tiers) : null;
  const baselinePack = baselineTotals
    ? baselineTotals.gross * getCommissionRate(baselineTotals.units, tiers)
    : 0;
  const printDealTotals = [
    { label: "Gross", value: formatMoney(totals.gross), changed: Boolean(baselineTotals && baselineTotals.gross !== totals.gross) },
    { label: "Pack", value: formatMoney(frontEnd), changed: Boolean(baselineTotals && baselinePack !== frontEnd) },
    { label: "Trades", value: String(totals.trades), changed: Boolean(baselineTotals && baselineTotals.trades !== totals.trades) },
    { label: "Flats", value: formatMoney(sumField(sheet.sales, "flat")), changed: Boolean(baselineTotals && baselineTotals.flat !== totals.flat) },
    { label: "Service", value: formatMoney(sumField(sheet.sales, "service")), changed: Boolean(baselineTotals && baselineTotals.service !== totals.service) },
    { label: "F&I", value: formatMoney(sumField(sheet.sales, "fi")), changed: Boolean(baselineTotals && baselineTotals.fi !== totals.fi) },
  ];
  const addonRows = printAddonRows({
    totals,
    vacationHours: sheet.vacationHours ?? 0,
    vacationRate: sheet.vacationRate ?? 0,
  });
  const range = sheetRangeLabel(sheet.startDay, sheet.endDay, month.year, month.month);
  const vacationChanged = Boolean(review?.extras.hours || review?.extras.rate || review?.extras.pay);
  const totalChanged = Boolean(baselineTotals && baselineTotals.pay !== totals.pay);

  return (
    <div className="finalized-print-page flex flex-col gap-6">
      <header className="workbook-bar print-ready-banner">
        <div>
          <p className="workbook-kicker print-heading">{monthLabel(month.year, month.month)}</p>
          <p className="header-sub print-heading">
            {range} · Pack {formatPercent(rate)} · {totals.trades} trade-ins
          </p>
          <PrintEmployeeHeader person={person} alwaysShow />
        </div>
        <div className="workbook-bar-end">
          <StatStrip
            totals={totals}
            hideOnPrint={false}
            extra={[{ label: "Pack", value: formatPercent(rate) }, ...dealTypeStatExtras(sheet.sales ?? [])]}
          />
        </div>
      </header>
      <div className="workspace print-ready-stack flex flex-col gap-6">
        <div className="sheet-column w-full overflow-x-auto">
          <SalesSheet
            sales={review?.sales ?? sheet.sales ?? []}
            monthSales={sheet.sales ?? []}
            vehicleTypes={vehicleTypes}
            onUpdate={() => undefined}
            onRemove={() => undefined}
            readOnly
            compared={review?.compared}
            emptyNote={emptyDealsNote}
          />
        </div>
        <aside className="totals-panel flex w-full flex-col gap-4">
          <section className="summary-card section-totals-card w-full">
            <h2>Section totals</h2>
            <dl className="section-totals-print print-ready-totals grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {printDealTotals.map((item) => (
                <div
                  key={item.label}
                  className={[
                    "section-total-pill min-w-0 p-3",
                    item.changed ? "sheet-compare-cell extra-compare-field" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <table className="print-addons print-ready-addons">
              <caption>Vacation</caption>
              <tbody>
                {addonRows
                  .filter((row) => row.kind !== "grand")
                  .map((row) => (
                    <tr
                      key={row.key}
                      className={row.kind === "vacation" && vacationChanged ? "sheet-compare-cell" : undefined}
                    >
                      <th scope="row">
                        <span className="print-addon-label">{row.label}</span>
                        {row.detail ? <span className="print-addon-detail">{row.detail}</span> : null}
                      </th>
                      <td>{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                {(sheet.bonuses ?? []).map((bonus) => (
                  <tr
                    key={bonus.id}
                    className={review?.extras.bonusIds.has(bonus.id) ? "sheet-compare-cell" : undefined}
                  >
                    <th scope="row">
                      <span className="print-addon-label">{bonus.label || "Bonus"}</span>
                    </th>
                    <td>{formatMoney(bonus.amount)}</td>
                  </tr>
                ))}
                {addonRows
                  .filter((row) => row.kind === "grand")
                  .map((row) => (
                    <tr
                      key={row.key}
                      className={["print-addon-grand", totalChanged ? "sheet-compare-cell" : ""]
                        .filter(Boolean)
                        .join(" ")}
                    >
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
