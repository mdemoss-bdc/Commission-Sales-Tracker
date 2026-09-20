"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Plus, Printer } from "lucide-react";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
import { SubmitChangesToManagerButton } from "@/components/submit-changes-button";
import { AccountChip } from "@/components/account-chip";
import { BrandHomeLink } from "@/components/brand-home-link";
import { HomeNavButton } from "@/components/home-nav-button";
import { CheckForUpdatesButton } from "@/components/check-for-updates-button";
import { PayPushNotice } from "@/components/pay-push-notice";
import { MonthPushReviewDock } from "@/components/manager-review-modal";
import { PrintEmployeeHeader } from "@/components/print-employee-header";
import { ExtraPayForm } from "@/components/extra-pay-form";
import { SalesSheet } from "@/components/sales-sheet";
import { SheetRangePicker } from "@/components/sheet-range-picker";
import { StatStrip } from "@/components/stat-strip";
import { TotalsPanel } from "@/components/totals-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PRINT_SHEET_CONTAINER_CLASS } from "@/lib/admin-print";
import { createBonus, createSale, getCommissionRate, regularPayFields, saleHasData, vacationFields } from "@/lib/commission";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { formatPercent } from "@/lib/format";
import { findMonth, findSheet, mapSheet, monthLabel } from "@/lib/records";
import { PAID_PERIOD_LOCKED_BANNER } from "@/lib/push-review";
import {
  AUTHORIZED_BY_MANAGER,
  AUTHORIZED_BY_MANAGER_BANNER,
  SUBMITTED_TO_MANAGER_BANNER,
  isManagerApprovedStatus,
  isPayPeriodLockedForRep,
  isRejectedByManager,
  isSubmittedToManagerStatus,
} from "@/lib/approval-chain";
import { normalizeRange, sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, salesFromMonth, summarizeSheet } from "@/lib/summaries";
import {
  flushTrackerSave,
  persistDeletedSales,
  refreshFromCloud,
  setEntryRepId,
  useEntryRepId,
  useTrackerStore,
} from "@/lib/tracker-store";
import { getAdminRosterPeriod, invalidateOrgCache, refreshAdminRosterSheets, setAdminRosterPeriod, useOrg, usePayTiers } from "@/lib/org-store";
import { parsePayPeriodKey } from "@/lib/pay-period";
import type { ExtraPay, PaySheet, Sale } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { adminMasterSheetTitle, isPaidAdminSheet, resetAdminEmployeeSheet } from "@/lib/admin-employee-sheets";

type PayTrackerProps = {
  monthId: string;
  sheetId: string;
};

