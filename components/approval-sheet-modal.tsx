"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import type { ApprovalSheetGroup } from "@/lib/approval-sheet";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export type ApprovalMode = "manager" | "admin";

export function ApprovalSheetModal({
  group,
  repName,
  mode,
  busy,
  error,
  onClose,
  onApprove,
  onReject,
  onReturn,
}: {
  group: ApprovalSheetGroup;
  repName: string;
  mode: ApprovalMode;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onReturn?: () => void;
}) {
  const titleId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const canPortal = useBrowserDocument();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (!canPortal) return null;

  return createPortal(
    <div className="account-modal-backdrop" onClick={() => (busy ? undefined : onClose())}>
      <section
        className="account-modal approval-sheet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="workbook-kicker">{mode === "admin" ? "Admin final sign-off" : "Manager approval"}</p>
        <h2 id={titleId}>
          {repName} · {group.title}
        </h2>
        <p className="auth-lead">
          {mode === "admin"
            ? "Red cells are values the employee changed or added. Final approve writes this sheet into live records."
            : "This is the full sheet for this rep and month. Red cells are values the employee changed or added versus the prior figures. Hover a highlighted cell to see what it was before."}
        </p>

        <div className="sheet-frame approval-sheet-frame">
          <div className="sheet-scroll">
            <table className="sheet-table approval-diff-table">
              <thead>
                <tr>
                  <th className="row-head" scope="col">
                    #
                  </th>
                  <th scope="col">Stock #</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Deal type</th>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Trade</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Flat</th>
                  <th scope="col">F&I</th>
                  <th scope="col">Service</th>
                  <th scope="col">Commission</th>
                </tr>
              </thead>
              <tbody>
                {group.sales.length === 0 ? (
                  <tr>
                    <td className="row-head">1</td>
                    <td colSpan={10} className="empty-cell">
                      No deals on this sheet.
                    </td>
                  </tr>
                ) : (
                  group.sales.map((row, index) => (
                    <tr key={row.id}>
                      <td className="row-head">{index + 1}</td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.key}
                          className={cell.kind === "unchanged" ? undefined : "cell-diff"}
                          tabIndex={cell.kind === "unchanged" ? undefined : 0}
                        >
                          {cell.value}
                          {cell.tooltip ? <span className="cell-tip">{cell.tooltip}</span> : null}
                        </td>
                      ))}
                      <td>{formatMoney(row.commission)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {group.extras.length > 0 ? (
          <div className="approval-extras">
            <h3>Other pay</h3>
            <dl className="review-facts">
              {group.extras.map((cell) => (
                <div key={cell.key} className={cell.kind === "unchanged" ? undefined : "cell-diff extra-diff"} tabIndex={cell.kind === "unchanged" ? undefined : 0}>
                  <dt>{cell.label}</dt>
                  <dd>
                    {cell.value}
                    {cell.tooltip ? <span className="cell-tip">{cell.tooltip}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <div className="confirm-modal-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {mode === "manager" ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRejecting((open) => !open)}>
                Reject with Reason
              </Button>
              <Button type="button" disabled={busy} onClick={onApprove}>
                {busy ? "Forwarding…" : "Approve & Forward to Admin"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={onReturn}>
                Return to Manager
              </Button>
              <Button type="button" disabled={busy} onClick={onApprove}>
                {busy ? "Locking…" : "Final Approve & Lock into Live Records"}
              </Button>
            </>
          )}
        </div>

        {rejecting && mode === "manager" ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason.trim()) return;
              onReject(reason.trim());
            }}
          >
            <label>
              Reject reason
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this should go back to the rep"
                required
              />
            </label>
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              Confirm reject
            </Button>
          </form>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>,
    document.body,
  );
}
