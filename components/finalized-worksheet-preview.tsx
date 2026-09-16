"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintWorksheet } from "@/components/print-worksheet";
import { isPaidAdminSheet, type AdminEmployeeSheet } from "@/lib/admin-employee-sheets";
import {
  FINALIZED_PRINT_CARD_CLASS,
  MARK_PAID_CONFIRM,
  MARK_PAID_LABEL,
  PAID_BADGE_LABEL,
  PRINT_SHEET_LABEL,
  activePeriodMonth,
  formatPaidAt,
  printFinalizedSheets,
} from "@/lib/admin-print";
import type { UserProfile } from "@/lib/roles";

export function FinalizedWorksheetPreview({
  person,
  sheet,
  onMarkPaid,
}: {
  person: UserProfile;
  sheet: AdminEmployeeSheet | null;
  onMarkPaid: (employeeId: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const paid = isPaidAdminSheet(sheet?.status, sheet?.isPaid);
  const paidAt = formatPaidAt(sheet?.paidAt);
  const month = activePeriodMonth(sheet?.state ?? null);
  const worksheets = month?.sheets ?? [];
  const vehicleTypes = sheet?.state?.vehicleTypes ?? [];

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
    <article
      className={`${FINALIZED_PRINT_CARD_CLASS} print-ready-sheet mx-auto w-[95vw] max-w-7xl ${
        open ? "finalized-print-open" : "finalized-print-collapsed"
      }`}
      data-employee-id={person.id}
    >
      {open ? (
        <div className="finalized-print-chrome no-print">
          <div className="finalized-print-toolbar-copy">
            <p className="workbook-kicker">Print-ready pay sheet</p>
            {paid ? (
              <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
                {PAID_BADGE_LABEL}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="finalized-print-collapsed-bar no-print">
          <p className="workbook-kicker">Print-ready pay sheet</p>
          {paid ? (
            <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
              {PAID_BADGE_LABEL}
            </span>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            View sheet
          </Button>
        </div>
      )}

      {paid && open ? (
        <div className="paid-sheet-banner no-print">
          <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
            {PAID_BADGE_LABEL}
          </span>
          {paidAt ? <p className="empty-note">Payroll disbursed {paidAt}</p> : null}
        </div>
      ) : null}

      <div className="finalized-print-scroll">
        {month ? (
          <PrintWorksheet person={person} month={month} sheets={worksheets} vehicleTypes={vehicleTypes} />
        ) : (
          <p className="empty-note">No worksheet data on this finalized sheet.</p>
        )}
      </div>

      {open ? (
        <div className="finalized-print-footer no-print sticky bottom-0 border-t bg-white p-4">
          <div className="finalized-print-actions">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer data-icon="inline-start" />
              {PRINT_SHEET_LABEL}
            </Button>
            {paid ? null : (
              <Button type="button" onClick={() => setConfirmOpen(true)}>
                {MARK_PAID_LABEL}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
          {message ? <p className="form-error">{message}</p> : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="account-modal-backdrop no-print" role="presentation" onClick={() => setConfirmOpen(false)}>
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
    </article>
  );
}
