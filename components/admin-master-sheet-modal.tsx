"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RotateCcw, X } from "lucide-react";
import { ExtraPayForm } from "@/components/extra-pay-form";
import { SalesSheet } from "@/components/sales-sheet";
import { StatStrip } from "@/components/stat-strip";
import { TotalsPanel } from "@/components/totals-panel";
import { Button } from "@/components/ui/button";
import {
  ADMIN_DRAFT_SAVED_TOAST,
  emptyTrackerForPeriod,
  RESET_ADMIN_SHEET_CONFIRM,
  RESET_ADMIN_SHEET_DONE_TOAST,
  RESET_ADMIN_SHEET_LABEL,
  SAVE_ADMIN_DRAFT_LABEL,
} from "@/lib/admin-roster";
import {
  adminMasterSheetTitle,
  deleteAdminSheetCopy,
} from "@/lib/admin-employee-sheets";
import { PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL } from "@/lib/approval-chain";
import { createBonus, createSale, getCommissionRate, saleHasData, vacationFields } from "@/lib/commission";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { buildEmployeePushPayload, PUSH_SUCCESS_MESSAGE } from "@/lib/employee-push";
import { formatPercent } from "@/lib/format";
import { findMonth, mapSheet, monthLabel } from "@/lib/records";
import { displayName } from "@/lib/names";
import { refreshAdminRosterSheets, refreshOrg, useOrg, useOrgActions, usePayTiers } from "@/lib/org-store";
import {
  periodFromSheet,
  periodsCompatible,
  pickSheetsForPeriod,
  type PayPeriodIdentity,
} from "@/lib/pay-period";
import { personRoleLabel, type UserProfile } from "@/lib/roles";
import { hasTrackerData } from "@/lib/storage";
import { dealTypeStatExtras, salesFromMonth, summarizeSheet } from "@/lib/summaries";
import { showSyncToast } from "@/lib/sync-feedback";
import {
  flushTrackerSave,
  getTrackerSnapshot,
  persistDeletedSales,
  refreshFromCloud,
  retryCloudSync,
  setEntryRepId,
  useTrackerStore,
} from "@/lib/tracker-store";
import type { ExtraPay, PaySheet, Sale } from "@/lib/types";

function periodSplitLabel(period: PayPeriodIdentity): string {
  return period.split === "part2" ? "16th–end" : "1st–15th";
}

function adminModalTitle(person: UserProfile, period: PayPeriodIdentity): string {
  const year = period.year ?? new Date().getFullYear();
  const month = period.month ?? new Date().getMonth() + 1;
  return `${adminMasterSheetTitle(displayName(person))} · ${monthLabel(year, month)} · ${periodSplitLabel(period)}`;
}

