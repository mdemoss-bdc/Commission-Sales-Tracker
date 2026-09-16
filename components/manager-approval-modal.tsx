"use client";

import { useMemo, useState } from "react";
import { PrintWorksheet } from "@/components/print-worksheet";
import { Button } from "@/components/ui/button";
import {
  APPROVE_PUSH_TO_ADMIN_LABEL,
  REJECT_CHANGES_LABEL,
  formatSignedMoney,
  type ApprovalChainRecord,
} from "@/lib/approval-chain";
import type { DealRow } from "@/lib/deal-records";
import { displayName } from "@/lib/names";
import { buildManagerReviewView } from "@/lib/manager-review-sheet";
import type { UserProfile } from "@/lib/roles";

export function ManagerApprovalModal({
  person,
  chain,
  dealRows,
  busy,
  error,
  onClose,
  onAuthorize,
  onReject,
}: {
  person: UserProfile;
  chain: ApprovalChainRecord;
  dealRows: DealRow[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onAuthorize: () => void;
  onReject: (reason: string) => void;
}) {
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const review = useMemo(
    () =>
      buildManagerReviewView({
        baseline: chain.adminBaseline,
        draft: chain.repDraft,
        dealRows,
      }),
    [chain.adminBaseline, chain.repDraft, dealRows],
  );

  return (
    <div className="account-modal-backdrop no-print" role="presentation" onClick={onClose}>
      <div
        className="account-modal pushed-sheet-modal manager-review-modal mx-auto w-[95vw] max-w-7xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rep-diff-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="manager-review-chrome">
          <div className="account-modal-head">
            <div>
              <p className="workbook-kicker">Employee submitted changes</p>
              <h2 id="rep-diff-title">{displayName(person)}</h2>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>

          <div className="review-delta-bar manager-review-delta" data-tone={review.payDelta.tone}>
            <div className="review-delta-pair review-delta-net">
              <span className="review-delta-label">Total pay delta</span>
              <strong>{formatSignedMoney(review.payDelta.delta)}</strong>
            </div>
            <div className="manager-review-notes">
              {review.notes.length === 0 ? (
                <p className="empty-note">No line-item differences were logged.</p>
              ) : (
                <ul>
                  {review.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="manager-review-body print-ready-sheet">
          {review.month ? (
            <PrintWorksheet
              person={person}
              month={review.month}
              sheets={review.sheets}
              vehicleTypes={review.vehicleTypes}
              reviewBaseline={review.baseline}
            />
          ) : (
            <p className="empty-note">No worksheet data on this submitted sheet.</p>
          )}
        </div>

        <div className="manager-review-footer sticky bottom-0 border-t bg-white p-4">
          {denyOpen ? (
            <div className="manager-review-reject">
              <label className="field-label" htmlFor="manager-deny-reason">
                Rejection reason
              </label>
              <textarea
                id="manager-deny-reason"
                className="text-input"
                rows={3}
                value={denyReason}
                onChange={(event) => setDenyReason(event.target.value)}
                placeholder="Explain what needs to be corrected"
              />
              <p className="empty-note">
                The sales rep will see these notes, fix the sheet, and re-submit.
              </p>
              <div className="manager-review-actions">
                <Button
                  variant="destructive"
                  disabled={busy || !denyReason.trim()}
                  onClick={() => onReject(denyReason)}
                >
                  {busy ? "Rejecting…" : REJECT_CHANGES_LABEL}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setDenyOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="manager-review-actions">
              <Button
                className="manager-authorize-btn"
                size="lg"
                disabled={busy}
                onClick={() => void onAuthorize()}
              >
                {busy ? "Submitting…" : APPROVE_PUSH_TO_ADMIN_LABEL}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDenyOpen(true);
                  setDenyReason("");
                }}
              >
                {REJECT_CHANGES_LABEL}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Close
              </Button>
            </div>
          )}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
