"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { addPayPeriodSheet, currentMonth, currentYear, monthLabel } from "@/lib/records";
import { sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, salesFromState, summarizeAll, summarizeMonth, summarizeSheet } from "@/lib/summaries";
import { refreshFromCloud, useTrackerStore, useEntryRepId } from "@/lib/tracker-store";
import { useOrg, usePayTiers } from "@/lib/org-store";
import { MONTH_NAMES } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg } from "@/lib/roles";

type PeriodChoice = "1st-15th" | "16th-end";

export function Dashboard() {
  const [state, setState] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const entryRepId = useEntryRepId();
  const router = useRouter();
  const [combinedYear, setCombinedYear] = useState(() => currentYear());
  const [combinedMonth, setCombinedMonth] = useState<number | "all">("all");
  const [sheetFilterKey, setSheetFilterKey] = useState<string>("all");
  const [addingSheet, setAddingSheet] = useState(false);
  const [createYear, setCreateYear] = useState(() => currentYear());
  const [createMonth, setCreateMonth] = useState(() => currentMonth());
  const [createPeriod, setCreatePeriod] = useState<PeriodChoice>("1st-15th");
  const [createError, setCreateError] = useState("");
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

  const createYears = useMemo(() => {
    const years = new Set(availableYears);
    years.add(createYear);
    years.add(currentYear());
    years.add(currentYear() + 1);
    return [...years].sort((a, b) => b - a);
  }, [availableYears, createYear]);

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

  const myPaySheets = useMemo(() => {
    const rows: Array<{
      key: string;
      href: string;
      title: string;
      filterKey: string;
      units: number;
      pay: number;
      year: number;
      month: number;
      startDay: number;
    }> = [];
    for (const record of state.months) {
      for (const sheet of record.sheets ?? []) {
        const totals = summarizeSheet(sheet, payTiers, state.vehicleTypes);
        const range = sheetRangeLabel(sheet.startDay, sheet.endDay, record.year, record.month);
        rows.push({
          key: `${record.id}:${sheet.id}`,
          filterKey: `${record.year}-${record.month}`,
          href: entryRepId
            ? `/m/${record.id}/s/${sheet.id}?rep=${encodeURIComponent(entryRepId)}`
            : `/m/${record.id}/s/${sheet.id}`,
          title: `${monthLabel(record.year, record.month)} · ${range}`,
          units: totals.units,
          pay: totals.pay,
          year: record.year,
          month: record.month,
          startDay: sheet.startDay,
        });
      }
    }
    return rows.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.month !== b.month) return b.month - a.month;
      return b.startDay - a.startDay;
    });
  }, [state.months, state.vehicleTypes, payTiers, entryRepId]);

  const sheetMonthOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of myPaySheets) {
      if (!seen.has(row.filterKey)) {
        seen.set(row.filterKey, monthLabel(row.year, row.month));
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value.localeCompare(a.value));
  }, [myPaySheets]);

  const filteredPaySheets = useMemo(() => {
    if (sheetFilterKey === "all") return myPaySheets;
    return myPaySheets.filter((row) => row.filterKey === sheetFilterKey);
  }, [myPaySheets, sheetFilterKey]);

  useEffect(() => {
    void refreshFromCloud();
  }, []);

  useEffect(() => {
    if (sheetFilterKey === "all") return;
    if (!sheetMonthOptions.some((option) => option.value === sheetFilterKey)) {
      setSheetFilterKey("all");
    }
  }, [sheetFilterKey, sheetMonthOptions]);

  function handleCreateSheet() {
    const result = addPayPeriodSheet(state, createYear, createMonth, createPeriod);
    if ("error" in result) {
      setCreateError(result.error);
      return;
    }
    setCreateError("");
    setState(result.state);
    setAddingSheet(false);
    const href = entryRepId
      ? `/m/${result.monthId}/s/${result.sheetId}?rep=${encodeURIComponent(entryRepId)}`
      : `/m/${result.monthId}/s/${result.sheetId}`;
    router.push(href);
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

          <CollapsibleCard
            title="Pay sheets"
            summary={String(myPaySheets.length)}
            className="my-pay-sheets-card"
            defaultOpen
          >
            <div className="my-pay-sheets-controls dashboard-filter-row add-month-form">
              <label>
                Month
                <select value={sheetFilterKey} onChange={(event) => setSheetFilterKey(event.target.value)}>
                  <option value="all">All months</option>
                  {sheetMonthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setCreateError("");
                  setAddingSheet((open) => !open);
                }}
              >
                <Plus data-icon="inline-start" />
                Add Pay Sheet
              </Button>
            </div>

            {addingSheet ? (
              <div className="my-pay-sheet-create add-month-form">
                <label>
                  Year
                  <select value={createYear} onChange={(event) => setCreateYear(Number(event.target.value))}>
                    {createYears.map((optionYear) => (
                      <option key={optionYear} value={optionYear}>
                        {optionYear}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Month
                  <select value={createMonth} onChange={(event) => setCreateMonth(Number(event.target.value))}>
                    {MONTH_NAMES.map((name, index) => (
                      <option key={name} value={index + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Period
                  <select
                    value={createPeriod}
                    onChange={(event) => setCreatePeriod(event.target.value as PeriodChoice)}
                  >
                    <option value="1st-15th">1st–15th</option>
                    <option value="16th-end">16th–end</option>
                  </select>
                </label>
                <Button type="button" onClick={handleCreateSheet}>
                  Create Sheet
                </Button>
                <Button type="button" variant="outline" onClick={() => setAddingSheet(false)}>
                  Cancel
                </Button>
                {createError ? <p className="form-error">{createError}</p> : null}
              </div>
            ) : null}

            {filteredPaySheets.length === 0 ? (
              <p className="empty-note">
                {myPaySheets.length === 0
                  ? "No pay sheets on file yet. Use Add Pay Sheet to start a period."
                  : "No pay sheets match that month filter."}
              </p>
            ) : (
              <ul className="my-pay-sheets-list">
                {filteredPaySheets.map((row) => (
                  <li key={row.key} className="my-pay-sheet-row">
                    <div className="my-pay-sheet-copy">
                      <h3>{row.title}</h3>
                      <div className="my-pay-sheet-badges">
                        <span className="my-pay-sheet-badge">
                          {row.units} unit{row.units === 1 ? "" : "s"}
                        </span>
                        <span className="my-pay-sheet-badge">{formatMoney(row.pay)}</span>
                      </div>
                    </div>
                    <Button
                      nativeButton={false}
                      size="sm"
                      variant="outline"
                      className="bg-white text-emerald-800 font-semibold border border-emerald-300 rounded-lg shadow-sm hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-900 transition-colors"
                      render={<Link href={row.href} />}
                    >
                      Open Sheet
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleCard>
        </>
      ) : null}
    </div>
  );
}