export function AdminMasterSheetModal({
  person,
  period,
  periodKey,
  onClose,
}: {
  person: UserProfile;
  period: PayPeriodIdentity;
  /** Explicit ledger key from the roster dropdowns, e.g. `2026-09-part2`. */
  periodKey?: string;
  onClose: () => void;
}) {
  const [state, setState] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const { pushToEmployee } = useOrgActions();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");

  const monthId =
    periodKey?.trim() ||
    period.key ||
    `${period.year}-${String(period.month).padStart(2, "0")}-part1`;
  const activePeriod = useMemo(
    () => ({ ...period, key: monthId, raw: monthId }),
    [period, monthId],
  );

  useEffect(() => {
    console.log(`[Modal] Opening sheet for employee: ${person.id} with period_key: ${monthId}`);
  }, [person.id, monthId]);

  const month =
    findMonth(state, monthId) ??
    state.months.find(
      (row) =>
        row.year === (activePeriod.year ?? null) &&
        row.month === (activePeriod.month ?? null) &&
        row.sheets.some((candidate) => periodsCompatible(periodFromSheet(candidate, row), activePeriod)),
    ) ??
    null;
  const sheet = month
    ? pickSheetsForPeriod(month, activePeriod)[0] ??
      month.sheets.find((candidate) => periodsCompatible(periodFromSheet(candidate, month), activePeriod)) ??
      null
    : null;
  const storeName = person.location_id
    ? org.locations.find((row) => row.id === person.location_id)?.name
    : null;
  const roleLabel = personRoleLabel(person);
  const title = adminModalTitle(person, activePeriod);

  useEffect(() => {
    setEntryRepId(person.id, true);
    // Always seed the selected half-month first so a prior 1st–15th workbook cannot linger.
    setState(emptyTrackerForPeriod(activePeriod));
    void refreshFromCloud(monthId, { force: true });
  }, [person.id, monthId, activePeriod, setState]);

  useEffect(() => {
    if (!focusNewRow.current) return;
    firstInputRef.current?.focus();
    focusNewRow.current = false;
  }, [sheet?.sales]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingDraft && !pushing && !resetting) {
        setEntryRepId(null);
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pushing, resetting, savingDraft]);

  function updateSheet(updater: (sheet: PaySheet) => PaySheet) {
    if (!month || !sheet) return;
    setState((current) => mapSheet(current, month.id, sheet.id, updater));
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
      sales: (current.sales ?? []).map((sale) => (sale.id === id ? { ...sale, ...patch } : sale)),
    }));
  }

  function removeSale(id: string, options?: { skipConfirm?: boolean }) {
    const sale = (sheet?.sales ?? []).find((row) => row.id === id);
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

  function confirmDuplicateSale(id: string) {
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).map((sale) => (sale.id === id ? markDuplicateConfirmed(sale) : sale)),
    }));
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
      bonuses: (current.bonuses ?? []).map((bonus) => (bonus.id === id ? { ...bonus, ...patch } : bonus)),
    }));
  }

  function removeBonus(id: string) {
    updateSheet((current) => ({
      ...current,
      bonuses: (current.bonuses ?? []).filter((bonus) => bonus.id !== id),
    }));
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setError("");
    try {
      const status = await flushTrackerSave();
      if (status === "error" || status === "retry") {
        const message = "Couldn't save draft to the admin ledger. Check the console for details.";
        console.error("Admin draft save failed with status:", status);
        setError(message);
        return;
      }
      if (status === "signed-out") {
        setError("Sign in again to save the admin draft.");
        return;
      }
      showSyncToast(ADMIN_DRAFT_SAVED_TOAST);
      await refreshAdminRosterSheets();
      retryCloudSync();
    } finally {
      setSavingDraft(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setError("");
    try {
      const saveStatus = await flushTrackerSave();
      if (saveStatus === "error" || saveStatus === "signed-out") {
        const message =
          saveStatus === "signed-out"
            ? "Sign in again to push this sheet."
            : "Couldn't save the admin draft before pushing. Check the console for details.";
        console.error(message);
        setError(message);
        return;
      }
      const payload = buildEmployeePushPayload(getTrackerSnapshot());
      const pushError = await pushToEmployee(person.id, payload);
      if (pushError) {
        console.error(pushError);
        setError(pushError);
        return;
      }
      showSyncToast(PUSH_SUCCESS_MESSAGE);
      await refreshAdminRosterSheets();
      retryCloudSync();
    } finally {
      setPushing(false);
    }
  }

  async function handleResetAdminSheet() {
    if (savingDraft || pushing || resetting) return;
    if (!window.confirm(RESET_ADMIN_SHEET_CONFIRM)) return;

    setResetting(true);
    setError("");
    try {
      const message = await deleteAdminSheetCopy({
        employeeId: person.id,
        periodKey: monthId,
        allowPaid: true,
      });
      if (message) {
        setError(message);
        return;
      }
      console.log("[Delete Sheet] Success for", displayName(person), "period_key:", monthId);
      showSyncToast(RESET_ADMIN_SHEET_DONE_TOAST);
      await refreshAdminRosterSheets({ ...activePeriod, key: monthId, raw: monthId });
      await refreshOrg();
      retryCloudSync();
      setEntryRepId(null);
      onClose();
    } finally {
      setResetting(false);
    }
  }

  function handleClose() {
    if (savingDraft || pushing || resetting) return;
    setEntryRepId(null);
    onClose();
  }

  const busy = savingDraft || pushing || resetting;
  const totals = sheet ? summarizeSheet(sheet, payTiers) : null;
  const rate = totals ? getCommissionRate(totals.units, payTiers) : 0;
  const canPush = Boolean(sheet) && (hasTrackerData(state) || (sheet?.sales?.length ?? 0) > 0);

  return (
    <div className="account-modal-backdrop admin-master-sheet-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="account-modal admin-master-sheet-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-master-sheet-header">
          <div>
            <h2>{title}</h2>
            <p className="empty-note">
              {displayName(person)}
              {roleLabel ? ` · ${roleLabel}` : ""}
              {storeName ? ` · ${storeName}` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleClose} aria-label="Close">
            <X data-icon="inline-start" />
            Close
          </Button>
        </header>

        <div className="admin-master-sheet-actions no-print">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void handleSaveDraft()}>
            {savingDraft ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {savingDraft ? "Saving…" : SAVE_ADMIN_DRAFT_LABEL}
          </Button>
          <Button type="button" disabled={busy || !canPush} onClick={() => void handlePush()}>
            {pushing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {pushing ? "Working…" : PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={handleClose}>
            Close
          </Button>
          <Button type="button" disabled={busy || !sheet} onClick={addSale}>
            <Plus data-icon="inline-start" />
            Add New Sale
          </Button>
          <Button
            type="button"
            variant="outline"
            className="admin-reset-sheet-btn"
            disabled={busy}
            onClick={() => void handleResetAdminSheet()}
          >
            {resetting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
            {resetting ? "Resetting…" : RESET_ADMIN_SHEET_LABEL}
          </Button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {!month || !sheet || !totals ? (
          <p className="empty-note">Loading worksheet…</p>
        ) : (
          <div className="admin-master-sheet-body workspace">
            <div className="sheet-column">
              <StatStrip
                totals={totals}
                extra={[{ label: "Pack", value: formatPercent(rate) }, ...dealTypeStatExtras(sheet.sales ?? [])]}
              />
              <SalesSheet
                sales={sheet.sales ?? []}
                monthSales={salesFromMonth(month)}
                vehicleTypes={state.vehicleTypes ?? []}
                onUpdate={updateSale}
                onRemove={(id) => removeSale(id)}
                onRemoveDuplicate={(id) => removeSale(id, { skipConfirm: true })}
                onConfirmDuplicate={confirmDuplicateSale}
                onAddRow={addSale}
                firstInputRef={firstInputRef}
              />
              <ExtraPayForm
                vacationHours={sheet.vacationHours ?? 0}
                vacationRate={sheet.vacationRate ?? 0}
                vacationPay={sheet.vacationPay ?? 0}
                bonuses={sheet.bonuses ?? []}
                onVacationChange={(hours, rateValue) =>
                  updateSheet((current) => ({ ...current, ...vacationFields(hours, rateValue) }))
                }
                onAddBonus={addBonus}
                onUpdateBonus={updateBonus}
                onRemoveBonus={removeBonus}
              />
            </div>
            <TotalsPanel
              sales={sheet.sales ?? []}
              totals={totals}
              bonuses={sheet.bonuses ?? []}
              vacationHours={sheet.vacationHours ?? 0}
              vacationRate={sheet.vacationRate ?? 0}
              vehicleTypes={state.vehicleTypes ?? []}
              onVehicleTypesChange={(vehicleTypes) => setState((current) => ({ ...current, vehicleTypes }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
