"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ExtraPayForm } from "@/components/extra-pay-form";
import { SalesSheet } from "@/components/sales-sheet";
import { Button } from "@/components/ui/button";
import { createBonus, createSale, vacationFields } from "@/lib/commission";
import { assembleLiveState } from "@/lib/deal-records";
import { classifyReviewItems } from "@/lib/rep-review";
import { invalidateOrgCache, useOrg, useOrgActions, usePayTiers } from "@/lib/org-store";
import { insertPendingManagerPayloads } from "@/lib/org";
import { findMonth, findSheet, mapSheet } from "@/lib/records";
import { formatMoney } from "@/lib/format";
import { markDuplicateConfirmed } from "@/lib/duplicate-sales";
import { summarizeSheet } from "@/lib/summaries";
import { showSyncToast } from "@/lib/sync-feedback";
import {
  ACCEPT_ADMIN_NUMBERS_LABEL,
  CLOSE_DISMISS_LABEL,
  SUBMIT_RECONCILED_SHEET_LABEL,
  clearPushReviewSession,
  dismissPushReviewSession,
  hasMeaningfulPushSheet,
  isAdminLedgerActivelyPushed,
  isPushReviewSessionDismissed,
} from "@/lib/push-review";
import { reviewDeltaDisplay, SUBMITTED_TO_MANAGER_BANNER, isAwaitingRepAction, isPayPeriodLockedForRep } from "@/lib/approval-chain";
import { clearEditingPushedSheet } from "@/lib/pushed-sheet-edit";
import {
  isPaidAdminSheet,
  loadAdminEmployeeSheet,
  loadMyAdminSheetLockStatus,
} from "@/lib/admin-employee-sheets";
import { clearIncomingPush, flushTrackerSave, retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import {
  compareExtras,
  compareSaleRows,
  extrasFromSheet,
  itemBelongsToSheet,
  applyManagerSheetToState,
  leftoverEditedSales,
  leftoverEditedSheet,
  mergeVehicleTypes,
  payloadForEditedSale,
  paySheetFromParts,
  resolvedStagedSheetFor,
  sheetFromTracker,
  stagedMonthFor,
  stagedVehicleTypes,
  type ExtraPaySnapshot,
} from "@/lib/sheet-compare";
import type { ExtraPay, Sale, VehicleTypeOption } from "@/lib/types";

export function usePendingSheetReview(monthId: string, sheetId: string) {
  const org = useOrg();
  const [ledgerLocked, setLedgerLocked] = useState(false);
  const [adminLedgerActive, setAdminLedgerActive] = useState<boolean | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const userId = org.profile?.id ?? "";
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const classified = useMemo(() => classifyReviewItems(mine), [mine]);
  const items = classified.items.filter((item) => itemBelongsToSheet(item, monthId, sheetId));
  const autoResolve = classified.autoResolve;
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const dealLocked = mine.some((row) => isPayPeriodLockedForRep(row.status));
  const chainLocked = isPayPeriodLockedForRep(chain?.status);
  const periodLocked = ledgerLocked || chainLocked || dealLocked;

  useEffect(() => {
    if (!userId) {
      setSessionDismissed(false);
      return;
    }
    setSessionDismissed(isPushReviewSessionDismissed(userId, monthId));
  }, [userId, monthId]);

  useEffect(() => {
    if (org.profile?.role !== "rep" || !userId) {
      setLedgerLocked(false);
      setAdminLedgerActive(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [lockRow, sheetLoad] = await Promise.all([
        loadMyAdminSheetLockStatus(monthId),
        loadAdminEmployeeSheet(userId, monthId),
      ]);
      if (cancelled) return;
      setLedgerLocked(
        Boolean(
          lockRow &&
            (lockRow.isPaid ||
              isPaidAdminSheet(lockRow.status, lockRow.isPaid) ||
              isPayPeriodLockedForRep(lockRow.status)),
        ),
      );
      const ledgerRow = sheetLoad.status === "ready" ? sheetLoad.row : null;
      if (sheetLoad.status === "missing" || sheetLoad.status === "error") {
        // Ledger unavailable — fall back to deal-row / staged content checks only.
        setAdminLedgerActive(null);
        return;
      }
      const activePush = isAdminLedgerActivelyPushed(ledgerRow);
      setAdminLedgerActive(activePush);
      if (!ledgerRow || !activePush) {
        clearPushReviewSession(userId, monthId);
        // Cleared dismiss flag so a future real push can show again after reset.
        setSessionDismissed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monthId, org.profile?.role, org.profile?.id, org.allDeals, org.approvalChains, userId]);

  const baselineSheet = useMemo(() => {
    const sheet = sheetFromTracker(chain?.adminBaseline, monthId, sheetId);
    return hasMeaningfulPushSheet(sheet) ? sheet : null;
  }, [chain?.adminBaseline, monthId, sheetId]);
  const baselineMonth = useMemo(
    () => (chain?.adminBaseline ? findMonth(chain.adminBaseline, monthId) : null),
    [chain?.adminBaseline, monthId],
  );
  const stagedSheet = useMemo(() => {
    const sheet = resolvedStagedSheetFor(mine, monthId, sheetId);
    return hasMeaningfulPushSheet(sheet) ? sheet : null;
  }, [mine, monthId, sheetId]);
  const pushedSheet = useMemo(() => {
    if (adminLedgerActive === false) return null;
    return stagedSheet ?? (adminLedgerActive === true || adminLedgerActive === null ? baselineSheet : null);
  }, [adminLedgerActive, baselineSheet, stagedSheet]);
  const pushedMonth = useMemo(
    () => (pushedSheet ? stagedMonthFor(mine, monthId) ?? baselineMonth : null),
    [baselineMonth, mine, monthId, pushedSheet],
  );
  const active = Boolean(
    !periodLocked &&
      !sessionDismissed &&
      org.profile?.role === "rep" &&
      adminLedgerActive !== false &&
      (items.length > 0 ||
        Boolean(pushedSheet) ||
        (isAwaitingRepAction(chain?.status) && Boolean(pushedSheet))),
  );

  function dismissReview() {
    if (userId) dismissPushReviewSession(userId, monthId);
    setSessionDismissed(true);
    clearIncomingPush();
    clearEditingPushedSheet();
  }

  return {
    active,
    periodLocked,
    items,
    autoResolve,
    pushedSheet,
    pushedMonth,
    classified,
    mine,
    chain,
    adminLedgerActive,
    sessionDismissed,
    dismissReview,
  };
}

function extrasKey(extras: ExtraPaySnapshot) {
  return [
    extras.vacationHours,
    extras.vacationRate,
    extras.vacationPay,
    extras.bonuses.map((bonus) => `${bonus.id}:${bonus.label}:${bonus.amount}`).join("|"),
  ].join("::");
}

function copyExtras(extras: ExtraPaySnapshot): ExtraPaySnapshot {
  return {
    regularHours: extras.regularHours ?? 0,
    hourlyRate: extras.hourlyRate ?? 0,
    vacationHours: extras.vacationHours,
    vacationRate: extras.vacationRate,
    vacationPay: extras.vacationPay,
    bonuses: extras.bonuses.map((bonus) => ({ ...bonus })),
  };
}

function salesKey(sales: Sale[]) {
  return sales.map((sale) => `${sale.id}:${sale.stockNumber}:${sale.gross}:${sale.flat}:${sale.fi}:${sale.service}`).join("|");
}

export function DualSheetReview({
  monthId,
  sheetId,
  year,
  month,
  liveSales,
  liveExtras,
  vehicleTypes,
  firstInputRef,
  onAccepted,
  onClose,
  hideActions = false,
}: {
  monthId: string;
  sheetId: string;
  year: number;
  month: number;
  liveSales: Sale[];
  liveExtras: ExtraPaySnapshot;
  vehicleTypes: VehicleTypeOption[];
  firstInputRef?: RefObject<HTMLInputElement | null>;
  onAccepted?: () => void;
  onClose?: () => void;
  hideActions?: boolean;
}) {
  const { items, pushedSheet, pushedMonth, classified, mine, dismissReview } = usePendingSheetReview(monthId, sheetId);
  const { acceptPushedSheet, submitChangesToManager } = useOrgActions();
  const org = useOrg();
  const [, setState] = useTrackerStore();
  const payTiers = usePayTiers();
  const router = useRouter();
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const draftState = useMemo(() => assembleLiveState(mine), [mine]);
  const draftSheet = useMemo(() => {
    const draftMonth = findMonth(draftState, monthId);
    return draftMonth ? findSheet(draftMonth, sheetId) ?? null : null;
  }, [draftState, monthId, sheetId]);
  const adminSource = useMemo(
    () => sheetFromTracker(chain?.adminBaseline, monthId, sheetId) ?? pushedSheet,
    [chain?.adminBaseline, monthId, pushedSheet, sheetId],
  );
  const workingSource = useMemo(() => {
    if (liveSales.length > 0) {
      return paySheetFromParts(sheetId, liveSales, liveExtras, {
        startDay: draftSheet?.startDay ?? adminSource?.startDay,
        endDay: draftSheet?.endDay ?? adminSource?.endDay,
      });
    }
    const fromDraft = draftSheet && (draftSheet.sales ?? []).length > 0 ? draftSheet : null;
    return fromDraft ?? sheetFromTracker(chain?.repDraft, monthId, sheetId);
  }, [adminSource?.endDay, adminSource?.startDay, chain?.repDraft, draftSheet, liveExtras, liveSales, monthId, sheetId]);
  const submitItems = useMemo(() => {
    const seen = new Set(items.map((item) => item.id));
    const vehicleItems = classified.items.filter((item) => item.manager?.kind === "vehicle_type" && !seen.has(item.id));
    return [...items, ...vehicleItems];
  }, [classified.items, items]);
  const initialAdminSales = useMemo(() => {
    if (adminSource?.sales.length) return adminSource.sales.map((sale) => ({ ...sale }));
    return items.map((item) => item.manager?.sale).filter((sale): sale is Sale => Boolean(sale)).map((sale) => ({ ...sale }));
  }, [adminSource, items]);
  const initialAdminExtras = useMemo(() => copyExtras(extrasFromSheet(adminSource)), [adminSource]);
  const initialWorkingSales = useMemo(
    () => (workingSource?.sales ?? liveSales).map((sale) => ({ ...sale })),
    [liveSales, workingSource],
  );
  const initialWorkingExtras = useMemo(
    () => copyExtras(workingSource ? extrasFromSheet(workingSource) : liveExtras),
    [liveExtras, workingSource],
  );
  const [adminSales, setAdminSales] = useState<Sale[]>(initialAdminSales);
  const [adminExtras, setAdminExtras] = useState<ExtraPaySnapshot>(initialAdminExtras);
  const [workingSales, setWorkingSales] = useState<Sale[]>(initialWorkingSales);
  const [workingExtras, setWorkingExtras] = useState<ExtraPaySnapshot>(initialWorkingExtras);
  const [busy, setBusy] = useState<"confirm" | "accept" | null>(null);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const adminMonthSales = useMemo(() => {
    const other = (pushedMonth?.sheets ?? [])
      .filter((sheet) => sheet.id !== sheetId)
      .flatMap((sheet) => sheet.sales ?? []);
    return [...other, ...adminSales];
  }, [adminSales, pushedMonth?.sheets, sheetId]);
  const workingMonthSales = useMemo(() => {
    const other = (draftState.months.find((row) => row.id === monthId)?.sheets ?? [])
      .filter((sheet) => sheet.id !== sheetId)
      .flatMap((sheet) => sheet.sales ?? []);
    return [...other, ...workingSales];
  }, [draftState.months, monthId, sheetId, workingSales]);
  const pushIdentityKey = [
    monthId,
    sheetId,
    salesKey(initialAdminSales),
    extrasKey(initialAdminExtras),
  ].join("##");
  const reviewTypes = useMemo(
    () =>
      mergeVehicleTypes(
        mergeVehicleTypes(vehicleTypes, stagedVehicleTypes(mine)),
        [
          ...(chain?.adminBaseline?.vehicleTypes ?? []),
          ...(chain?.repDraft?.vehicleTypes ?? []),
        ],
      ),
    [chain?.adminBaseline?.vehicleTypes, chain?.repDraft?.vehicleTypes, mine, vehicleTypes],
  );

  useEffect(() => {
    setAdminSales(initialAdminSales);
    setAdminExtras(initialAdminExtras);
    setWorkingSales(initialWorkingSales);
    setWorkingExtras(initialWorkingExtras);
    // Reset only when the incoming admin push identity changes, not when local working edits echo back through liveSales.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pushIdentityKey is the reset signal
  }, [pushIdentityKey]);

  const compared = useMemo(() => compareSaleRows(workingSales, adminSales), [adminSales, workingSales]);
  const extraHighlights = useMemo(
    () => compareExtras(workingExtras, adminExtras),
    [adminExtras, workingExtras],
  );
  const range = {
    startDay: adminSource?.startDay ?? workingSource?.startDay ?? 1,
    endDay: adminSource?.endDay ?? workingSource?.endDay ?? 15,
  };
  const adminTotals = useMemo(
    () => summarizeSheet(paySheetFromParts(sheetId, adminSales, adminExtras, range), payTiers),
    [adminExtras, adminSales, payTiers, range.endDay, range.startDay, sheetId],
  );
  const workingTotals = useMemo(
    () => summarizeSheet(paySheetFromParts(sheetId, workingSales, workingExtras, range), payTiers),
    [payTiers, range.endDay, range.startDay, sheetId, workingExtras, workingSales],
  );
  const delta = reviewDeltaDisplay(adminTotals.pay, workingTotals.pay);

  function persistWorking(sales: Sale[], extras: ExtraPaySnapshot) {
    const sheet = paySheetFromParts(sheetId, sales, extras, range);
    setState((current) => {
      const currentMonth = findMonth(current, monthId);
      if (!currentMonth || !findSheet(currentMonth, sheetId)) {
        return applyManagerSheetToState(current, monthId, sheetId, sheet, { year, month });
      }
      return mapSheet(current, monthId, sheetId, () => sheet);
    });
  }

  function updateAdminSale(id: string, patch: Partial<Sale>) {
    setAdminSales((current) => current.map((sale) => (sale.id === id ? { ...sale, ...patch } : sale)));
  }

  function updateWorkingSale(id: string, patch: Partial<Sale>) {
    setWorkingSales((current) => {
      const next = current.map((sale) => (sale.id === id ? { ...sale, ...patch } : sale));
      persistWorking(next, workingExtras);
      return next;
    });
  }

  function removeAdminSale(id: string, options?: { skipConfirm?: boolean }) {
    const sale = adminSales.find((row) => row.id === id);
    if (
      !options?.skipConfirm &&
      sale &&
      (sale.stockNumber.trim() || sale.customerName.trim()) &&
      !window.confirm("Remove this row from the admin pushed worksheet?")
    ) {
      return;
    }
    setAdminSales((current) => current.filter((row) => row.id !== id));
  }

  function removeWorkingSale(id: string, options?: { skipConfirm?: boolean }) {
    const sale = workingSales.find((row) => row.id === id);
    if (
      !options?.skipConfirm &&
      sale &&
      (sale.stockNumber.trim() || sale.customerName.trim()) &&
      !window.confirm("Remove this row from your working worksheet?")
    ) {
      return;
    }
    setWorkingSales((current) => {
      const next = current.filter((row) => row.id !== id);
      persistWorking(next, workingExtras);
      return next;
    });
  }

  function updateAdminExtras(next: ExtraPaySnapshot) {
    setAdminExtras(next);
  }

  function updateWorkingExtras(next: ExtraPaySnapshot) {
    setWorkingExtras(next);
    persistWorking(workingSales, next);
  }

  async function handleConfirm() {
    setBusy("confirm");
    setError("");
    try {
      const sheetFallback = {
        monthId,
        sheetId,
        entityId: sheetId,
        year,
        month,
        startDay: range.startDay,
        endDay: range.endDay,
      };
      const leftoverSales = leftoverEditedSales(submitItems, workingSales);
      const leftoverSheet = leftoverEditedSheet(submitItems, workingExtras, sheetFallback);
      const leftovers = [
        ...leftoverSales.map((sale) => payloadForEditedSale(null, sale, sheetFallback)),
        ...(leftoverSheet ? [leftoverSheet] : []),
      ];
      const { getTrackerSnapshot } = await import("@/lib/tracker-store");
      const editedSheet = paySheetFromParts(sheetId, workingSales, workingExtras, range);
      const nextState = applyManagerSheetToState(getTrackerSnapshot(), monthId, sheetId, editedSheet, { year, month });
      setState(nextState);
      await flushTrackerSave();
      let message = await submitChangesToManager(nextState);
      if (!message && leftovers.length > 0) {
        message = await insertPendingManagerPayloads(leftovers);
      }
      if (message) {
        console.error("Submit Reconciled Sheet to Manager failed:", message);
        setError(message);
        window.alert(message);
        showSyncToast(message);
        return;
      }
      setSubmitted(true);
      showSyncToast(SUBMITTED_TO_MANAGER_BANNER);
      await invalidateOrgCache();
      retryCloudSync();
      router.refresh();
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      console.error("Submit Reconciled Sheet to Manager failed:", cause);
      const fallback = text || "Could not submit the reconciled sheet to your manager.";
      setError(fallback);
      window.alert(fallback);
      showSyncToast(fallback);
    } finally {
      setBusy(null);
    }
  }

  async function handleAcceptAdmin() {
    setBusy("accept");
    setError("");
    clearIncomingPush();
    clearEditingPushedSheet();
    const adminSheet = paySheetFromParts(sheetId, adminSales, adminExtras, range);
    setState((current) => applyManagerSheetToState(current, monthId, sheetId, adminSheet, { year, month }));
    const message = await acceptPushedSheet(monthId, sheetId);
    await flushTrackerSave();
    setBusy(null);
    if (message) {
      setError(message);
      return;
    }
    onAccepted?.();
    await invalidateOrgCache();
    retryCloudSync();
    router.refresh();
  }

  return (
    <div className="dual-sheet-review">
      <div className="dual-sheet-bar no-print">
        <div>
          <p className="workbook-kicker">Pushed numbers review</p>
          <h2>Admin pushed worksheet vs your working sheet</h2>
          <p className="empty-note">
            Edit either table in place. Totals and the pay difference update as you type. Accept commits the admin table;
            Submit sends your working sheet to the manager. Close keeps your drafts.
          </p>
        </div>
        {hideActions ? null : (
          <div className="cloud-setup-actions">
            <Button disabled={Boolean(busy)} onClick={() => void handleAcceptAdmin()}>
              {busy === "accept" ? "Saving…" : ACCEPT_ADMIN_NUMBERS_LABEL}
            </Button>
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => void handleConfirm()}>
              {busy === "confirm" ? "Submitting…" : SUBMIT_RECONCILED_SHEET_LABEL}
            </Button>
            {onClose || dismissReview ? (
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => {
                  dismissReview();
                  onClose?.();
                }}
              >
                {CLOSE_DISMISS_LABEL}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {submitted ? (
        <p className="form-success" role="status">
          {SUBMITTED_TO_MANAGER_BANNER}
        </p>
      ) : null}

      <div className="review-delta-bar no-print" data-tone={delta.tone}>
        <div className="review-delta-pair">
          <span className="review-delta-label">Admin Pay</span>
          <strong>{formatMoney(adminTotals.pay)}</strong>
        </div>
        <div className="review-delta-pair">
          <span className="review-delta-label">Your Pay</span>
          <strong>{formatMoney(workingTotals.pay)}</strong>
        </div>
        <div className="review-delta-pair review-delta-net">
          <span className="review-delta-label">Net Difference</span>
          <strong>{delta.label}</strong>
        </div>
      </div>

      <section className="dual-sheet-section">
        <div className="dual-sheet-heading">
          <h3>Admin Pushed Worksheet</h3>
          <Button className="no-print" variant="outline" size="sm" onClick={() => setAdminSales((current) => [...current, createSale()])}>
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        </div>
        <SalesSheet
          sales={adminSales}
          monthSales={adminMonthSales}
          vehicleTypes={reviewTypes}
          onUpdate={updateAdminSale}
          onRemove={(id) => removeAdminSale(id)}
          onRemoveDuplicate={(id) => removeAdminSale(id, { skipConfirm: true })}
          onConfirmDuplicate={(id) =>
            setAdminSales((current) => current.map((sale) => (sale.id === id ? markDuplicateConfirmed(sale) : sale)))
          }
          onAddRow={() => setAdminSales((current) => [...current, createSale()])}
          firstInputRef={firstInputRef}
          compared={compared.manager}
          emptyNote="No deals on the admin push. Add a row or copy values into your working sheet."
        />
        <ExtraPayForm
          idPrefix="admin-pushed"
          regularHours={adminExtras.regularHours ?? 0}
          hourlyRate={adminExtras.hourlyRate ?? 0}
          vacationHours={adminExtras.vacationHours}
          vacationRate={adminExtras.vacationRate}
          vacationPay={adminExtras.vacationPay}
          bonuses={adminExtras.bonuses}
          highlights={extraHighlights.pushed}
          onRegularChange={(hours, rate) =>
            updateAdminExtras({
              ...adminExtras,
              regularHours: hours,
              hourlyRate: rate,
            })
          }
          onVacationChange={(hours, rate) =>
            updateAdminExtras({
              ...adminExtras,
              ...vacationFields(hours, rate, adminExtras.vacationPay),
            })
          }
          onAddBonus={() =>
            updateAdminExtras({
              ...adminExtras,
              bonuses: [...adminExtras.bonuses, createBonus()],
            })
          }
          onUpdateBonus={(id, patch) =>
            updateAdminExtras({
              ...adminExtras,
              bonuses: adminExtras.bonuses.map((bonus) => (bonus.id === id ? { ...bonus, ...patch } : bonus)),
            })
          }
          onRemoveBonus={(id) =>
            updateAdminExtras({
              ...adminExtras,
              bonuses: adminExtras.bonuses.filter((bonus) => bonus.id !== id),
            })
          }
        />
      </section>

      <section className="dual-sheet-section">
        <div className="dual-sheet-heading">
          <h3>Your Working Worksheet</h3>
          <Button
            className="no-print"
            variant="outline"
            size="sm"
            onClick={() => {
              const next = [...workingSales, createSale()];
              setWorkingSales(next);
              persistWorking(next, workingExtras);
            }}
          >
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        </div>
        <SalesSheet
          sales={workingSales}
          monthSales={workingMonthSales}
          vehicleTypes={reviewTypes}
          onUpdate={updateWorkingSale}
          onRemove={(id) => removeWorkingSale(id)}
          onRemoveDuplicate={(id) => removeWorkingSale(id, { skipConfirm: true })}
          onConfirmDuplicate={(id) => {
            setWorkingSales((current) => {
              const next = current.map((sale) => (sale.id === id ? markDuplicateConfirmed(sale) : sale));
              persistWorking(next, workingExtras);
              return next;
            });
          }}
          onAddRow={() => {
            const next = [...workingSales, createSale()];
            setWorkingSales(next);
            persistWorking(next, workingExtras);
          }}
          compared={compared.live}
          emptyNote="Your working sheet is empty. Add rows or accept the admin numbers above."
        />
        <ExtraPayForm
          idPrefix="working-draft"
          regularHours={workingExtras.regularHours ?? 0}
          hourlyRate={workingExtras.hourlyRate ?? 0}
          vacationHours={workingExtras.vacationHours}
          vacationRate={workingExtras.vacationRate}
          vacationPay={workingExtras.vacationPay}
          bonuses={workingExtras.bonuses}
          highlights={extraHighlights.live}
          onRegularChange={(hours, rate) =>
            updateWorkingExtras({
              ...workingExtras,
              regularHours: hours,
              hourlyRate: rate,
            })
          }
          onVacationChange={(hours, rate) =>
            updateWorkingExtras({
              ...workingExtras,
              ...vacationFields(hours, rate, workingExtras.vacationPay),
            })
          }
          onAddBonus={() =>
            updateWorkingExtras({
              ...workingExtras,
              bonuses: [...workingExtras.bonuses, createBonus()],
            })
          }
          onUpdateBonus={(id, patch: Partial<ExtraPay>) =>
            updateWorkingExtras({
              ...workingExtras,
              bonuses: workingExtras.bonuses.map((bonus) => (bonus.id === id ? { ...bonus, ...patch } : bonus)),
            })
          }
          onRemoveBonus={(id) =>
            updateWorkingExtras({
              ...workingExtras,
              bonuses: workingExtras.bonuses.filter((bonus) => bonus.id !== id),
            })
          }
        />
      </section>
    </div>
  );
}
