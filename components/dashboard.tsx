"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { StatStrip } from "@/components/stat-strip";
import { VehicleTypesForm } from "@/components/vehicle-types-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { addMonth, currentMonth, currentYear, monthLabel } from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { summarizeAll, summarizeMonth } from "@/lib/summaries";
import { useTrackerStore } from "@/lib/tracker-store";
import { MONTH_NAMES } from "@/lib/types";

export function Dashboard() {
  const [state, setState] = useTrackerStore();
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [error, setError] = useState("");
  const combined = summarizeAll(state);

  function handleAddMonth() {
    const result = addMonth(state, year, month);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    setState(result.state);
    router.push(`/m/${result.monthId}`);
  }

  return (
    <div className="workbook">
      <header className="workbook-bar">
        <div>
          <p className="workbook-kicker">Sales commission</p>
          <h1>Pay Tracker</h1>
          <p className="header-sub">Running total across every month on file.</p>
        </div>
        <StatStrip totals={combined} extra={[{ label: "Months", value: String(state.months.length) }]} />
      </header>

      <section className="summary-card combined-card">
        <h2>All months combined</h2>
        {state.months.length === 0 ? (
          <p className="empty-note">
            No months yet. Add January, February, or any month below — each one can hold two
            worksheets with date ranges like 1st–15th.
          </p>
        ) : (
          <table className="mini-sheet">
            <tbody>
              <tr>
                <th scope="row">Units sold</th>
                <td>{combined.units}</td>
              </tr>
              <tr>
                <th scope="row">Trade-ins</th>
                <td>{combined.trades}</td>
              </tr>
              <tr>
                <th scope="row">Gross</th>
                <td>{formatMoney(combined.gross)}</td>
              </tr>
              <tr>
                <th scope="row">F &amp; I</th>
                <td>{formatMoney(combined.fi)}</td>
              </tr>
              <tr>
                <th scope="row">Service</th>
                <td>{formatMoney(combined.service)}</td>
              </tr>
              <tr>
                <th scope="row">Flats</th>
                <td>{formatMoney(combined.flat)}</td>
              </tr>
              <tr>
                <th scope="row">Bonuses</th>
                <td>{formatMoney(combined.bonus)}</td>
              </tr>
              <tr>
                <th scope="row">Vacation pay</th>
                <td>{formatMoney(combined.vacation)}</td>
              </tr>
              <tr className="mini-grand">
                <th scope="row">Total pay</th>
                <td>{formatMoney(combined.pay)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <VehicleTypesForm
        types={state.vehicleTypes ?? []}
        onChange={(vehicleTypes) => setState((current) => ({ ...current, vehicleTypes }))}
      />

      <section className="summary-card add-month-card">
        <h2>Add a month</h2>
        <div className="add-month-form">
          <label>
            Month
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <Button onClick={handleAddMonth}>
            <Plus data-icon="inline-start" />
            Add {MONTH_NAMES[month - 1]}
          </Button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="month-list">
        {state.months.map((record) => {
          const totals = summarizeMonth(record);
          return (
            <Link key={record.id} href={`/m/${record.id}`} className="month-card">
              <div>
                <h3>{monthLabel(record.year, record.month)}</h3>
                <p>
                  {record.sheets.length === 0
                    ? "No worksheets yet"
                    : record.sheets
                        .map((sheet) =>
                          sheetRangeLabel(sheet.startDay, sheet.endDay, record.year, record.month),
                        )
                        .join(" · ")}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Units</dt>
                  <dd>{totals.units}</dd>
                </div>
                <div>
                  <dt>Trades</dt>
                  <dd>{totals.trades}</dd>
                </div>
                <div>
                  <dt>Pay</dt>
                  <dd>{formatMoney(totals.pay)}</dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
