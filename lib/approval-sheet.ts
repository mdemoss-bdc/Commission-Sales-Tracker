import { countUnits, getCommissionRate, saleCommission, vacationPayAmount } from "./commission.ts";
import { isPayload, previousPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { formatMoney } from "./format.ts";
import { vehicleLabel } from "./vehicles.ts";
import { isLiveRecordStatus } from "./roles.ts";
import { sheetRangeLabel } from "./sheet-range.ts";
import { MONTH_NAMES, type ExtraPay, type Sale } from "./types.ts";
import { lastSubmittedAt, latestPeriodRows, rowUpdatedAt } from "./latest-submission.ts";

export type CellDiffKind = "unchanged" | "changed" | "added";

export type DiffCell = {
  key: string;
  label: string;
  value: string;
  previous: string | null;
  kind: CellDiffKind;
  tooltip: string | null;
};

export type ApprovalSaleRow = {
  id: string;
  recordId?: string;
  pending: boolean;
  sale: Sale;
  cells: DiffCell[];
  commission: number;
};

export type ApprovalSheetGroup = {
  key: string;
  repId: string;
  sheetId: string;
  monthId?: string;
  year?: number;
  month?: number;
  startDay?: number;
  endDay?: number;
  title: string;
  lastSubmittedAt?: string;
  recordIds: string[];
  changedCount: number;
  sales: ApprovalSaleRow[];
  extras: DiffCell[];
};

const SALE_FIELDS = [
  { key: "stockNumber", label: "Stock #", display: (sale: Sale) => sale.stockNumber.trim() || "—" },
  { key: "customerName", label: "Customer", display: (sale: Sale) => sale.customerName.trim() || "—" },
  { key: "vehicle", label: "Deal Type", display: (sale: Sale) => vehicleLabel([], sale.vehicleType).trim() || "—" },
  { key: "tradeIn", label: "Trade", display: (sale: Sale) => (sale.tradeIn ? "Yes" : "No") },
  { key: "gross", label: "Gross", display: (sale: Sale) => formatMoney(sale.gross) },
  { key: "flat", label: "Flat", display: (sale: Sale) => formatMoney(sale.flat) },
  { key: "fi", label: "F&I", display: (sale: Sale) => formatMoney(sale.fi) },
  { key: "service", label: "Service", display: (sale: Sale) => formatMoney(sale.service) },
] as const;

function blankDisplay(value: string): boolean {
  return !value || value === "—";
}

export function diffCell(label: string, key: string, current: string, previous: string | null, pending: boolean): DiffCell {
  if (!pending) {
    return { key, label, value: current, previous: null, kind: "unchanged", tooltip: null };
  }
  if (previous == null) {
    if (blankDisplay(current)) {
      return { key, label, value: current, previous: null, kind: "unchanged", tooltip: null };
    }
    return { key, label, value: current, previous: null, kind: "added", tooltip: "Added by Rep" };
  }
  if (previous === current) {
    return { key, label, value: current, previous, kind: "unchanged", tooltip: null };
  }
  if (blankDisplay(previous) && !blankDisplay(current)) {
    return { key, label, value: current, previous, kind: "added", tooltip: "Added by Rep" };
  }
  return { key, label, value: current, previous, kind: "changed", tooltip: `Changed from: ${previous}` };
}

function payloadSheetId(payload: DealPayload | null | undefined): string {
  return payload?.sheetId || (payload?.kind === "sheet" ? payload.entityId : "") || "";
}

function workingPayload(row: DealRow): DealPayload | null {
  if (isPayload(row.staged_data)) return row.staged_data;
  return previousPayload(row);
}

function stockMatchKey(payload: DealPayload): string | null {
  const stock = payload.sale?.stockNumber?.trim().toLowerCase() ?? "";
  if (stock) return `stock:${payload.sheetId ?? ""}::${stock}`;
  if (payload.kind === "sale") return `id:${payload.entityId}`;
  return null;
}

function bonusesDisplay(bonuses: ExtraPay[] | undefined): string {
  if (!bonuses?.length) return "—";
  return bonuses.map((bonus) => `${bonus.label || "Bonus"} ${formatMoney(bonus.amount)}`).join(", ");
}

function extrasFromPayload(payload: DealPayload | null): {
  hours: number;
  rate: number;
  pay: number;
  bonuses: ExtraPay[];
} {
  if (!payload || payload.kind !== "sheet") {
    return { hours: 0, rate: 0, pay: 0, bonuses: [] };
  }
  const hours = Number(payload.vacationHours ?? payload.vacation_hours ?? 0) || 0;
  const rate = Number(payload.vacationRate ?? payload.vacation_rate ?? 0) || 0;
  const fallback = Number(payload.vacationPay ?? payload.vacation_pay ?? 0) || 0;
  return {
    hours,
    rate,
    pay: vacationPayAmount(hours, rate, fallback),
    bonuses: payload.bonuses ?? [],
  };
}

function saleCells(current: Sale, previous: Sale | null, pending: boolean): DiffCell[] {
  return SALE_FIELDS.map((field) =>
    diffCell(field.label, field.key, field.display(current), previous ? field.display(previous) : null, pending),
  );
}

function extrasCells(current: DealPayload | null, previous: DealPayload | null, pending: boolean): DiffCell[] {
  const now = extrasFromPayload(current);
  const prior = previous ? extrasFromPayload(previous) : null;
  return [
    diffCell("Vacation hours", "vacationHours", now.hours ? String(now.hours) : "—", prior ? (prior.hours ? String(prior.hours) : "—") : null, pending),
    diffCell("Hourly rate", "vacationRate", now.rate ? formatMoney(now.rate) : "—", prior ? (prior.rate ? formatMoney(prior.rate) : "—") : null, pending),
    diffCell(
      "Vacation pay",
      "vacationPay",
      now.pay ? formatMoney(now.pay) : "—",
      prior ? (prior.pay ? formatMoney(prior.pay) : "—") : null,
      pending,
    ),
    diffCell("Bonuses", "bonuses", bonusesDisplay(now.bonuses), prior ? bonusesDisplay(prior.bonuses) : null, pending),
  ];
}

function sheetTitle(payload: DealPayload | null | undefined): string {
  const year = payload?.year;
  const month = payload?.month;
  const monthName = month ? MONTH_NAMES[month - 1] : "Sheet";
  const range =
    payload?.startDay && payload?.endDay && year && month
      ? ` · ${sheetRangeLabel(payload.startDay, payload.endDay, year, month)}`
      : "";
  if (!year) return "Pay sheet";
  return `${monthName} ${year}${range}`;
}

export function groupApprovalSheets(pendingRows: DealRow[], allRows: DealRow[]): ApprovalSheetGroup[] {
  const groups = new Map<string, DealRow[]>();
  for (const row of latestPeriodRows(pendingRows)) {
    const list = groups.get(row.rep_id) ?? [];
    list.push(row);
    groups.set(row.rep_id, list);
  }

  const result: ApprovalSheetGroup[] = [];
  for (const [, rows] of groups) {
    const ordered = [...rows].sort((left, right) => rowUpdatedAt(right) - rowUpdatedAt(left));
    const meta = workingPayload(ordered[0]!) ?? previousPayload(ordered[0]!);
    const sheetId = payloadSheetId(meta);
    const pendingIds = new Set(rows.map((row) => row.id));

    const pendingSales = new Map<string, { payload: DealPayload; previous: DealPayload | null; recordId: string }>();
    let pendingSheet: { payload: DealPayload; previous: DealPayload | null; recordId: string } | null = null;

    for (const row of rows) {
      const staged = isPayload(row.staged_data) ? row.staged_data : null;
      const prior = previousPayload(row);
      if (!staged) continue;
      if (staged.kind === "sheet") {
        pendingSheet = { payload: staged, previous: prior, recordId: row.id };
        continue;
      }
      if (staged.kind === "sale" && staged.sale) {
        pendingSales.set(stockMatchKey(staged) ?? staged.entityId, { payload: staged, previous: prior, recordId: row.id });
      }
    }

    const liveSales: DealPayload[] = [];
    let liveSheet: DealPayload | null = null;
    for (const row of allRows) {
      if (row.rep_id !== rows[0]!.rep_id) continue;
      if (pendingIds.has(row.id)) continue;
      if (!isPayload(row.live_data)) continue;
      if (!isLiveRecordStatus(row.status) && row.status !== "pending_manager_approval" && row.status !== "pending_admin_approval") {
        continue;
      }
      const live = row.live_data;
      if (payloadSheetId(live) !== sheetId) continue;
      if (live.kind === "sheet") liveSheet = live;
      if (live.kind === "sale" && live.sale) liveSales.push(live);
    }

    const sales: ApprovalSaleRow[] = [];
    const usedLive = new Set<string>();
    for (const [matchKey, pending] of pendingSales) {
      const sale = pending.payload.sale;
      if (!sale) continue;
      const previousSale = pending.previous?.sale ?? null;
      sales.push({
        id: sale.id,
        recordId: pending.recordId,
        pending: true,
        sale,
        cells: saleCells(sale, previousSale, true),
        commission: 0,
      });
      usedLive.add(matchKey);
    }
    for (const live of liveSales) {
      const matchKey = stockMatchKey(live) ?? live.entityId;
      if (usedLive.has(matchKey) || pendingSales.has(matchKey)) continue;
      if (!live.sale) continue;
      sales.push({
        id: live.sale.id,
        pending: false,
        sale: live.sale,
        cells: saleCells(live.sale, null, false),
        commission: 0,
      });
    }

    const units = countUnits(sales.map((row) => row.sale));
    const rate = getCommissionRate(units);
    for (const row of sales) {
      row.commission = saleCommission(row.sale, rate);
    }

    const extrasPending = Boolean(pendingSheet);
    const extras = extrasCells(pendingSheet?.payload ?? liveSheet, pendingSheet?.previous ?? null, extrasPending).filter(
      (cell) => extrasPending || !blankDisplay(cell.value),
    );

    const changedCount =
      sales.reduce((sum, row) => sum + row.cells.filter((cell) => cell.kind !== "unchanged").length, 0) +
      extras.filter((cell) => cell.kind !== "unchanged").length;

    result.push({
      key: rows[0]!.rep_id,
      repId: rows[0]!.rep_id,
      sheetId,
      monthId: meta?.monthId,
      year: meta?.year,
      month: meta?.month,
      startDay: meta?.startDay,
      endDay: meta?.endDay,
      title: sheetTitle(meta),
      lastSubmittedAt: lastSubmittedAt(rows),
      recordIds: rows.map((row) => row.id),
      changedCount,
      sales,
      extras,
    });
  }

  return result.sort((left, right) => left.title.localeCompare(right.title) || left.repId.localeCompare(right.repId));
}
