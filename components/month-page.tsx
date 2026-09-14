"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { StatStrip } from "@/components/stat-strip";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { getCommissionRate } from "@/lib/commission";
import {
  addSheet,
  findMonth,
  mapMonth,
  monthLabel,
} from "@/lib/records";
import { summarizeMonth, summarizeSheet } from "@/lib/summaries";
import { useTrackerStore } from "@/lib/tracker-store";
import { MAX_SHEETS_PER_MONTH } from "@/lib/types";

type MonthPageProps = {
  monthId: string;
};

export function MonthPage({ monthId }: MonthPageProps) {
  const [state, setState] = useTrackerStore();
  const router = useRouter();
  const month = findMonth(state, monthId);

  if (!month) {
    return (
      <div className="workbook">
        <section className="summary-card">
          <h2>Month not found</h2>
          <p className="empty-note">That month is not on this tracker.</p>
          <Button nativeButton={false} render={<Link href="/" />}>
            Back to all months
          </Button>
        </section>
      </div>
    );
  }

  const activeMonth = month;
  const totals = summarizeMonth(activeMonth);
  const canAddSheet = activeMonth.sheets.length < MAX_SHEETS_PER_MONTH;

  function handleAddSheet() {
    const result = addSheet(state, monthId);
    if ("error" in result) {
      window.alert(result.error);
      return;
    }
    setState(result.state);
  }

  function renameSheet(sheetId: string, name: string) {
    setState((current) =>
      mapMonth(current, monthId, (record) => ({
        ...record,
        sheets: record.sheets.map((sheet) =>
          sheet.id === sheetId ? { ...sheet, name } : sheet,
        ),
      })),
    );
  }

  function removeSheet(sheetId: string) {
    const sheet = activeMonth.sheets.find((item) => item.id === sheetId);
    if (!sheet) return;
    if (sheet.sales.length > 0 && !window.confirm(`Remove ${sheet.name} and its deals?`)) {
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
          <p className="workbook-kicker">Monthly recap</p>
          <h1>{monthLabel(activeMonth.year, activeMonth.month)}</h1>
          <p className="header-sub">
            Two sales sheets max. Pack is figured on each sheet, then added together here.
          </p>
        </div>
        <StatStrip totals={totals} />
      </header>

      <div className="toolbar">
        <Button nativeButton={false} variant="outline" render={<Link href="/" />}>
          <ArrowLeft data-icon="inline-start" />
          All months
        </Button>
        <div className="toolbar-actions">
          {canAddSheet ? (
            <Button onClick={handleAddSheet}>
              <Plus data-icon="inline-start" />
              Add sales sheet
            </Button>
          ) : (
            <p className="sheet-cap-note">Two sheets in this month is the maximum.</p>
          )}
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
            Add up to two sales sheets for {monthLabel(activeMonth.year, activeMonth.month)}. Use one for
            the 1st–15th and one for the 16th–end, or any split you run.
          </p>
        </section>
      ) : (
        <section className="sheet-grid">
          {activeMonth.sheets.map((sheet) => {
            const sheetTotals = summarizeSheet(sheet);
            const rate = getCommissionRate(sheetTotals.units);
            return (
              <article key={sheet.id} className="sheet-card">
                <input
                  aria-label="Sheet name"
                  value={sheet.name}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => renameSheet(sheet.id, event.target.value)}
                  className="sheet-name-input"
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
