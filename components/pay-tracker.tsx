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
import { DualSheetReview, usePendingSheetReview } from "@/components/dual-sheet-review";
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
import { createBonus, createSale, getCommissionRate, saleHasData, vacationFields } from "@/lib/commission";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { formatPercent } from "@/lib/format";
import { findMonth, findSheet, mapSheet, monthLabel } from "@/lib/records";
import { extrasFromSheet } from "@/lib/sheet-compare";
import { EDITING_PUSHED_BANNER, PAID_PERIOD_LOCKED_BANNER } from "@/lib/push-review";
import { useEditingPushedSheet } from "@/lib/pushed-sheet-edit";
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
import { getAdminRosterPeriod, refreshAdminRosterSheets, setAdminRosterPeriod, useOrg, usePayTiers } from "@/lib/org-store";
import { parsePayPeriodKey } from "@/lib/pay-period";
import type { ExtraPay, PaySheet, Sale } from "@/lib/types";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { adminMasterSheetTitle, resetAdminEmployeeSheet } from "@/lib/admin-employee-sheets";
import { sheetFromTracker } from "@/lib/sheet-compare";

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
  const pendingReview = usePendingSheetReview(monthId, sheetId);
  const editingPushed = useEditingPushedSheet(monthId, sheetId);
  const periodLocked = pendingReview.periodLocked;
  const lockedReview = !periodLocked && pendingReview.active && !editingPushed;

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
    if (!periodLocked && pendingReview.active && pendingReview.pushedSheet && !editingPushed) {
      const year = pendingReview.pushedMonth?.year ?? 0;
      const monthNumber = pendingReview.pushedMonth?.month ?? 1;
      return (
        <div className="workbook">
          <MonthPushReviewDock monthId={monthId} />
          <header className="workbook-bar">
            <div>
              <BrandHomeLink pageTitle="Manager push review" />
              <AccountChip />
            </div>
          </header>
          <div className="toolbar no-print">
            <div className="toolbar-left">
              <HomeNavButton placement="toolbar" />
              <Button nativeButton={false} variant="outline" render={<Link href="/" />}>
                <ArrowLeft data-icon="inline-start" />
                All months
              </Button>
            </div>
          </div>
          <div className="workspace">
            <div className="sheet-column">
              <DualSheetReview
                monthId={monthId}
                sheetId={sheetId}
                year={year}
                month={monthNumber}
                liveSales={[]}
                liveExtras={extrasFromSheet(null)}
                vehicleTypes={state.vehicleTypes ?? []}
                firstInputRef={firstInputRef}
                onClose={() => pendingReview.dismissReview()}
              />
            </div>
          </div>
        </div>
      );
    }
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

  const authorizedSheet =
    periodLocked && pendingReview.chain
      ? sheetFromTracker(pendingReview.chain.adminBaseline, monthId, sheetId) ??
        sheetFromTracker(pendingReview.chain.repDraft, monthId, sheetId)
      : null;
  const activeSheet = authorizedSheet ?? sheet;
  const sheetReadOnly = periodLocked;
  const range = normalizeRange(
    activeSheet.startDay,
    activeSheet.endDay,
    month.year,
    month.month,
  );
  const totals = summarizeSheet(activeSheet, payTiers);
  const rate = getCommissionRate(totals.units, payTiers);
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
            extra={[{ label: "Pack", value: formatPercent(rate) }, ...dealTypeStatExtras(activeSheet.sales ?? [])]}
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
          {lockedReview || periodLocked ? null : (
            <Button onClick={addSale}>
              <Plus data-icon="inline-start" />
              Add New Sale
            </Button>
          )}
          {periodLocked ? null : <SubmitChangesToManagerButton />}
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

      <div className="workspace print:flex print:flex-col">
        <div className="sheet-column">
          {periodLocked ? (
            <p className="editing-pushed-banner paid-period-locked-banner no-print" role="status">
              {PAID_PERIOD_LOCKED_BANNER}
            </p>
          ) : null}
          {editingPushed && !periodLocked ? (
            <p className="editing-pushed-banner no-print" role="status">
              {EDITING_PUSHED_BANNER}
            </p>
          ) : null}
          <p className="sheet-hint no-print">
            {periodLocked
              ? "This worksheet is locked. Print for your records if needed."
              : lockedReview
              ? "The admin pushed worksheet is on top. Edit either table, watch the live pay difference, then accept the admin numbers or submit your working sheet to the manager."
              : editingPushed
                ? "Correct units, dollar amounts, or rows on this pushed sheet, then re-submit when the numbers are right."
                : canReviewDeals(org.profile?.role)
                  ? "Log stock number, customer, trade-in, front-end gross, flat, F&I, and service."
                  : "Log stock number, vehicle, trade-in, front-end gross, flat, F&I, and service. Set vehicle types in the sidebar so the dropdown matches what you sell."}
          </p>
          {lockedReview ? (
            <DualSheetReview
              monthId={monthId}
              sheetId={sheetId}
              year={month.year}
              month={month.month}
              liveSales={activeSheet.sales ?? []}
              liveExtras={extrasFromSheet(activeSheet)}
              vehicleTypes={state.vehicleTypes ?? []}
              firstInputRef={firstInputRef}
              onClose={() => pendingReview.dismissReview()}
            />
          ) : (
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
            />
          )}
          {lockedReview ? null : (
            <ExtraPayForm
              vacationHours={activeSheet.vacationHours ?? 0}
              vacationRate={activeSheet.vacationRate ?? 0}
              vacationPay={activeSheet.vacationPay ?? 0}
              bonuses={activeSheet.bonuses ?? []}
              readOnly={sheetReadOnly}
              onVacationChange={(hours, rate) =>
                updateSheet((current) => ({ ...current, ...vacationFields(hours, rate) }))
              }
              onAddBonus={addBonus}
              onUpdateBonus={updateBonus}
              onRemoveBonus={removeBonus}
            />
          )}
        </div>
        <TotalsPanel
          sales={activeSheet.sales ?? []}
          totals={totals}
          bonuses={activeSheet.bonuses ?? []}
          vacationHours={activeSheet.vacationHours ?? 0}
          vacationRate={activeSheet.vacationRate ?? 0}
          vehicleTypes={state.vehicleTypes ?? []}
          onVehicleTypesChange={(vehicleTypes) =>
            setState((current) => ({ ...current, vehicleTypes }))
          }
        />
      </div>
    </div>
  );
}
