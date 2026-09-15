"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AccountChip } from "@/components/account-chip";
import { BrandHomeLink } from "@/components/brand-home-link";
import { HomeNavButton } from "@/components/home-nav-button";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
import { StatStrip } from "@/components/stat-strip";
import { SheetRangePicker } from "@/components/sheet-range-picker";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { getCommissionRate } from "@/lib/commission";
import {
  addSheet,
  findMonth,
  mapMonth,
  monthLabel,
} from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, salesFromMonth, summarizeMonth, summarizeSheet } from "@/lib/summaries";
import { useTrackerStore } from "@/lib/tracker-store";
import { usePayTiers } from "@/lib/org-store";
import { MAX_SHEETS_PER_MONTH } from "@/lib/types";

type MonthPageProps = {
  monthId: string;
};

export function MonthPage({ monthId }: MonthPageProps) {
  const [state, setState] = useTrackerStore();
  const payTiers = usePayTiers();
  const router = useRouter();
  const month = findMonth(state, monthId);

  if (!month) {
    return (
      <div className="workbook">
        <header className="workbook-bar">
          <div>
            <BrandHomeLink />
            <AccountChip />
          </div>
        </header>
        <section className="summary-card">
          <h2>Month not found</h2>
          <p className="empty-note">That month is not on this tracker.</p>
          <div className="toolbar-left">
            <HomeNavButton placement="toolbar" />
            <Button nativeButton={false} render={<Link href="/" />}>
              Back to all months
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const activeMonth = month;
  const totals = summarizeMonth(activeMonth, payTiers);
  const canAddSheet = activeMonth.sheets.length < MAX_SHEETS_PER_MONTH;

  function handleAddSheet() {
    const result = addSheet(state, monthId);
    if ("error" in result) {
      window.alert(result.error);
      return;
    }
    setState(result.state);
  }

  function renameSheet(sheetId: string, range: { startDay: number; endDay: number }) {
    setState((current) =>
      mapMonth(current, monthId, (record) => ({
        ...record,
        sheets: record.sheets.map((sheet) =>
          sheet.id === sheetId ? { ...sheet, ...range } : sheet,
        ),
      })),
    );
  }

  function removeSheet(sheetId: string) {
    const sheet = activeMonth.sheets.find((item) => item.id === sheetId);
    if (!sheet) return;
    const label = sheetRangeLabel(
      sheet.startDay,
      sheet.endDay,
      activeMonth.year,
      activeMonth.month,
    );
    if (sheet.sales.length > 0 && !window.confirm(`Remove ${label} and its deals?`)) {
      return;
    }
    setState((current) =>
      mapMonth(current, monthId, (record) => ({
        ...record,
        sheets: record.sheets.filter((item) => item.id !== sheetId),
      })),
    );
  }

  function removeMonth() {
    if (!window.confirm(`Remove ${monthLabel(activeMonth.year, activeMonth.month)} and both sheets?`)) {
      return;
    }
    setState((current) => ({
      ...current,
      months: current.months.filter((item) => item.id !== monthId),
    }));
    router.push("/");
  }

  return (
    <div className="workbook">
      <header className="workbook-bar">
        <div>
          <BrandHomeLink pageTitle={monthLabel(activeMonth.year, activeMonth.month)} />
          <p className="header-sub">
            Two worksheets max. Pick a date range for each, like 1st–15th and 16th–end. Pack is
            figured on each worksheet, then added together here.
          </p>
          <AccountChip />
        </div>
        <StatStrip totals={totals} extra={dealTypeStatExtras(salesFromMonth(activeMonth))} />
      </header>

      <div className="toolbar">
        <div className="toolbar-left">
          <HomeNavButton placement="toolbar" />
          <Button nativeButton={false} variant="outline" render={<Link href="/" />}>
            <ArrowLeft data-icon="inline-start" />
            All months
          </Button>
        </div>
        <div className="toolbar-actions">
          {canAddSheet ? (
            <Button onClick={handleAddSheet}>
              <Plus data-icon="inline-start" />
              Add sales sheet
            </Button>
          ) : (
            <p className="sheet-cap-note">Two worksheets in this month is the maximum.</p>
          )}
          <PushToEmployeeButton />
          <Button variant="destructive" onClick={removeMonth}>
            <Trash2 data-icon="inline-start" />
            Remove month
          </Button>
        </div>
      </div>

      {activeMonth.sheets.length === 0 ? (
        <section className="summary-card">
          <h2>No sheets yet</h2>
          <p className="empty-note">
            Add up to two worksheets for {monthLabel(activeMonth.year, activeMonth.month)}. Use
            1st–15th and 16th–end, or any days you run.
          </p>
        </section>
      ) : (
        <section className="sheet-grid">
          {activeMonth.sheets.map((sheet) => {
            const sheetTotals = summarizeSheet(sheet, payTiers);
            const rate = getCommissionRate(sheetTotals.units, payTiers);
            return (
              <article key={sheet.id} className="sheet-card">
                <h3>
                  {sheetRangeLabel(
                    sheet.startDay,
                    sheet.endDay,
                    activeMonth.year,
                    activeMonth.month,
                  )}
                </h3>
                <SheetRangePicker
                  year={activeMonth.year}
                  month={activeMonth.month}
                  startDay={sheet.startDay}
                  endDay={sheet.endDay}
                  onChange={(range) => renameSheet(sheet.id, range)}
                />
                <dl className="sheet-stats">
                  <div>
                    <dt>Units</dt>
                    <dd>{sheetTotals.units}</dd>
                  </div>
                  <div>
                    <dt>Pack</dt>
                    <dd>{formatPercent(rate)}</dd>
                  </div>
                  <div>
                    <dt>Trades</dt>
                    <dd>{sheetTotals.trades}</dd>
                  </div>
                  <div>
                    <dt>Pay</dt>
                    <dd>{formatMoney(sheetTotals.pay)}</dd>
                  </div>
                </dl>
                <div className="sheet-card-actions">
                  <Button nativeButton={false} render={<Link href={`/m/${monthId}/s/${sheet.id}`} />}>
                    Open sheet
                  </Button>
                  <Button variant="outline" onClick={() => removeSheet(sheet.id)}>
                    Remove
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="summary-card">
        <h2>{monthLabel(activeMonth.year, activeMonth.month)} totals</h2>
        <table className="mini-sheet">
          <tbody>
            <tr>
              <th scope="row">Units</th>
              <td>{totals.units}</td>
            </tr>
            <tr>
              <th scope="row">Trade-ins</th>
              <td>{totals.trades}</td>
            </tr>
            <tr>
              <th scope="row">Gross</th>
              <td>{formatMoney(totals.gross)}</td>
            </tr>
            <tr>
              <th scope="row">F &amp; I</th>
              <td>{formatMoney(totals.fi)}</td>
            </tr>
            <tr>
              <th scope="row">Service</th>
              <td>{formatMoney(totals.service)}</td>
            </tr>
            <tr>
              <th scope="row">Bonuses</th>
              <td>{formatMoney(totals.bonus)}</td>
            </tr>
            <tr>
              <th scope="row">Vacation pay</th>
              <td>{formatMoney(totals.vacation)}</td>
            </tr>
            <tr className="mini-grand">
              <th scope="row">Total pay</th>
              <td>{formatMoney(totals.pay)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
