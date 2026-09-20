"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { ExtraPayForm } from "@/components/extra-pay-form";
import { SalesSheet } from "@/components/sales-sheet";
import { StatStrip } from "@/components/stat-strip";
import { TotalsPanel } from "@/components/totals-panel";
import { Button } from "@/components/ui/button";
import { emptyTrackerForPeriod } from "@/lib/admin-roster";
import {
  MANAGER_SHEET_SAVED_TOAST,
  MANAGER_SHEET_SUBMITTED_TOAST,
  REVIEW_EDIT_SHEET_LABEL,
  SAVE_MANAGER_SHEET_CHANGES_LABEL,
  SUBMIT_AUTHORIZE_FOR_EMPLOYEE_LABEL,
} from "@/lib/approval-chain";
import { createBonus, createSale, getCommissionRate, regularPayFields, saleHasData, vacationFields } from "@/lib/commission";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { formatPercent } from "@/lib/format";
import { findMonth, mapSheet, monthLabel } from "@/lib/records";
import { displayName } from "@/lib/names";
import { refreshOrg, useOrg, useOrgActions, usePayTiers } from "@/lib/org-store";
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

export function ManagerEditSheetModal({
  person,
  period,
  onClose,
}: {
  person: UserProfile;
  period: PayPeriodIdentity;
  onClose: () => void;
}) {
  const [state, setState] = useTrackerStore();
  const org = useOrg();
  const payTiers = usePayTiers();
  const { saveManagerSheetEdits, submitManagerSheetEdits } = useOrgActions();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const monthId =
    period.key?.trim() ||
    `${period.year ?? new Date().getFullYear()}-${String(period.month ?? new Date().getMonth() + 1).padStart(2, "0")}-${
      period.split === "part2" ? "part2" : "part1"
    }`;
  const activePeriod = useMemo(
    () => ({ ...period, key: monthId, raw: monthId }),
    [period, monthId],
  );

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
  const year = activePeriod.year ?? new Date().getFullYear();
  const monthNum = activePeriod.month ?? new Date().getMonth() + 1;
  const title = `${REVIEW_EDIT_SHEET_LABEL} · ${displayName(person)} · ${monthLabel(year, monthNum)} · ${periodSplitLabel(activePeriod)}`;

  useEffect(() => {
    setEntryRepId(person.id, true);
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
      if (event.key === "Escape" && !saving && !submitting) {
        setEntryRepId(null);
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving, submitting]);

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

  async function handleSaveChanges() {
    if (saving || submitting) return;
    setSaving(true);
    setError("");
    try {
      const message = await saveManagerSheetEdits(person.id, getTrackerSnapshot());
      if (message) {
        setError(message);
        return;
      }
      showSyncToast(MANAGER_SHEET_SAVED_TOAST);
      await refreshOrg();
      retryCloudSync();
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitAuthorize() {
    if (saving || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const message = await submitManagerSheetEdits(person.id, getTrackerSnapshot());
      if (message) {
        setError(message);
        return;
      }
      showSyncToast(MANAGER_SHEET_SUBMITTED_TOAST);
      await refreshOrg();
      retryCloudSync();
      setEntryRepId(null);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (saving || submitting) return;
    setEntryRepId(null);
    void refreshOrg();
    onClose();
  }

  const busy = saving || submitting;
  const totals = sheet ? summarizeSheet(sheet, payTiers, state.vehicleTypes) : null;
  const rate = totals ? getCommissionRate(totals.units, payTiers) : 0;
  const canSubmit = Boolean(sheet) && (hasTrackerData(state) || (sheet?.sales?.length ?? 0) > 0);

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
              {" · Waiting on employee review — edits stay in Pending Employee Acceptance until you submit."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleClose} aria-label="Close">
            <X data-icon="inline-start" />
            Close
          </Button>
        </header>

        <div className="admin-master-sheet-actions no-print">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void handleSaveChanges()}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {saving ? "Saving…" : SAVE_MANAGER_SHEET_CHANGES_LABEL}
          </Button>
          <Button type="button" disabled={busy || !canSubmit} onClick={() => void handleSubmitAuthorize()}>
            {submitting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {submitting ? "Submitting…" : SUBMIT_AUTHORIZE_FOR_EMPLOYEE_LABEL}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={handleClose}>
            Close
          </Button>
          <Button type="button" disabled={busy || !sheet} onClick={addSale}>
            <Plus data-icon="inline-start" />
            Add New Sale
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
                regularHours={sheet.regularHours ?? 0}
                hourlyRate={sheet.hourlyRate ?? 0}
                vacationHours={sheet.vacationHours ?? 0}
                vacationRate={sheet.vacationRate ?? 0}
                vacationPay={sheet.vacationPay ?? 0}
                bonuses={sheet.bonuses ?? []}
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
              sales={sheet.sales ?? []}
              totals={totals}
              bonuses={sheet.bonuses ?? []}
              vacationHours={sheet.vacationHours ?? 0}
              vacationRate={sheet.vacationRate ?? 0}
              regularHours={sheet.regularHours ?? 0}
              hourlyRate={sheet.hourlyRate ?? 0}
              vehicleTypes={state.vehicleTypes ?? []}
              onVehicleTypesChange={(vehicleTypes) => setState((current) => ({ ...current, vehicleTypes }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
