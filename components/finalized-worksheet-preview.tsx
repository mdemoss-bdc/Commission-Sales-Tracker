"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintWorksheet } from "@/components/print-worksheet";
import { isPaidAdminSheet, type AdminEmployeeSheet } from "@/lib/admin-employee-sheets";
import type { ApprovalChainRecord } from "@/lib/approval-chain";
import type { DealRow } from "@/lib/deal-records";
import {
  FINALIZED_PRINT_BATCH_CLASS,
  FINALIZED_PRINT_CARD_CLASS,
  PRINT_SHEET_CONTAINER_CLASS,
  MARK_PAID_CONFIRM,
  MARK_PAID_DONE_LABEL,
  MARK_PAID_LABEL,
  PAID_BADGE_LABEL,
  PRINT_SHEET_LABEL,
  NO_CAR_DEALS_EMPTY_NOTE,
  activePeriodMonth,
  adminSheetNeedsFallback,
  ensurePrintablePeriodMonth,
  formatPaidAt,
  hydrateAdminModalWorksheet,
  paySheetHasRenderableContent,
  periodFromAdminSheet,
  printFinalizedSheets,
  printPeriodLabel,
  printStateFromAdminSheet,
  trackerHasRenderableContent,
} from "@/lib/admin-print";
import { displayName } from "@/lib/names";
import { activePayPeriod, pickSheetsForPeriod, type PayPeriodIdentity } from "@/lib/pay-period";
import { collectWorksheetDeals, extractDealsFromSheetData } from "@/lib/pay-tracker-state";
import { ADMIN_SHEET_PAID } from "@/lib/admin-employee-sheets";
import type { UserProfile } from "@/lib/roles";

function FinalizedSheetPrintBody({
  person,
  sheet,
  period,
  loading,
}: {
  person: UserProfile;
  sheet: AdminEmployeeSheet | null;
  period: PayPeriodIdentity;
  loading?: boolean;
}) {
  const printState = printStateFromAdminSheet(sheet);
  const deals = [
    ...extractDealsFromSheetData(sheet?.sheetData),
    ...collectWorksheetDeals(printState),
    ...collectWorksheetDeals(sheet?.state),
  ];
  const month =
    ensurePrintablePeriodMonth(printState ?? sheet?.state ?? null, period) ??
    activePeriodMonth(printState ?? sheet?.state ?? null, new Date(), period);
  const worksheets = pickSheetsForPeriod(month, period);
  const pages = worksheets.length > 0 ? worksheets : month?.sheets ?? [];
  const vehicleTypes = printState?.vehicleTypes ?? sheet?.state?.vehicleTypes ?? [];
  const hasPayroll =
    deals.length > 0 ||
    pages.some((row) => paySheetHasRenderableContent(row)) ||
    trackerHasRenderableContent(printState) ||
    trackerHasRenderableContent(sheet?.state);
  const hasWorksheet = Boolean(month) && (hasPayroll || pages.length > 0 || Boolean(sheet));

  if (loading && !hasWorksheet && !sheet) {
    return <p className="empty-note">Loading worksheet…</p>;
  }
  if (!month) {
    return <p className="empty-note">No worksheet data on this finalized sheet.</p>;
  }

  return (
    <PrintWorksheet
      person={person}
      month={month}
      sheets={pages}
      vehicleTypes={vehicleTypes}
      period={period}
      emptyDealsNote={NO_CAR_DEALS_EMPTY_NOTE}
    />
  );
}

