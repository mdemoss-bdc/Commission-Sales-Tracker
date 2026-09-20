"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AccountChip } from "@/components/account-chip";
import { PayPushNotice } from "@/components/pay-push-notice";
import { MonthPushReviewDock } from "@/components/manager-review-modal";
import { BrandHomeLink } from "@/components/brand-home-link";
import { HomeNavButton } from "@/components/home-nav-button";
import { CheckForUpdatesButton } from "@/components/check-for-updates-button";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
import { SubmitChangesToManagerButton } from "@/components/submit-changes-button";
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
import {
  refreshFromCloud,
  setEntryRepId,
  useCloudStatus,
  useEntryRepId,
  useTrackerStore,
} from "@/lib/tracker-store";
import { getAdminRosterPeriod, invalidateOrgCache, refreshAdminRosterSheets, useOrg, usePayTiers } from "@/lib/org-store";
import { MAX_SHEETS_PER_MONTH } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg } from "@/lib/roles";
import { adminMasterSheetTitle, deleteAdminEmployeeSheet } from "@/lib/admin-employee-sheets";
import { payPeriodKey, periodFromSheet } from "@/lib/pay-period";

type MonthPageProps = {
  monthId: string;
};

export function MonthPage({ monthId }: MonthPageProps) {
  const [state, setState] = useTrackerStore();
  const cloudStatus = useCloudStatus();
  const payTiers = usePayTiers();
  const org = useOrg();
  const entryRepId = useEntryRepId();
  const searchParams = useSearchParams();
  const router = useRouter();
  const month = findMonth(state, monthId);
  const entryRep = entryRepId ? org.people.find((person) => person.id === entryRepId) : undefined;
  const masterTitle =
    entryRep && canManageOrg(org.profile?.role) ? adminMasterSheetTitle(displayName(entryRep)) : null;

  useEffect(() => {
    const fromQuery = searchParams.get("rep") || searchParams.get("employee");
    if (fromQuery?.trim()) setEntryRepId(fromQuery.trim(), true);
  }, [searchParams]);

  useEffect(() => {
    void refreshFromCloud(monthId);
  }, [monthId]);

  if (!month) {
    return (
      <div className="workbook">
        <MonthPushReviewDock monthId={monthId} />
        <header className="workbook-bar">
          <div>
            <BrandHomeLink />
            <AccountChip />
          </div>
        </header>
        <section className="summary-card">
          <h2>{cloudStatus === "syncing" ? "Checking the server" : "Month not found"}</h2>
          <p className="empty-note">
            {cloudStatus === "syncing"
              ? "Loading the latest worksheet from your account."
              : "That month is not on this tracker."}
          </p>
          <div className="toolbar-left">
            <HomeNavButton placement="toolbar" />
            <Button nativeButton={false} render={<Link href="/" />}>
              Back to all months
            </Button>
            <CheckForUpdatesButton monthId={monthId} />
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
    const remainingSheets = activeMonth.sheets.filter((item) => item.id !== sheetId);
    setState((current) =>
      mapMonth(current, monthId, (record) => ({
        ...record,
        sheets: record.sheets.filter((item) => item.id !== sheetId),
      })),
    );
    if (entryRepId && canManageOrg(org.profile?.role)) {
      const identity = periodFromSheet(sheet, activeMonth);
      const periodKey =
        identity.key ??
        payPeriodKey(
          activeMonth.year,
          activeMonth.month,
          identity.split === "part2" ? "part2" : identity.split === "full" ? "full" : "part1",
        );
      void (async () => {
        const error = await deleteAdminEmployeeSheet({ employeeId: entryRepId, periodKey });
        if (error) console.error("Failed to delete admin paysheet:", error);
        // If the month is now empty, also drop the roster period key for the open month.
        if (remainingSheets.length === 0) {
          const rosterKey = getAdminRosterPeriod().key ?? monthId;
          if (rosterKey && rosterKey !== periodKey) {
            await deleteAdminEmployeeSheet({ employeeId: entryRepId, periodKey: rosterKey });
          }
        }
        await refreshAdminRosterSheets();
        await invalidateOrgCache();
      })();
    }
  }

  function removeMonth() {
    if (!window.confirm(`Remove ${monthLabel(activeMonth.year, activeMonth.month)} and both sheets?`)) {
      return;
    }
    setState((current) => ({
      ...current,
      months: current.months.filter((item) => item.id !== monthId),
    }));
    if (entryRepId && canManageOrg(org.profile?.role)) {
      const keys = new Set<string>([
        monthId,
        payPeriodKey(activeMonth.year, activeMonth.month, "part1"),
        payPeriodKey(activeMonth.year, activeMonth.month, "part2"),
      ]);
      const rosterKey = getAdminRosterPeriod().key;
      if (rosterKey) keys.add(rosterKey);
      void (async () => {
        for (const periodKey of keys) {
          const error = await deleteAdminEmployeeSheet({ employeeId: entryRepId, periodKey });
          if (error) console.error("Failed to delete admin paysheet:", error);
        }
        await refreshAdminRosterSheets();
        await invalidateOrgCache();
      })();
    }
    router.push("/");
  }

  return (
    <div className="workbook">
      <MonthPushReviewDock monthId={monthId} />
      <header className="workbook-bar">
        <div>
          <BrandHomeLink pageTitle={monthLabel(activeMonth.year, activeMonth.month)} />
          <p className="header-sub">
            {masterTitle
              ? `${masterTitle}. Deals, bonuses, and vacation pay save to this admin ledger and stay off the rep’s working sheet until you push.`
              : "Two worksheets max. Pick a date range for each, like 1st–15th and 16th–end. Pack is figured on each worksheet, then added together here."}
          </p>
          <AccountChip />
        </div>
        <StatStrip totals={totals} extra={dealTypeStatExtras(salesFromMonth(activeMonth))} />
      </header>

      <PayPushNotice />

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
          <CheckForUpdatesButton monthId={monthId} />
          <SubmitChangesToManagerButton />
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
            const sheetTotals = summarizeSheet(sheet, payTiers, state.vehicleTypes);
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
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        href={
                          entryRepId
                            ? `/m/${monthId}/s/${sheet.id}?rep=${encodeURIComponent(entryRepId)}`
                            : `/m/${monthId}/s/${sheet.id}`
                        }
                      />
                    }
                  >
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
