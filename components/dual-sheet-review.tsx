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
import { findMonth, findSheet } from "@/lib/records";
import { formatMoney } from "@/lib/format";
import { summarizeSheet } from "@/lib/summaries";
import { clearIncomingPush, flushTrackerSave, retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import {
  compareExtras,
  compareSaleRows,
  extrasFromPayload,
  extrasFromSheet,
  itemBelongsToSheet,
  applyManagerSheetToState,
  leftoverEditedSales,
  leftoverEditedSheet,
  mergeVehicleTypes,
  payloadForEditedSale,
  resolutionsFromEditedSheet,
  stagedMonthFor,
  stagedSheetFor,
  stagedVehicleTypes,
  type ExtraPaySnapshot,
} from "@/lib/sheet-compare";
import { ACCEPT_APPLY_LABEL, EDIT_ADJUST_LABEL } from "@/lib/push-review";
import type { ExtraPay, Sale, VehicleTypeOption } from "@/lib/types";

export function usePendingSheetReview(monthId: string, sheetId: string) {
  const org = useOrg();
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const classified = useMemo(() => classifyReviewItems(mine), [mine]);
  const items = classified.items.filter((item) => itemBelongsToSheet(item, monthId, sheetId));
  const autoResolve = classified.autoResolve;
  const pushedMonth = useMemo(() => stagedMonthFor(mine, monthId), [mine, monthId]);
  const pushedSheet = useMemo(() => stagedSheetFor(mine, monthId, sheetId), [mine, monthId, sheetId]);
  const active = Boolean(org.profile?.role === "rep" && (items.length > 0 || Boolean(pushedSheet)));
  return { active, items, autoResolve, pushedSheet, pushedMonth, classified, mine };
}

function extrasKey(extras: ExtraPaySnapshot) {
  return [
    extras.vacationHours,
    extras.vacationRate,
    extras.vacationPay,
    extras.bonuses.map((bonus) => `${bonus.id}:${bonus.label}:${bonus.amount}`).join("|"),
  ].join("::");
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
  mode = "edit",
  onEditAdjust,
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
  mode?: "summary" | "edit";
  onEditAdjust?: () => void;
}) {
  const { items, autoResolve, pushedSheet, classified, mine } = usePendingSheetReview(monthId, sheetId);
  const { resolveReview, acceptPushedSheet } = useOrgActions();
  const [, setState] = useTrackerStore();
  const payTiers = usePayTiers();
  const router = useRouter();
  const draftState = useMemo(() => assembleLiveState(mine), [mine]);
  const draftSheet = useMemo(() => {
    const draftMonth = findMonth(draftState, monthId);
    return draftMonth ? findSheet(draftMonth, sheetId) ?? null : null;
  }, [draftState, monthId, sheetId]);
  const yourSales = draftSheet ? draftSheet.sales ?? [] : liveSales;
  const yourExtras = draftSheet ? extrasFromSheet(draftSheet) : liveExtras;
  const submitItems = useMemo(() => {
    const seen = new Set(items.map((item) => item.id));
    const vehicleItems = classified.items.filter((item) => item.manager?.kind === "vehicle_type" && !seen.has(item.id));
    return [...items, ...vehicleItems];
  }, [classified.items, items]);
  const initialSales = useMemo(() => {
    if (pushedSheet?.sales.length) return pushedSheet.sales;
    return items.map((item) => item.manager?.sale).filter((sale): sale is Sale => Boolean(sale));
  }, [items, pushedSheet]);
  const initialExtras = useMemo(() => {
    if (pushedSheet) return extrasFromSheet(pushedSheet);
    const sheetItem = items.find((item) => item.manager?.kind === "sheet");
    return sheetItem ? extrasFromPayload(sheetItem.manager) : extrasFromSheet(null);
  }, [items, pushedSheet]);
  const [editedSales, setEditedSales] = useState<Sale[]>(initialSales);
  const [editedExtras, setEditedExtras] = useState<ExtraPaySnapshot>(initialExtras);
  const [busy, setBusy] = useState<"confirm" | "accept" | null>(null);
  const [error, setError] = useState("");
  const pendingKey = [
    initialSales.map((sale) => `${sale.id}:${sale.stockNumber}:${sale.gross}:${sale.flat}`).join("|"),
    extrasKey(initialExtras),
  ].join("##");
  const reviewTypes = useMemo(
    () => mergeVehicleTypes(vehicleTypes, stagedVehicleTypes(mine)),
    [mine, vehicleTypes],
  );

  useEffect(() => {
    setEditedSales(initialSales);
    setEditedExtras(initialExtras);
  }, [pendingKey, initialSales, initialExtras]);

  const compared = useMemo(() => compareSaleRows(yourSales, editedSales), [yourSales, editedSales]);
  const extraHighlights = useMemo(() => compareExtras(yourExtras, editedExtras), [editedExtras, yourExtras]);
  const draftTotals = useMemo(
    () =>
      summarizeSheet(
        {
          id: sheetId,
          startDay: draftSheet?.startDay ?? 1,
          endDay: draftSheet?.endDay ?? 15,
          sales: yourSales,
          vacationHours: yourExtras.vacationHours,
          vacationRate: yourExtras.vacationRate,
          vacationPay: yourExtras.vacationPay,
          bonuses: yourExtras.bonuses,
        },
        payTiers,
      ),
    [draftSheet?.endDay, draftSheet?.startDay, payTiers, sheetId, yourExtras, yourSales],
  );
  const managerTotals = useMemo(
    () =>
      summarizeSheet(
        {
          id: sheetId,
          startDay: pushedSheet?.startDay ?? 1,
          endDay: pushedSheet?.endDay ?? 15,
          sales: editedSales,
          vacationHours: editedExtras.vacationHours,
          vacationRate: editedExtras.vacationRate,
          vacationPay: editedExtras.vacationPay,
          bonuses: editedExtras.bonuses,
        },
        payTiers,
      ),
    [editedExtras, editedSales, payTiers, pushedSheet?.endDay, pushedSheet?.startDay, sheetId],
  );

  function updateSale(id: string, patch: Partial<Sale>) {
    setEditedSales((current) => current.map((sale) => (sale.id === id ? { ...sale, ...patch } : sale)));
  }

  function removeSale(id: string) {
    const sale = editedSales.find((row) => row.id === id);
    if (sale && (sale.stockNumber.trim() || sale.customerName.trim()) && !window.confirm("Remove this row from the manager worksheet?")) {
      return;
    }
    setEditedSales((current) => current.filter((row) => row.id !== id));
  }

  function updateBonus(id: string, patch: Partial<ExtraPay>) {
    setEditedExtras((current) => ({
      ...current,
      bonuses: current.bonuses.map((bonus) => (bonus.id === id ? { ...bonus, ...patch } : bonus)),
    }));
  }

  async function handleConfirm() {
    setBusy("confirm");
    setError("");
    const sheetFallback = {
      monthId,
      sheetId,
      entityId: sheetId,
      year,
      month,
      startDay: pushedSheet?.startDay,
      endDay: pushedSheet?.endDay,
    };
    const decisions = resolutionsFromEditedSheet(submitItems, autoResolve, editedSales, editedExtras);
    const leftoverSales = leftoverEditedSales(submitItems, editedSales);
    const leftoverSheet = leftoverEditedSheet(submitItems, editedExtras, sheetFallback);
    const leftovers = [
      ...leftoverSales.map((sale) => payloadForEditedSale(null, sale, sheetFallback)),
      ...(leftoverSheet ? [leftoverSheet] : []),
    ];
    let message = await resolveReview(decisions);
    if (!message && leftovers.length > 0) {
      message = await insertPendingManagerPayloads(leftovers);
    }
    setBusy(null);
    if (message) {
      setError(message);
      return;
    }
    await invalidateOrgCache();
    retryCloudSync();
    router.refresh();
  }

  async function handleAcceptLock() {
    setBusy("accept");
    setError("");
    clearIncomingPush();
    if (pushedSheet) {
      setState((current) => applyManagerSheetToState(current, monthId, sheetId, pushedSheet, { year, month }));
    }
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
          <h2>{mode === "summary" ? "Logged draft vs manager buffer" : "Compare your sheet with the manager push"}</h2>
          <p className="empty-note">
            {mode === "summary"
              ? "Units, trades, front gross, and pay from your logged draft next to the manager’s pushed staging buffer."
              : "Your live worksheet stays on top. Type directly in the manager deals and Other pay section underneath to fix amounts, vacation, bonuses, or extra rows before you re-submit."}
          </p>
        </div>
        <div className="cloud-setup-actions">
          <Button disabled={Boolean(busy)} onClick={() => void handleAcceptLock()}>
            {busy === "accept" ? "Saving…" : ACCEPT_APPLY_LABEL}
          </Button>
          {mode === "summary" ? (
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={onEditAdjust}>
              {EDIT_ADJUST_LABEL}
            </Button>
          ) : (
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => void handleConfirm()}>
              {busy === "confirm" ? "Submitting…" : "Confirm Changes & Push Back to Manager"}
            </Button>
          )}
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}

      <table className="mini-sheet push-compare-totals no-print">
        <thead>
          <tr>
            <th scope="col"> </th>
            <th scope="col">Logged Rep Draft</th>
            <th scope="col">Manager Pushed Buffer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Units</th>
            <td>{draftTotals.units}</td>
            <td>{managerTotals.units}</td>
          </tr>
          <tr>
            <th scope="row">Trades</th>
            <td>{draftTotals.trades}</td>
            <td>{managerTotals.trades}</td>
          </tr>
          <tr>
            <th scope="row">Front Gross</th>
            <td>{formatMoney(draftTotals.gross)}</td>
            <td>{formatMoney(managerTotals.gross)}</td>
          </tr>
          <tr>
            <th scope="row">Pay</th>
            <td>{formatMoney(draftTotals.pay)}</td>
            <td>{formatMoney(managerTotals.pay)}</td>
          </tr>
        </tbody>
      </table>

      {mode === "edit" ? (
      <>
      <section className="dual-sheet-section">
        <h3>Your Current Worksheet</h3>
        <SalesSheet
          sales={yourSales}
          vehicleTypes={reviewTypes}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          readOnly
          compared={compared.live}
          emptyNote="You do not have live deals on this sheet yet."
        />
        <ExtraPayForm
          idPrefix="live"
          readOnly
          vacationHours={yourExtras.vacationHours}
          vacationRate={yourExtras.vacationRate}
          vacationPay={yourExtras.vacationPay}
          bonuses={yourExtras.bonuses}
          highlights={extraHighlights.live}
          onVacationChange={() => undefined}
          onAddBonus={() => undefined}
          onUpdateBonus={() => undefined}
          onRemoveBonus={() => undefined}
        />
      </section>

      <section className="dual-sheet-section">
        <div className="dual-sheet-heading">
          <h3>Manager / Admin Pushed Worksheet</h3>
          <Button className="no-print" variant="outline" size="sm" onClick={() => setEditedSales((current) => [...current, createSale()])}>
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        </div>
        <SalesSheet
          sales={editedSales}
          vehicleTypes={reviewTypes}
          onUpdate={updateSale}
          onRemove={removeSale}
          onAddRow={() => setEditedSales((current) => [...current, createSale()])}
          firstInputRef={firstInputRef}
          compared={compared.manager}
          emptyNote="No manager deals on this push. Add a row or confirm to send vacation and bonuses back."
        />
        <ExtraPayForm
          idPrefix="pushed"
          vacationHours={editedExtras.vacationHours}
          vacationRate={editedExtras.vacationRate}
          vacationPay={editedExtras.vacationPay}
          bonuses={editedExtras.bonuses}
          highlights={extraHighlights.pushed}
          onVacationChange={(hours, rate) =>
            setEditedExtras((current) => ({
              ...current,
              ...vacationFields(hours, rate, current.vacationPay),
            }))
          }
          onAddBonus={() =>
            setEditedExtras((current) => ({
              ...current,
              bonuses: [...current.bonuses, createBonus()],
            }))
          }
          onUpdateBonus={updateBonus}
          onRemoveBonus={(id) =>
            setEditedExtras((current) => ({
              ...current,
              bonuses: current.bonuses.filter((bonus) => bonus.id !== id),
            }))
          }
        />
      </section>
      </>
      ) : null}
    </div>
  );
}
