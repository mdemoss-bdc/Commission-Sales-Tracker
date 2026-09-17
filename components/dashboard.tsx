"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CloudStatusCard } from "@/components/cloud-status-card";
import { AccountChip } from "@/components/account-chip";
import { BrandHomeLink } from "@/components/brand-home-link";
import { CheckForUpdatesButton } from "@/components/check-for-updates-button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { EmployeeEntryCard } from "@/components/employee-entry-card";
import { JoinDealershipBanner } from "@/components/join-dealership-card";
import { PayPushNotice } from "@/components/pay-push-notice";
import { HomePushReviewDock } from "@/components/manager-review-modal";
import { OrgPanel } from "@/components/org-panel";
import { StatStrip } from "@/components/stat-strip";
import { DealTypeSummary } from "@/components/deal-type-summary";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { addMonth, currentMonth, currentYear, monthLabel } from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, salesFromState, summarizeAll, summarizeMonth } from "@/lib/summaries";
import { refreshFromCloud, useTrackerStore, useEntryRepId } from "@/lib/tracker-store";
import { useOrg, usePayTiers } from "@/lib/org-store";
import { MONTH_NAMES } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";

export function Dashboard() {
  const [state, setState] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const entryRepId = useEntryRepId();
  const router = useRouter();
  const [month, setMonth] = useState(() => currentMonth());
  const [year, setYear] = useState(() => currentYear());
  const [error, setError] = useState("");
  const [combinedYear, setCombinedYear] = useState(() => currentYear());
  const [fileMonth, setFileMonth] = useState<number | "">("");
  const [fileYear, setFileYear] = useState<number | "">("");
  const entryRep = org.people.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile?.role);
  const manager = canReviewDeals(org.profile?.role) && !admin;
  /** Personal workbook controls (months / staging) — sales reps only, not managers. */
  const showPersonalWorkbook = !admin && !manager;

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear()]);
    for (const record of state.months) {
      if (Number.isFinite(record.year)) years.add(record.year);
    }
    return [...years].sort((a, b) => b - a);
  }, [state.months]);

  const headerCombined = useMemo(() => summarizeAll(state, payTiers), [state, payTiers]);

  const yearScopedState = useMemo(
    () => ({ ...state, months: state.months.filter((record) => record.year === combinedYear) }),
    [state, combinedYear],
  );
  const combined = useMemo(() => summarizeAll(yearScopedState, payTiers), [yearScopedState, payTiers]);
  const combinedSales = useMemo(() => salesFromState(yearScopedState), [yearScopedState]);

  const fileFilterReady = fileMonth !== "" && fileYear !== "";
  const filteredMonths = useMemo(() => {
    if (!fileFilterReady) return [];
    return state.months.filter((record) => record.month === fileMonth && record.year === fileYear);
  }, [state.months, fileMonth, fileYear, fileFilterReady]);

  useEffect(() => {
    void refreshFromCloud();
  }, []);

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

  const headerSub = admin
    ? "Pick a store and pay period, then open any employee row to edit their Admin Master Sheet in a focused modal."
    : manager
      ? "Review store queues, authorize sheets, and submit ready pay to Admin."
      : entryRep
        ? `Staging buffer for ${displayName(entryRep)}. Push to send without overwriting live data.`
        : "Running total across every month on file.";

  return (
    <div className="workbook">
      <HomePushReviewDock />
      <header className="workbook-bar">
        <div>
          <BrandHomeLink />
          <p className="header-sub">{headerSub}</p>
          <AccountChip />
        </div>
        {showPersonalWorkbook ? (
          <StatStrip
            totals={headerCombined}
            extra={[{ label: "Months", value: String(state.months.length) }, ...dealTypeStatExtras(salesFromState(state))]}
          />
        ) : null}
      </header>

      <CloudStatusCard />
      <PayPushNotice />
      <JoinDealershipBanner />
      <OrgPanel />
      <EmployeeEntryCard />

      {showPersonalWorkbook ? (
        <>
          <CollapsibleCard
            title={
              entryRep
                ? `Staging buffer · ${displayName(entryRep)}`
                : `All months combined · ${combinedYear}`
            }
            className="combined-card"
          >
            <div className="dashboard-filter-row add-month-form">
              <label>
                Filter by Year:
                <select
                  value={combinedYear}
                  onChange={(event) => setCombinedYear(Number(event.target.value))}
                >
                  {availableYears.map((optionYear) => (
                    <option key={optionYear} value={optionYear}>
                      {optionYear}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="empty-note">Summary for {combinedYear}</p>
            {yearScopedState.months.length === 0 ? (
              <p className="empty-note">
                No months on file for {combinedYear}. Add a month below, or pick another year.
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
            {yearScopedState.months.length > 0 ? (
              <div className="deal-type-block">
                <h3 className="deal-type-heading">By deal type</h3>
                <DealTypeSummary sales={combinedSales} />
              </div>
            ) : null}
          </CollapsibleCard>

          <CollapsibleCard title="Add a month" className="add-month-card">
            <div className="add-month-form">
              <label>
                Month
                <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
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
              <CheckForUpdatesButton />
            </div>
            {error ? <p className="form-error">{error}</p> : null}
          </CollapsibleCard>

          <CollapsibleCard title="Months on file" className="month-list-card">
            <div className="dashboard-filter-row add-month-form">
              <label>
                Month
                <select
                  value={fileMonth === "" ? "" : String(fileMonth)}
                  onChange={(event) => {
                    const next = event.target.value;
                    setFileMonth(next === "" ? "" : Number(next));
                  }}
                >
                  <option value="">Select Month</option>
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select
                  value={fileYear === "" ? "" : String(fileYear)}
                  onChange={(event) => {
                    const next = event.target.value;
                    setFileYear(next === "" ? "" : Number(next));
                  }}
                >
                  <option value="">Select Year</option>
                  {availableYears.map((optionYear) => (
                    <option key={optionYear} value={optionYear}>
                      {optionYear}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!fileFilterReady ? (
              <p className="empty-note">Select a month and year above to view pay sheets on file.</p>
            ) : filteredMonths.length === 0 ? (
              <p className="empty-note">
                No pay sheets on file for {monthLabel(fileYear as number, fileMonth as number)}.
              </p>
            ) : (
              <section className="month-list">
                {filteredMonths.map((record) => {
                  const totals = summarizeMonth(record, payTiers);
                  return (
                    <Link
                      key={record.id}
                      href={entryRepId ? `/m/${record.id}?rep=${encodeURIComponent(entryRepId)}` : `/m/${record.id}`}
                      className="month-card"
                    >
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
            )}
          </CollapsibleCard>
        </>
      ) : null}
    </div>
  );
}