export function PayTracker({ monthId, sheetId }: PayTrackerProps) {
  const [state, setState] = useTrackerStore();
  const payTiers = usePayTiers();
  const org = useOrg();
  const entryRepId = useEntryRepId();
  const searchParams = useSearchParams();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  const [printing, setPrinting] = useState(false);
  const month = findMonth(state, monthId);
  const sheet = month ? findSheet(month, sheetId) : undefined;
  const ownChain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const chainStatus = ownChain?.status;
  const periodLocked = isPayPeriodLockedForRep(chainStatus);
  const paidLocked =
    periodLocked &&
    (isPaidAdminSheet(chainStatus) ||
      (chainStatus ?? "").toLowerCase() === "paid" ||
      (chainStatus ?? "").toLowerCase() === "disbursed");
  const authorizedBanner =
    !paidLocked &&
    (chainStatus === AUTHORIZED_BY_MANAGER || isManagerApprovedStatus(chainStatus));
  const submittedBanner =
    !periodLocked && isSubmittedToManagerStatus(chainStatus);
  const rejectedBanner = isRejectedByManager(chainStatus);

  useEffect(() => {
    const fromQuery = searchParams.get("rep") || searchParams.get("employee");
    if (fromQuery?.trim()) {
      setEntryRepId(fromQuery.trim(), true);
    }
  }, [searchParams]);

  useEffect(() => {
    const period = parsePayPeriodKey(monthId);
    if (period.key || (period.year && period.month)) {
      setAdminRosterPeriod(period.key ? period : { ...period, key: monthId });
    }
  }, [monthId]);

  useEffect(() => {
    void refreshFromCloud(monthId);
  }, [monthId, sheetId]);

  useEffect(() => {
    if (!focusNewRow.current) return;
    firstInputRef.current?.focus();
    focusNewRow.current = false;
  }, [sheet?.sales]);

  useEffect(() => {
    function onBeforePrint() {
      setPrinting(true);
    }
    function onAfterPrint() {
      setPrinting(false);
    }
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  if (!month || !sheet) {
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
          <h2>Sheet not found</h2>
          <p className="empty-note">That sales sheet is not on this tracker.</p>
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

  const activeSheet = sheet;
  const sheetReadOnly = periodLocked;
  const range = normalizeRange(
    activeSheet.startDay,
    activeSheet.endDay,
    month.year,
    month.month,
  );
  const totals = summarizeSheet(activeSheet, payTiers, state.vehicleTypes);
  const rate = getCommissionRate(totals.units, payTiers);
  const isRepView = org.profile?.role === "rep";
  const period = sheetRangeLabel(range.startDay, range.endDay, month.year, month.month);
  const title = `${monthLabel(month.year, month.month)} · ${period}`;
  const entryRep = entryRepId ? org.people.find((person) => person.id === entryRepId) : undefined;
  const masterTitle =
    entryRep && canManageOrg(org.profile?.role) ? adminMasterSheetTitle(displayName(entryRep)) : null;

  function updateSheet(updater: (current: PaySheet) => PaySheet) {
    if (sheetReadOnly) return;
    setState((current) => mapSheet(current, monthId, sheetId, updater));
  }

  function addSale() {
    focusNewRow.current = true;
    updateSheet((current) => ({
      ...current,
      sales: [...(current.sales ?? []), createSale()],
    }));
  }

  function updateSale(id: string, patch: Partial<Sale>) {
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).map((sale) =>
        sale.id === id ? { ...sale, ...patch } : sale,
      ),
    }));
  }

  function confirmDuplicateSale(id: string) {
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).map((sale) => (sale.id === id ? markDuplicateConfirmed(sale) : sale)),
    }));
    void flushTrackerSave();
  }

  function removeSale(id: string, options?: { skipConfirm?: boolean }) {
    const sale = (activeSheet.sales ?? []).find((row) => row.id === id);
    if (
      !options?.skipConfirm &&
      sale &&
      saleHasData(sale) &&
      !window.confirm("Remove this sale from the tracker?")
    ) {
      return;
    }
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).filter((row) => row.id !== id),
    }));
    void persistDeletedSales([id]);
  }

  function clearSheet() {
    if ((activeSheet.sales ?? []).length === 0) return;
    if (!window.confirm("Clear every sale on this sheet?")) return;
    const ids = (activeSheet.sales ?? []).map((row) => row.id).filter(Boolean);
    updateSheet((current) => ({ ...current, sales: [] }));
    void persistDeletedSales(ids);
    if (entryRepId && canManageOrg(org.profile?.role)) {
      const periodKey = getAdminRosterPeriod().key ?? monthId;
      void (async () => {
        const error = await resetAdminEmployeeSheet({ employeeId: entryRepId, periodKey });
        if (error) console.error("Failed to reset admin paysheet:", error);
        await refreshAdminRosterSheets();
        await invalidateOrgCache();
      })();
    }
  }

  function addBonus() {
    updateSheet((current) => ({
      ...current,
      bonuses: [...(current.bonuses ?? []), createBonus()],
    }));
  }

  function updateBonus(id: string, patch: Partial<ExtraPay>) {
    updateSheet((current) => ({
      ...current,
      bonuses: (current.bonuses ?? []).map((bonus) =>
        bonus.id === id ? { ...bonus, ...patch } : bonus,
      ),
    }));
  }

  function removeBonus(id: string) {
    updateSheet((current) => ({
      ...current,
      bonuses: (current.bonuses ?? []).filter((bonus) => bonus.id !== id),
    }));
  }

  function printSheet() {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => setPrinting(false), 500);
    }, 50);
  }

  return (
    <div className={`workbook print-fit ${PRINT_SHEET_CONTAINER_CLASS}`}>
      <MonthPushReviewDock monthId={monthId} />
      <header className="workbook-bar banner-header print:min-h-0 print:h-auto print:py-3 print:mb-3">
        <div>
          <BrandHomeLink pageTitle={masterTitle ? `${masterTitle} · ${title}` : title} />
          <p className="header-sub print-heading">
            {masterTitle
              ? `${masterTitle}. Pack ${formatPercent(rate)} · ${totals.trades} trade-ins. Saves stay on the admin ledger until you push.`
              : `Pack ${formatPercent(rate)} · ${totals.trades} trade-ins`}
          </p>
          <AccountChip />
          <div className="no-print">
            <SheetRangePicker
              year={month.year}
              month={month.month}
              startDay={range.startDay}
              endDay={range.endDay}
              onChange={(next) => updateSheet((current) => ({ ...current, ...next }))}
            />
          </div>
        </div>
        <div className="workbook-bar-end">
          <PrintEmployeeHeader />
          <StatStrip
            totals={totals}
            hideGross={isRepView}
            extra={[{ label: "Pack", value: formatPercent(rate) }, ...dealTypeStatExtras(activeSheet.sales ?? [], state.vehicleTypes)]}
          />
        </div>
      </header>

      <PayPushNotice />

      <div className="toolbar no-print">
        <div className="toolbar-left">
          <HomeNavButton placement="toolbar" />
          <Button nativeButton={false} variant="outline" render={<Link href={`/m/${monthId}`} />}>
            <ArrowLeft data-icon="inline-start" />
            {monthLabel(month.year, month.month)}
          </Button>
        </div>
        <div className="toolbar-actions">
          {periodLocked ? null : (
            <Button onClick={addSale}>
              <Plus data-icon="inline-start" />
              Add New Sale
            </Button>
          )}
          {periodLocked || submittedBanner ? null : <SubmitChangesToManagerButton />}
          <PushToEmployeeButton />
          <CheckForUpdatesButton monthId={monthId} />
          <Button variant="outline" onClick={printSheet}>
            <Printer data-icon="inline-start" />
            Print sheet
          </Button>
          {periodLocked ? null : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" aria-label="More sheet actions" />}
              >
                Sheet
                <ChevronDown data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={clearSheet}>
                  Clear all sales
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="workspace w-full print:flex print:flex-col">
        <div className="sheet-column w-full">
          {paidLocked ? (
            <p className="editing-pushed-banner paid-period-locked-banner no-print" role="status">
              {PAID_PERIOD_LOCKED_BANNER}
            </p>
          ) : authorizedBanner ? (
            <p className="editing-pushed-banner paid-period-locked-banner no-print" role="status">
              {AUTHORIZED_BY_MANAGER_BANNER}
            </p>
          ) : submittedBanner ? (
            <p className="editing-pushed-banner no-print" role="status">
              {SUBMITTED_TO_MANAGER_BANNER}
            </p>
          ) : rejectedBanner && ownChain?.denyReason ? (
            <p className="form-error no-print" role="status">
              Sheet returned by manager: {ownChain.denyReason}
            </p>
          ) : rejectedBanner ? (
            <p className="form-error no-print" role="status">
              Sheet returned by manager. Fix the sheet and re-submit.
            </p>
          ) : null}
          <p className="sheet-hint no-print">
            {periodLocked
              ? "This worksheet is locked. Print for your records if needed."
              : submittedBanner
                ? "Your sheet is with the manager for authorization."
                : canReviewDeals(org.profile?.role)
                  ? "Log stock number, customer, trade-in, front-end gross, flat, F&I, and service."
                  : "Log stock number, vehicle, trade-in, front-end gross, flat, F&I, and service. Set vehicle types at the bottom of the page so the dropdown matches what you sell."}
          </p>
          <SalesSheet
            sales={activeSheet.sales ?? []}
            monthSales={periodLocked ? activeSheet.sales ?? [] : salesFromMonth(month)}
            vehicleTypes={state.vehicleTypes ?? []}
            onUpdate={updateSale}
            onRemove={(id) => removeSale(id)}
            onRemoveDuplicate={(id) => removeSale(id, { skipConfirm: true })}
            onConfirmDuplicate={confirmDuplicateSale}
            onAddRow={periodLocked ? undefined : addSale}
            firstInputRef={firstInputRef}
            readOnly={sheetReadOnly}
            showTrade={!printing}
            hideGrossTotals={isRepView}
          />
          <ExtraPayForm
            regularHours={activeSheet.regularHours ?? 0}
            hourlyRate={activeSheet.hourlyRate ?? 0}
            vacationHours={activeSheet.vacationHours ?? 0}
            vacationRate={activeSheet.vacationRate ?? 0}
            vacationPay={activeSheet.vacationPay ?? 0}
            bonuses={activeSheet.bonuses ?? []}
            readOnly={sheetReadOnly}
            onRegularChange={(hours, rateValue) =>
              updateSheet((current) => ({ ...current, ...regularPayFields(hours, rateValue) }))
            }
            onVacationChange={(hours, rateValue) =>
              updateSheet((current) => ({ ...current, ...vacationFields(hours, rateValue) }))
            }
            onAddBonus={addBonus}
            onUpdateBonus={updateBonus}
            onRemoveBonus={removeBonus}
          />
        </div>
        <TotalsPanel
          sales={activeSheet.sales ?? []}
          totals={totals}
          bonuses={activeSheet.bonuses ?? []}
          vacationHours={activeSheet.vacationHours ?? 0}
          vacationRate={activeSheet.vacationRate ?? 0}
          regularHours={activeSheet.regularHours ?? 0}
          hourlyRate={activeSheet.hourlyRate ?? 0}
          vehicleTypes={state.vehicleTypes ?? []}
          hideGross={isRepView}
          onVehicleTypesChange={(vehicleTypes) =>
            setState((current) => ({ ...current, vehicleTypes }))
          }
        />
      </div>
    </div>
  );
}
