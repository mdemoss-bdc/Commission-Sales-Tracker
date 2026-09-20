"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudStatusCard } from "@/components/cloud-status-card";
import { AccountChip } from "@/components/account-chip";
import { BrandHomeLink } from "@/components/brand-home-link";
import { CollapsibleCard } from "@/components/collapsible-card";
import { EmployeeEntryCard } from "@/components/employee-entry-card";
import { JoinDealershipBanner } from "@/components/join-dealership-card";
import { PayPushNotice } from "@/components/pay-push-notice";
import { HomePushReviewDock } from "@/components/manager-review-modal";
import { OrgPanel } from "@/components/org-panel";
import { StatStrip } from "@/components/stat-strip";
import { DealTypeSummary } from "@/components/deal-type-summary";
import { formatMoney } from "@/lib/format";
import { currentYear } from "@/lib/records";
import { dealTypeStatExtras, salesFromState, summarizeAll, summarizeMonth } from "@/lib/summaries";
import { refreshFromCloud, useTrackerStore, useEntryRepId } from "@/lib/tracker-store";
import { useOrg, usePayTiers } from "@/lib/org-store";
import { MONTH_NAMES } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg } from "@/lib/roles";

export function Dashboard() {
  const [state] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const entryRepId = useEntryRepId();
  const [combinedYear, setCombinedYear] = useState(() => currentYear());
  const [combinedMonth, setCombinedMonth] = useState<number | "all">("all");
  const entryRep = org.people.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile?.role);
  const manager = org.profile?.role === "manager";
  /** Personal workbook controls — sales reps only. Never on manager/admin screens. */
  const showPersonalWorkbook = org.profile?.role === "rep";

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
  const monthScopedRecord = useMemo(() => {
    if (combinedMonth === "all") return null;
    return yearScopedState.months.find((record) => record.month === combinedMonth) ?? null;
  }, [yearScopedState.months, combinedMonth]);
  const monthScoped = useMemo(
    () => (monthScopedRecord ? summarizeMonth(monthScopedRecord, payTiers, state.vehicleTypes) : null),
    [monthScopedRecord, payTiers, state.vehicleTypes],
  );
  const monthScopedSales = useMemo(
    () => (monthScopedRecord ? salesFromState({ months: [monthScopedRecord], vehicleTypes: state.vehicleTypes }) : []),
    [monthScopedRecord, state.vehicleTypes],
  );

  useEffect(() => {
    void refreshFromCloud();
  }, []);

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
            hideGross
            extra={[{ label: "Months", value: String(state.months.length) }, ...dealTypeStatExtras(salesFromState(state), state.vehicleTypes)]}
          />
        ) : null}
      </header>

      <CloudStatusCard />
      <PayPushNotice />
      <JoinDealershipBanner />
      <OrgPanel />
      <EmployeeEntryCard />

      {showPersonalWorkbook ? (
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
                onChange={(event) => {
                  setCombinedYear(Number(event.target.value));
                  setCombinedMonth("all");
                }}
              >
                {availableYears.map((optionYear) => (
                  <option key={optionYear} value={optionYear}>
                    {optionYear}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Month:
              <select
                value={combinedMonth === "all" ? "all" : String(combinedMonth)}
                onChange={(event) => {
                  const next = event.target.value;
                  setCombinedMonth(next === "all" ? "all" : Number(next));
                }}
              >
                <option value="all">All months</option>
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="empty-note">
            {combinedMonth === "all"
              ? `Summary for ${combinedYear}`
              : `Summary for ${MONTH_NAMES[combinedMonth - 1]} ${combinedYear}`}
          </p>
          {yearScopedState.months.length === 0 ? (
            <p className="empty-note">No months on file for {combinedYear}. Pick another year to review.</p>
          ) : combinedMonth !== "all" && !monthScopedRecord ? (
            <p className="empty-note">
              No worksheet on file for {MONTH_NAMES[combinedMonth - 1]} {combinedYear}.
            </p>
          ) : (
            <table className="mini-sheet">
              <tbody>
                <tr>
                  <th scope="row">Units sold</th>
                  <td>{(monthScoped ?? combined).units}</td>
                </tr>
                <tr>
                  <th scope="row">Trade-ins</th>
                  <td>{(monthScoped ?? combined).trades}</td>
                </tr>
                <tr>
                  <th scope="row">F &amp; I</th>
                  <td>{formatMoney((monthScoped ?? combined).fi)}</td>
                </tr>
                <tr>
                  <th scope="row">Service</th>
                  <td>{formatMoney((monthScoped ?? combined).service)}</td>
                </tr>
                <tr>
                  <th scope="row">Flats</th>
                  <td>{formatMoney((monthScoped ?? combined).flat)}</td>
                </tr>
                <tr>
                  <th scope="row">Bonuses</th>
                  <td>{formatMoney((monthScoped ?? combined).bonus)}</td>
                </tr>
                <tr>
                  <th scope="row">Vacation pay</th>
                  <td>{formatMoney((monthScoped ?? combined).vacation)}</td>
                </tr>
                {(monthScoped ?? combined).regular > 0 ? (
                  <tr>
                    <th scope="row">Regular hourly pay</th>
                    <td>{formatMoney((monthScoped ?? combined).regular)}</td>
                  </tr>
                ) : null}
                <tr className="mini-grand">
                  <th scope="row">Total pay</th>
                  <td>{formatMoney((monthScoped ?? combined).pay)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {yearScopedState.months.length > 0 && (combinedMonth === "all" || monthScopedRecord) ? (
            <div className="deal-type-block">
              <h3 className="deal-type-heading">By deal type</h3>
              <DealTypeSummary
                sales={combinedMonth === "all" ? combinedSales : monthScopedSales}
                vehicleTypes={state.vehicleTypes}
                hideGross
              />
            </div>
          ) : null}
        </CollapsibleCard>
      ) : null}
    </div>
  );
}
