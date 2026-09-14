"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { SalesSheet } from "@/components/sales-sheet";
import { TotalsPanel } from "@/components/totals-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  countUnits,
  createSale,
  getCommissionRate,
  saleCommission,
} from "@/lib/commission";
import { formatMoney, formatPercent } from "@/lib/format";
import { useTrackerStore } from "@/lib/tracker-store";
import type { Sale, SheetTab, TrackerState } from "@/lib/types";

export function PayTracker() {
  const [state, setState] = useTrackerStore();
  const [tab, setTab] = useState<SheetTab>("deals");
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);

  useEffect(() => {
    if (!focusNewRow.current) return;
    firstInputRef.current?.focus();
    focusNewRow.current = false;
  }, [state.sales]);

  const units = countUnits(state.sales);
  const rate = getCommissionRate(units);
  const totalPay = state.sales.reduce(
    (sum, sale) => sum + saleCommission(sale, rate),
    0,
  );

  function updateState(
    patch: Partial<TrackerState> | ((current: TrackerState) => TrackerState),
  ) {
    setState(patch);
  }

  function addSale() {
    focusNewRow.current = true;
    updateState((current) => ({
      ...current,
      sales: [...current.sales, createSale()],
    }));
  }

  function updateSale(id: string, patch: Partial<Sale>) {
    updateState((current) => ({
      ...current,
      sales: current.sales.map((sale) =>
        sale.id === id ? { ...sale, ...patch } : sale,
      ),
    }));
  }

  function removeSale(id: string) {
    const sale = state.sales.find((row) => row.id === id);
    const hasData =
      sale &&
      (sale.stockNumber.trim() ||
        sale.customerName.trim() ||
        sale.gross ||
        sale.flat ||
        sale.fi ||
        sale.service ||
        sale.drive360 ||
        sale.carCare ||
        sale.gap);
    if (hasData && !window.confirm("Remove this sale from the tracker?")) return;
    updateState((current) => ({
      ...current,
      sales: current.sales.filter((row) => row.id !== id),
    }));
  }

  function clearSheet() {
    if (state.sales.length === 0) return;
    if (!window.confirm("Clear every sale on this sheet?")) return;
    updateState({ sales: [] });
  }

  return (
    <div className="workbook">
      <header className="workbook-bar">
        <div>
          <p className="workbook-kicker">Sales commission</p>
          <div className="title-row">
            <h1>Pay Tracker</h1>
            <input
              aria-label="Pay period"
              value={state.periodLabel}
              onChange={(event) => updateState({ periodLabel: event.target.value })}
              className="period-input"
            />
          </div>
        </div>
        <div className="header-stats">
          <div>
            <span>Units</span>
            <strong>{units}</strong>
          </div>
          <div>
            <span>Pack</span>
            <strong>{formatPercent(rate)}</strong>
          </div>
          <div>
            <span>Total pay</span>
            <strong>{formatMoney(totalPay)}</strong>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="tab-row" role="tablist" aria-label="Sheet views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "deals"}
            className={tab === "deals" ? "sheet-tab active" : "sheet-tab"}
            onClick={() => setTab("deals")}
          >
            Deals
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "backend"}
            className={tab === "backend" ? "sheet-tab active" : "sheet-tab"}
            onClick={() => setTab("backend")}
          >
            F&amp;I &amp; Service
          </button>
        </div>
        <div className="toolbar-actions">
          <Button onClick={addSale}>
            <Plus data-icon="inline-start" />
            Add New Sale
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" aria-label="More sheet actions" />}
            >
              Sheet
              <ChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={clearSheet}>
                Clear all sales
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="workspace">
        <div className="sheet-column">
          <p className="sheet-hint">
            {tab === "deals"
              ? "Log stock number, vehicle type, front-end gross, and any flat. Commission uses your current pack percent plus flats and backend products."
              : "Enter financing, service, Drive 360, CarCare, and GAP earned on each deal. Totals roll into pay on the Deals sheet."}
          </p>
          <SalesSheet
            sales={state.sales}
            tab={tab}
            onUpdate={updateSale}
            onRemove={removeSale}
            firstInputRef={firstInputRef}
          />
        </div>
        <TotalsPanel sales={state.sales} />
      </div>
    </div>
  );
}
