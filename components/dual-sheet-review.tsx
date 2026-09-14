"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { SalesSheet } from "@/components/sales-sheet";
import { Button } from "@/components/ui/button";
import { createSale } from "@/lib/commission";
import { classifyReviewItems } from "@/lib/rep-review";
import { invalidateOrgCache, useOrg, useOrgActions } from "@/lib/org-store";
import { insertPendingManagerPayloads } from "@/lib/org";
import { retryCloudSync } from "@/lib/tracker-store";
import {
  compareSaleRows,
  itemBelongsToSheet,
  leftoverEditedSales,
  payloadForEditedSale,
  resolutionsFromEditedSheet,
  stagedMonthFor,
  stagedSheetFor,
} from "@/lib/sheet-compare";
import type { Sale, VehicleTypeOption } from "@/lib/types";

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
  const active = Boolean(org.profile?.role === "rep" && (items.length > 0 || (pushedSheet && pushedSheet.sales.length > 0)));
  return { active, items, autoResolve, pushedSheet, pushedMonth, classified, mine };
}

export function DualSheetReview({
  monthId,
  sheetId,
  year,
  month,
  liveSales,
  vehicleTypes,
  firstInputRef,
}: {
  monthId: string;
  sheetId: string;
  year: number;
  month: number;
  liveSales: Sale[];
  vehicleTypes: VehicleTypeOption[];
  firstInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { items, autoResolve, pushedSheet } = usePendingSheetReview(monthId, sheetId);
  const { resolveReview } = useOrgActions();
  const router = useRouter();
  const initialSales = useMemo(() => {
    if (pushedSheet?.sales.length) return pushedSheet.sales;
    return items.map((item) => item.manager?.sale).filter((sale): sale is Sale => Boolean(sale));
  }, [items, pushedSheet]);
  const [editedSales, setEditedSales] = useState<Sale[]>(initialSales);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pendingKey = initialSales.map((sale) => `${sale.id}:${sale.stockNumber}:${sale.gross}:${sale.flat}`).join("|");

  useEffect(() => {
    setEditedSales(initialSales);
  }, [pendingKey, initialSales]);

  const compared = useMemo(() => compareSaleRows(liveSales, editedSales), [liveSales, editedSales]);

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

  async function handleConfirm() {
    setBusy(true);
    setError("");
    const decisions = resolutionsFromEditedSheet(items, autoResolve, editedSales);
    const leftover = leftoverEditedSales(items, editedSales);
    let message = await resolveReview(decisions);
    if (!message && leftover.length > 0) {
      message = await insertPendingManagerPayloads(
        leftover.map((sale) =>
          payloadForEditedSale(null, sale, {
            monthId,
            sheetId,
            year,
            month,
            startDay: pushedSheet?.startDay,
            endDay: pushedSheet?.endDay,
          }),
        ),
      );
    }
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    await invalidateOrgCache();
    retryCloudSync();
    router.refresh();
  }

  return (
    <div className="dual-sheet-review">
      <div className="dual-sheet-bar no-print">
        <div>
          <p className="workbook-kicker">Employee review</p>
          <h2>Compare your sheet with the manager push</h2>
          <p className="empty-note">
            Your live worksheet stays on top. Type directly in the manager table underneath to fix amounts, trades, or
            extra rows. Confirm sends that edited table back as pending manager approval.
          </p>
        </div>
        <Button disabled={busy} onClick={() => void handleConfirm()}>
          {busy ? "Submitting…" : "Confirm Changes & Push Back to Manager"}
        </Button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}

      <section className="dual-sheet-section">
        <h3>Your Current Worksheet</h3>
        <SalesSheet
          sales={liveSales}
          vehicleTypes={vehicleTypes}
          onUpdate={() => undefined}
          onRemove={() => undefined}
          readOnly
          hideDealType
          compared={compared.live}
          emptyNote="You do not have live deals on this sheet yet."
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
          vehicleTypes={vehicleTypes}
          onUpdate={updateSale}
          onRemove={removeSale}
          firstInputRef={firstInputRef}
          hideDealType
          compared={compared.manager}
          emptyNote="No manager deals on this push. Add a row or confirm to clear the review."
        />
      </section>
    </div>
  );
}
