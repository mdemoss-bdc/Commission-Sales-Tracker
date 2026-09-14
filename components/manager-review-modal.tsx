"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retryCloudSync } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import {
  classifyReviewItems,
  resolutionForChoice,
  type ReviewChoice,
  type ReviewItem,
} from "@/lib/rep-review";
import { formatMoney } from "@/lib/format";
import { dealTypeLabel } from "@/lib/deal-types";
import type { DealPayload } from "@/lib/deal-records";

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function saleLines(payload: DealPayload | null) {
  if (!payload?.sale) {
    return payload
      ? [
          ["Record", payload.kind === "sheet" ? "Worksheet extras" : payload.kind === "vehicle_type" ? "Vehicle type" : "Record"],
        ]
      : [];
  }
  const sale = payload.sale;
  return [
    ["Stock #", sale.stockNumber || "—"],
    ["Customer", sale.customerName || "—"],
    ["Deal type", dealTypeLabel(sale.dealType)],
    ["Trade-in", sale.tradeIn ? "Yes" : "No"],
    ["Gross", formatMoney(sale.gross)],
    ["Flat", formatMoney(sale.flat)],
    ["F&I", formatMoney(sale.fi)],
    ["Service", formatMoney(sale.service)],
  ] as const;
}

export function ManagerReviewHost() {
  const org = useOrg();
  const { resolveReview } = useOrgActions();
  const pathname = usePathname();
  const canPortal = useBrowserDocument();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});

  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const classified = useMemo(() => classifyReviewItems(mine), [mine]);
  const show = Boolean(org.profile?.role === "rep" && (classified.items.length > 0 || classified.autoResolve.length > 0));

  const autoKey = classified.autoResolve.map((item) => item.id).sort().join(",");

  useEffect(() => {
    if (classified.items.length > 0) setOpen(true);
  }, [classified.items.length, pathname]);

  useEffect(() => {
    if (!show || classified.items.length > 0 || !autoKey) return;
    let cancelled = false;
    setBusy(true);
    void resolveReview(classified.autoResolve).then((message) => {
      if (cancelled) return;
      setBusy(false);
      if (!message) retryCloudSync();
    });
    return () => {
      cancelled = true;
    };
  }, [show, classified.items.length, autoKey, classified.autoResolve, resolveReview]);

  if (!show || !canPortal) return null;

  const unresolved = classified.items.filter((item) => !choices[item.id]);

  async function handleConfirm() {
    if (unresolved.length > 0) return;
    setBusy(true);
    setError("");
    const decisions = [
      ...classified.autoResolve,
      ...classified.items.map((item) => resolutionForChoice(item, choices[item.id])),
    ];
    const message = await resolveReview(decisions);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setChoices({});
    setOpen(false);
    retryCloudSync();
  }

  return (
    <>
      {classified.items.length > 0 && !open ? (
        <button type="button" className="review-fab no-print" onClick={() => setOpen(true)}>
          Manager updates waiting for review
        </button>
      ) : null}
      {open && classified.items.length > 0
        ? createPortal(
            <ReviewPanel
              items={classified.items}
              choices={choices}
              busy={busy}
              error={error}
              unresolved={unresolved.length}
              onChoice={(id, choice) => setChoices((current) => ({ ...current, [id]: choice }))}
              onClose={() => setOpen(false)}
              onConfirm={() => void handleConfirm()}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ReviewPanel({
  items,
  choices,
  busy,
  error,
  unresolved,
  onChoice,
  onClose,
  onConfirm,
}: {
  items: ReviewItem[];
  choices: Record<string, ReviewChoice>;
  busy: boolean;
  error: string;
  unresolved: number;
  onChoice: (id: string, choice: ReviewChoice) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="account-modal-backdrop" onClick={() => (busy ? undefined : onClose())}>
      <section
        className="account-modal review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="workbook-kicker">Employee review</p>
        <h2 id={titleId}>Manager Updates Waiting for Review</h2>
        <p className="auth-lead">
          These were pushed to you without changing your live records. Accept new deals to add them, or pick whose
          numbers to keep when the same stock number already exists.
        </p>
        <ul className="review-item-list">
          {items.map((item) => (
            <li key={item.id} className="review-item">
              <h3>{item.kind === "addition" ? "Brand new deal" : "Conflicting deal"}</h3>
              <p className="empty-note">{item.title}</p>
              {item.kind === "addition" ? (
                <>
                  <dl className="review-facts">
                    {saleLines(item.manager).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="review-choice-row">
                    <Button
                      type="button"
                      size="sm"
                      variant={choices[item.id] === "accept" ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => onChoice(item.id, "accept")}
                    >
                      Accept & Add to Sheet
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={choices[item.id] === "decline" ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => onChoice(item.id, "decline")}
                    >
                      Decline
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="review-compare">
                    <label className={choices[item.id] === "keep_mine" ? "review-column selected" : "review-column"}>
                      <input
                        type="radio"
                        name={`review-${item.id}`}
                        checked={choices[item.id] === "keep_mine"}
                        disabled={busy}
                        onChange={() => onChoice(item.id, "keep_mine")}
                      />
                      <strong>Column A · Your entry</strong>
                      <span>Keep Mine</span>
                      <dl className="review-facts">
                        {saleLines(item.mine).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </label>
                    <label className={choices[item.id] === "use_manager" ? "review-column selected" : "review-column"}>
                      <input
                        type="radio"
                        name={`review-${item.id}`}
                        checked={choices[item.id] === "use_manager"}
                        disabled={busy}
                        onChange={() => onChoice(item.id, "use_manager")}
                      />
                      <strong>Column B · Manager entry</strong>
                      <span>Use Manager&apos;s</span>
                      <dl className="review-facts">
                        {saleLines(item.manager).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </label>
                  </div>
                  {item.diffs.length > 0 ? (
                    <table className="mini-sheet diff-table">
                      <thead>
                        <tr>
                          <th scope="col">Field</th>
                          <th scope="col">Yours</th>
                          <th scope="col">Manager</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.diffs.map((diff) => (
                          <tr key={diff.label}>
                            <th scope="row">{diff.label}</th>
                            <td>{diff.before}</td>
                            <td>{diff.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="confirm-modal-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Review later
          </Button>
          <Button type="button" disabled={busy || unresolved > 0} onClick={onConfirm}>
            {busy ? "Saving…" : "Confirm selections"}
          </Button>
        </div>
        {unresolved > 0 ? (
          <p className="empty-note">Choose Keep Mine or Use Manager’s, or Accept / Decline, on every item.</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </div>
  );
}
