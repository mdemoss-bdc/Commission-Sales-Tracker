"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Plus, Printer } from "lucide-react";
import { SalesSheet } from "@/components/sales-sheet";
import { StatStrip } from "@/components/stat-strip";
import { TotalsPanel } from "@/components/totals-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createSale, getCommissionRate, saleHasData } from "@/lib/commission";
import { formatPercent } from "@/lib/format";
import { findMonth, findSheet, mapSheet, monthLabel } from "@/lib/records";
import { summarizeSheet } from "@/lib/summaries";
import { useTrackerStore } from "@/lib/tracker-store";
import type { PaySheet, Sale, SheetTab } from "@/lib/types";

type PayTrackerProps = {
  monthId: string;
  sheetId: string;
};

export function PayTracker({ monthId, sheetId }: PayTrackerProps) {
  const [state, setState] = useTrackerStore();
  const [tab, setTab] = useState<SheetTab>("deals");
  const firstInputRef = useRef<HTMLInputElement>(null);
  const focusNewRow = useRef(false);
  const month = findMonth(state, monthId);
  const sheet = month ? findSheet(month, sheetId) : undefined;

  useEffect(() => {
    if (!focusNewRow.current) return;
    firstInputRef.current?.focus();
    focusNewRow.current = false;
  }, [sheet?.sales]);

  if (!month || !sheet) {
    return (
      <div className="workbook">
        <section className="summary-card">
          <h2>Sheet not found</h2>
          <p className="empty-note">That sales sheet is not on this tracker.</p>
          <Button nativeButton={false} render={<Link href="/" />}>
            Back to all months
          </Button>
        </section>
      </div>
    );
  }

  const activeSheet = sheet;
  const totals = summarizeSheet(activeSheet);
  const rate = getCommissionRate(totals.units);
  const title = `${monthLabel(month.year, month.month)} · ${activeSheet.name}`;

  function updateSheet(updater: (current: PaySheet) => PaySheet) {
    setState((current) => mapSheet(current, monthId, sheetId, updater));
  }

  function addSale() {
    focusNewRow.current = true;
    updateSheet((current) => ({
      ...current,
      sales: [...(current.sales ?? []), createSale()],
    }));
  }

  function updateSale(id: string, patch: Partial<Sale>) {
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).map((sale) =>
        sale.id === id ? { ...sale, ...patch } : sale,
      ),
    }));
  }

  function removeSale(id: string) {
    const sale = (activeSheet.sales ?? []).find((row) => row.id === id);
    if (sale && saleHasData(sale) && !window.confirm("Remove this sale from the tracker?")) {
      return;
    }
    updateSheet((current) => ({
      ...current,
      sales: (current.sales ?? []).filter((row) => row.id !== id),
    }));
  }

  function clearSheet() {
    if ((activeSheet.sales ?? []).length === 0) return;
    if (!window.confirm("Clear every sale on this sheet?")) return;
    updateSheet((current) => ({ ...current, sales: [] }));
  }

  function printSheet() {
    setTab("deals");
    window.setTimeout(() => window.print(), 50);
  }

  return (
    <div className="workbook">
      <header className="workbook-bar">
        <div>
          <p className="workbook-kicker">Sales sheet</p>
          <h1>{title}</h1>
          <p className="header-sub print-heading">
            Pack {formatPercent(rate)} on this sheet · {totals.trades} trade-ins
          </p>
        </div>
        <StatStrip
          totals={totals}
          extra={[{ label: "Pack", value: formatPercent(rate) }]}
        />
      </header>

      <div className="toolbar no-print">
        <div className="toolbar-left">
          <Button nativeButton={false} variant="outline" render={<Link href={`/m/${monthId}`} />}>
            <ArrowLeft data-icon="inline-start" />
            {monthLabel(month.year, month.month)}
          </Button>
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
        </div>
        <div className="toolbar-actions">
          <Button onClick={addSale}>
            <Plus data-icon="inline-start" />
            Add New Sale
          </Button>
          <Button variant="outline" onClick={printSheet}>
            <Printer data-icon="inline-start" />
            Print sheet
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
          <p className="sheet-hint no-print">
            {tab === "deals"
              ? "Log stock number, vehicle, trade-in, front-end gross, and any flat. Commission uses this sheet pack percent plus flats and backend products."
              : "Enter financing, service, Drive 360, CarCare, and GAP earned on each deal. Totals roll into pay on the Deals sheet."}
          </p>
          <SalesSheet
            sales={activeSheet.sales ?? []}
            tab={tab}
            onUpdate={updateSale}
            onRemove={removeSale}
            firstInputRef={firstInputRef}
          />
        </div>
        <TotalsPanel sales={activeSheet.sales ?? []} trades={totals.trades} />
      </div>
    </div>
  );
}