export function FinalizedWorksheetPreview({
  person,
  sheet,
  period,
  storeName,
  dealRows,
  chain,
  onClose,
  onMarkPaid,
}: {
  person: UserProfile;
  sheet: AdminEmployeeSheet | null;
  period?: PayPeriodIdentity | null;
  storeName?: string | null;
  dealRows?: DealRow[] | null;
  chain?: Pick<ApprovalChainRecord, "adminBaseline" | "repDraft"> | null;
  onClose: () => void;
  onMarkPaid: (employeeId: string) => Promise<string | null>;
}) {
  const preferred = period ?? periodFromAdminSheet(sheet, activePayPeriod());
  const seeded = useMemo(
    () =>
      hydrateAdminModalWorksheet({
        sheet,
        employeeId: person.id,
        dealRows,
        chain,
        period: preferred,
      }),
    [sheet, person.id, dealRows, chain, preferred.key, preferred.split],
  );
  const [hydrated, setHydrated] = useState(seeded);
  const [loading, setLoading] = useState(adminSheetNeedsFallback(seeded));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setHydrated((prev) => {
      const alreadyPaid = isPaidAdminSheet(prev.status, prev.isPaid) || isPaidAdminSheet(seeded.status, seeded.isPaid);
      if (!alreadyPaid) return seeded;
      return {
        ...seeded,
        status: ADMIN_SHEET_PAID,
        isPaid: true,
        paidAt: prev.paidAt ?? seeded.paidAt ?? new Date().toISOString(),
      };
    });
    if (!adminSheetNeedsFallback(seeded)) setLoading(false);
  }, [seeded]);

  useEffect(() => {
    let cancelled = false;
    const local = hydrateAdminModalWorksheet({
      sheet,
      employeeId: person.id,
      dealRows,
      chain,
      period: preferred,
    });
    if (!adminSheetNeedsFallback(local)) {
      setHydrated((prev) =>
        isPaidAdminSheet(prev.status, prev.isPaid)
          ? {
              ...local,
              status: ADMIN_SHEET_PAID,
              isPaid: true,
              paidAt: prev.paidAt ?? local.paidAt,
            }
          : local,
      );
      setLoading(false);
      return;
    }
    setHydrated((prev) =>
      isPaidAdminSheet(prev.status, prev.isPaid)
        ? {
            ...local,
            status: ADMIN_SHEET_PAID,
            isPaid: true,
            paidAt: prev.paidAt ?? local.paidAt,
          }
        : local,
    );
    setLoading(true);
    void (async () => {
      const { loadAdminFinalizedFallbacks } = await import("@/lib/org");
      const extras = await loadAdminFinalizedFallbacks(person.id, preferred);
      if (cancelled) return;
      setHydrated((prev) => {
        const next = hydrateAdminModalWorksheet({
          sheet: extras.sheet ?? sheet,
          employeeId: person.id,
          dealRows: extras.dealRows.length ? extras.dealRows : dealRows,
          chain,
          tracker: extras.tracker,
          period: preferred,
        });
        if (isPaidAdminSheet(prev.status, prev.isPaid) || isPaidAdminSheet(next.status, next.isPaid)) {
          return {
            ...next,
            status: ADMIN_SHEET_PAID,
            isPaid: true,
            paidAt: prev.paidAt ?? next.paidAt ?? new Date().toISOString(),
          };
        }
        return next;
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [person.id, preferred.key, preferred.split]); // eslint-disable-line react-hooks/exhaustive-deps

  const paid = isPaidAdminSheet(hydrated.status, hydrated.isPaid);
  const paidAt = formatPaidAt(hydrated.paidAt);
  const printState = printStateFromAdminSheet(hydrated);
  const month = activePeriodMonth(printState ?? hydrated.state ?? null, new Date(), preferred);
  const periodLabel = printPeriodLabel(month, preferred);
  const location = storeName?.trim() || "Unassigned store";

  async function handleConfirmPaid() {
    setBusy(true);
    setMessage("");
    try {
      const error = await onMarkPaid(person.id);
      if (error) {
        setMessage(error);
        return;
      }
      const paidAtIso = new Date().toISOString();
      setHydrated((prev) => ({
        ...prev,
        status: ADMIN_SHEET_PAID,
        isPaid: true,
        paidAt: prev.paidAt ?? paidAtIso,
        updatedAt: paidAtIso,
      }));
      setConfirmOpen(false);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not mark this pay sheet as paid.";
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }

  function handlePrint() {
    printFinalizedSheets("one", person.id);
  }

  return (
    <div className="account-modal-backdrop admin-print-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`${FINALIZED_PRINT_CARD_CLASS} account-modal pushed-sheet-modal manager-review-modal admin-print-modal mx-auto w-[95vw] max-w-7xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`admin-print-title-${person.id}`}
        data-employee-id={person.id}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="manager-review-chrome no-print">
          <div className="account-modal-head">
            <div>
              <p className="workbook-kicker">Print-ready pay sheet</p>
              <h2 id={`admin-print-title-${person.id}`}>{displayName(person)}</h2>
              <p className="header-sub">
                {location} · {periodLabel}
              </p>
            </div>
            <div className="finalized-print-toolbar-copy">
              {paid ? (
                <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
                  {PAID_BADGE_LABEL}
                </span>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>

        {paid ? (
          <div className="paid-sheet-banner no-print">
            <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
              {PAID_BADGE_LABEL}
            </span>
            {paidAt ? <p className="empty-note">Payroll disbursed {paidAt}</p> : null}
          </div>
        ) : null}

        <div className="manager-review-body finalized-print-scroll print-ready-sheet">
          <FinalizedSheetPrintBody person={person} sheet={hydrated} period={preferred} loading={loading} />
        </div>

        <div className="manager-review-footer finalized-print-footer no-print sticky bottom-0 border-t bg-white p-4">
          <div className="manager-review-actions finalized-print-actions">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer data-icon="inline-start" />
              {PRINT_SHEET_LABEL}
            </Button>
            {paid ? (
              <Button type="button" disabled aria-label={MARK_PAID_DONE_LABEL}>
                {MARK_PAID_DONE_LABEL}
              </Button>
            ) : (
              <Button type="button" onClick={() => setConfirmOpen(true)}>
                {MARK_PAID_LABEL}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
          {message && !confirmOpen ? <p className="form-error" role="alert">{message}</p> : null}
        </div>
      </div>

      {confirmOpen ? (
        <div
          className="account-modal-backdrop no-print"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            if (!busy) setConfirmOpen(false);
          }}
        >
          <div
            className="account-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`mark-paid-title-${person.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="account-modal-head">
              <div>
                <p className="workbook-kicker">{MARK_PAID_LABEL}</p>
                <h2 id={`mark-paid-title-${person.id}`}>Confirm payroll disbursed</h2>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Close
              </Button>
            </div>
            <p className="empty-note">{MARK_PAID_CONFIRM}</p>
            {message ? (
              <p className="form-error" role="alert">
                {message}
              </p>
            ) : null}
            <div className="cloud-setup-actions">
              <Button disabled={busy} onClick={() => void handleConfirmPaid()}>
                {busy ? "Marking…" : MARK_PAID_LABEL}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AuthorizedSheetsPrintBatch({
  sheets,
  people,
  dealRows,
  chains,
  period,
}: {
  sheets: AdminEmployeeSheet[];
  people: UserProfile[];
  dealRows?: DealRow[] | null;
  chains?: ApprovalChainRecord[] | null;
  period?: PayPeriodIdentity | null;
}) {
  if (sheets.length === 0) return null;
  const preferred = period ?? activePayPeriod();
  return (
    <div className="admin-print-all-batch" aria-hidden="true">
      {sheets.map((sheet, index) => {
        const person = people.find((row) => row.id === sheet.employeeId);
        if (!person) return null;
        const sheetPeriod = periodFromAdminSheet(sheet, preferred);
        const hydrated = hydrateAdminModalWorksheet({
          sheet,
          employeeId: person.id,
          dealRows: (dealRows ?? []).filter((row) => row.rep_id === person.id),
          chain: (chains ?? []).find((row) => row.employeeId === person.id) ?? null,
          period: preferred,
        });
        return (
          <article
            key={`${sheet.employeeId}-${preferred.key ?? index}`}
            className={`${FINALIZED_PRINT_BATCH_CLASS} ${PRINT_SHEET_CONTAINER_CLASS} print-ready-sheet`}
            data-employee-id={person.id}
          >
            <FinalizedSheetPrintBody person={person} sheet={hydrated} period={sheetPeriod.key ? preferred : preferred} />
          </article>
        );
      })}
    </div>
  );
}
