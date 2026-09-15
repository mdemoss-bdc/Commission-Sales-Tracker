"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Plus, Printer } from "lucide-react";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
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
import { createBonus, createSale, getCommissionRate, saleHasData, vacationFields } from "@/lib/commission";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { formatPercent } from "@/lib/format";
import { findMonth, findSheet, mapSheet, monthLabel } from "@/lib/records";
import { extrasFromSheet } from "@/lib/sheet-compare";
import { EDITING_PUSHED_BANNER } from "@/lib/push-review";
import { useEditingPushedSheet } from "@/lib/pushed-sheet-edit";
import { normalizeRange, sheetRangeLabel } from "@/lib/sheet-range";
import { dealTypeStatExtras, salesFromMonth, summarizeSheet } from "@/lib/summaries";
import { flushTrackerSave, refreshFromCloud, useTrackerStore } from "@/lib/tracker-store";
import { usePayTiers } from "@/lib/org-store";
import type { ExtraPay, PaySheet, Sale } from "@/lib/types";

type PayTrackerProps = {
  monthId: string;
  sheetId: string;
};

export function PayTracker({ monthId, sheetId }: PayTrackerProps) {
  const [state, setState] = useTrackerStore();
  const payTiers = usePayTiers();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  const month = findMonth(state, monthId);
  const sheet = month ? findSheet(month, sheetId) : undefined;
  const pendingReview = usePendingSheetReview(monthId, sheetId);
  const editingPushed = useEditingPushedSheet(monthId, sheetId);
  const lockedReview = pendingReview.active && !editingPushed;

  useEffect(() => {
    void refreshFromCloud(monthId);
  }, [monthId, sheetId]);

  useEffect(() => {
    if (!focusNewRow.current) return;
    firstInputRef.current?.focus();
    focusNewRow.current = false;
  }, [sheet?.sales]);

  if (!month || !sheet) {
    if (pendingReview.active && pendingReview.pushedSheet && !editingPushed) {
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

  const activeSheet = sheet;
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

  function updateSheet(updater: (current: PaySheet) => PaySheet) {
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
    if (options?.skipConfirm) void flushTrackerSave();
  }

  function clearSheet() {
    if ((activeSheet.sales ?? []).length === 0) return;
    if (!window.confirm("Clear every sale on this sheet?")) return;
    updateSheet((current) => ({ ...current, sales: [] }));
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
    window.print();
  }

  return (
    <div className="workbook print-fit">
      <MonthPushReviewDock monthId={monthId} />
      <header className="workbook-bar">
        <div>
          <BrandHomeLink pageTitle={title} />
          <p className="header-sub print-heading">
            Pack {formatPercent(rate)} · {totals.trades} trade-ins
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
          {lockedReview ? null : (
            <Button onClick={addSale}>
              <Plus data-icon="inline-start" />
              Add New Sale
            </Button>
          )}
          <PushToEmployeeButton />
          <CheckForUpdatesButton monthId={monthId} />
          <Button variant="outline" onClick={printSheet}>
            <Printer data-icon="inline-start" />
            Print sheet
          </Button>
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
        </div>
      </div>

      <div className="workspace print:flex print:flex-col">
        <div className="sheet-column">
          {editingPushed ? (
            <p className="editing-pushed-banner no-print" role="status">
              {EDITING_PUSHED_BANNER}
            </p>
          ) : null}
          <p className="sheet-hint no-print">
            {lockedReview
              ? "Your live log and Other pay sit on top. Edit the manager deals, vacation, and bonuses underneath, then confirm the complete sheet back to your manager."
              : editingPushed
                ? "Correct units, dollar amounts, or rows on this pushed sheet, then re-submit when the numbers are right."
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
            />
          ) : (
            <SalesSheet
              sales={activeSheet.sales ?? []}
              monthSales={salesFromMonth(month)}
              vehicleTypes={state.vehicleTypes ?? []}
              onUpdate={updateSale}
              onRemove={(id) => removeSale(id)}
              onRemoveDuplicate={(id) => removeSale(id, { skipConfirm: true })}
              onConfirmDuplicate={confirmDuplicateSale}
              onAddRow={addSale}
              firstInputRef={firstInputRef}
            />
          )}
          {lockedReview ? null : (
            <ExtraPayForm
              vacationHours={activeSheet.vacationHours ?? 0}
              vacationRate={activeSheet.vacationRate ?? 0}
              vacationPay={activeSheet.vacationPay ?? 0}
              bonuses={activeSheet.bonuses ?? []}
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
