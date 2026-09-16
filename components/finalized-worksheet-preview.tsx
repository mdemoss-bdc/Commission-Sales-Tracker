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
  MARK_PAID_LABEL,
  PAID_BADGE_LABEL,
  PRINT_SHEET_LABEL,
  activePeriodMonth,
  adminSheetNeedsFallback,
  formatPaidAt,
  hydrateAdminModalWorksheet,
  periodFromAdminSheet,
  printFinalizedSheets,
  printPeriodLabel,
  printStateFromAdminSheet,
} from "@/lib/admin-print";
import { displayName } from "@/lib/names";
import { activePayPeriod, pickSheetsForPeriod, type PayPeriodIdentity } from "@/lib/pay-period";
import { collectWorksheetDeals, extractDealsFromSheetData } from "@/lib/pay-tracker-state";
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
  const month = activePeriodMonth(printState ?? sheet?.state ?? null, new Date(), period);
  const worksheets = pickSheetsForPeriod(month, period);
  const pages = worksheets.length > 0 ? worksheets : month?.sheets ?? [];
  const vehicleTypes = printState?.vehicleTypes ?? sheet?.state?.vehicleTypes ?? [];
  const hasWorksheet = deals.length > 0 || pages.some((row) => (row.sales ?? []).length > 0);

  if (loading && !hasWorksheet) {
    return <p className="empty-note">Loading worksheet…</p>;
  }
  if (!hasWorksheet || !month) {
    return <p className="empty-note">No worksheet data on this finalized sheet.</p>;
  }

  return <PrintWorksheet person={person} month={month} sheets={pages} vehicleTypes={vehicleTypes} />;
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
    if (!adminSheetNeedsFallback(seeded)) {
      setHydrated(seeded);
      setLoading(false);
    }
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
      setHydrated(local);
      setLoading(false);
      return;
    }
    setHydrated(local);
    setLoading(true);
    void (async () => {
      const { loadAdminFinalizedFallbacks } = await import("@/lib/org");
      const extras = await loadAdminFinalizedFallbacks(person.id, preferred);
      if (cancelled) return;
      setHydrated(
        hydrateAdminModalWorksheet({
          sheet: extras.sheet ?? sheet,
          employeeId: person.id,
          dealRows: extras.dealRows.length ? extras.dealRows : dealRows,
          chain,
          tracker: extras.tracker,
          period: preferred,
        }),
      );
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
    const error = await onMarkPaid(person.id);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setConfirmOpen(false);
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
            {paid ? null : (
              <Button type="button" onClick={() => setConfirmOpen(true)}>
                {MARK_PAID_LABEL}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
          {message ? <p className="form-error">{message}</p> : null}
        </div>
      </div>

      {confirmOpen ? (
        <div
          className="account-modal-backdrop no-print"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            setConfirmOpen(false);
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
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
                Close
              </Button>
            </div>
            <p className="empty-note">{MARK_PAID_CONFIRM}</p>
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
}: {
  sheets: AdminEmployeeSheet[];
  people: UserProfile[];
  dealRows?: DealRow[] | null;
  chains?: ApprovalChainRecord[] | null;
}) {
  if (sheets.length === 0) return null;
  return (
    <div className="admin-print-all-batch" aria-hidden="true">
      {sheets.map((sheet) => {
        const person = people.find((row) => row.id === sheet.employeeId);
        if (!person) return null;
        const period = periodFromAdminSheet(sheet, activePayPeriod());
        const hydrated = hydrateAdminModalWorksheet({
          sheet,
          employeeId: person.id,
          dealRows: (dealRows ?? []).filter((row) => row.rep_id === person.id),
          chain: (chains ?? []).find((row) => row.employeeId === person.id) ?? null,
          period,
        });
        return (
          <article
            key={sheet.employeeId}
            className={`${FINALIZED_PRINT_BATCH_CLASS} ${PRINT_SHEET_CONTAINER_CLASS} print-ready-sheet`}
            data-employee-id={person.id}
          >
            <FinalizedSheetPrintBody person={person} sheet={hydrated} period={period} />
          </article>
        );
      })}
    </div>
  );
}
