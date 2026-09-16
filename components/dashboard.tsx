"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CloudStatusCard } from "@/components/cloud-status-card";
import { AccountChip } from "@/components/account-chip";
import { BrandHomeLink } from "@/components/brand-home-link";
import { CheckForUpdatesButton } from "@/components/check-for-updates-button";
import { EmployeeEntryCard } from "@/components/employee-entry-card";
import { JoinDealershipBanner } from "@/components/join-dealership-card";
import { PayPushNotice } from "@/components/pay-push-notice";
import { HomePushReviewDock } from "@/components/manager-review-modal";
import { OrgPanel } from "@/components/org-panel";
import { StatStrip } from "@/components/stat-strip";
import { VehicleTypesForm } from "@/components/vehicle-types-form";
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
import { canManageOrg } from "@/lib/roles";
import { adminMasterSheetTitle } from "@/lib/admin-employee-sheets";

export function Dashboard() {
  const [state, setState] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const entryRepId = useEntryRepId();
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [error, setError] = useState("");
  const combined = summarizeAll(state, payTiers);
  const entryRep = org.people.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile?.role);
  const adminOverlay = Boolean(entryRep && admin);
  const masterTitle = entryRep && adminOverlay ? adminMasterSheetTitle(displayName(entryRep)) : null;
  const showCombinedCard = Boolean(entryRep) || !admin;

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

  return (
    <div className="workbook">
      <HomePushReviewDock />
      <header className="workbook-bar">
        <div>
          <BrandHomeLink pageTitle={masterTitle ?? undefined} />
          <p className="header-sub">
            {masterTitle
              ? "Independent admin ledger for this employee. Edits save here immediately and never change the rep’s working sheet. Push copies a comparison snapshot only."
              : entryRep
                ? `Staging buffer for ${displayName(entryRep)}. Push to send without overwriting live data.`
                : "Running total across every month on file."}
          </p>
          <AccountChip />
        </div>
          <StatStrip totals={combined} extra={[{ label: "Months", value: String(state.months.length) }, ...dealTypeStatExtras(salesFromState(state))]} />
      </header>

      <CloudStatusCard />
      <PayPushNotice />
      <JoinDealershipBanner />
      <OrgPanel />
      <EmployeeEntryCard />

      {showCombinedCard ? (
      <section className="summary-card combined-card">
          <h2>
            {masterTitle
              ? masterTitle
              : entryRep
                ? `Staging buffer · ${displayName(entryRep)}`
                : "All months combined"}
          </h2>
        {state.months.length === 0 ? (
          <p className="empty-note">
            {masterTitle
              ? "No months yet on this employee’s admin master sheet. Add January, February, or any month below — deals, bonuses, and vacation pay stay on your ledger until you push."
              : "No months yet. Add January, February, or any month below — each one can hold two worksheets with date ranges like 1st–15th."}
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
        {state.months.length > 0 ? (
          <div className="deal-type-block">
            <h3 className="deal-type-heading">By deal type</h3>
            <DealTypeSummary sales={salesFromState(state)} />
          </div>
        ) : null}
      </section>
      ) : null}

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
          <CheckForUpdatesButton />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="month-list">
        {state.months.map((record) => {
          const totals = summarizeMonth(record, payTiers);
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
