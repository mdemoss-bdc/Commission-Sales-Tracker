import { diffPayloads, isPayload, payloadLabel, type DealPayload, type DealRow, type FieldDiff } from "./deal-records.ts";
import type { RecordStatus } from "./roles.ts";
import type { Sale } from "./types.ts";

export type ReviewKind = "addition" | "conflict";
export type ReviewChoice = "accept" | "decline" | "keep_mine" | "use_manager";

export type ReviewItem = {
  id: string;
  liveId?: string;
  kind: ReviewKind;
  title: string;
  manager: DealPayload | null;
  mine: DealPayload | null;
  diffs: FieldDiff[];
};

export type ReviewResolution = {
  id: string;
  action: ReviewChoice;
  live_id?: string;
  live_data?: DealPayload | Record<string, never> | null;
  previous_data?: DealPayload | Record<string, never> | null;
  discard_staged?: boolean;
};

export function isAwaitingRepReview(status: RecordStatus | string | null | undefined): boolean {
  return status === "pending_rep_review" || status === "staged";
}

export function isLiveStatus(status: RecordStatus | string | null | undefined): boolean {
  return status === "active" || status === "approved";
}

function stockKey(payload: DealPayload | null | undefined): string | null {
  const stock = payload?.sale?.stockNumber?.trim().toLowerCase() ?? "";
  if (!stock) return null;
  return `${payload?.sheetId ?? ""}::${stock}`;
}

function saleFields(sale: Sale | undefined) {
  if (!sale) return null;
  return {
    stockNumber: sale.stockNumber.trim(),
    customerName: sale.customerName.trim(),
    vehicleType: sale.vehicleType,
    dealType: sale.dealType,
    tradeIn: Boolean(sale.tradeIn),
    gross: sale.gross || 0,
    flat: sale.flat || 0,
    fi: sale.fi || 0,
    service: sale.service || 0,
  };
}

export function payloadsMatch(left: DealPayload | null | undefined, right: DealPayload | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "sale") {
    return JSON.stringify(saleFields(left.sale)) === JSON.stringify(saleFields(right.sale));
  }
  return diffPayloads(left, right).length === 0;
}

export function applyManagerValues(mine: DealPayload, manager: DealPayload): DealPayload {
  if (mine.kind === "sale" && manager.kind === "sale" && mine.sale && manager.sale) {
    return {
      ...mine,
      sale: {
        ...mine.sale,
        stockNumber: manager.sale.stockNumber,
        customerName: manager.sale.customerName,
        vehicleType: manager.sale.vehicleType,
        dealType: manager.sale.dealType,
        tradeIn: manager.sale.tradeIn,
        gross: manager.sale.gross,
        flat: manager.sale.flat,
        fi: manager.sale.fi,
        service: manager.sale.service,
      },
    };
  }
  if (mine.kind === "sheet" && manager.kind === "sheet") {
    return {
      ...mine,
      startDay: manager.startDay ?? mine.startDay,
      endDay: manager.endDay ?? mine.endDay,
      vacationHours: manager.vacationHours ?? manager.vacation_hours ?? mine.vacationHours,
      vacationRate: manager.vacationRate ?? manager.vacation_rate ?? mine.vacationRate,
      vacationPay: manager.vacationPay ?? manager.vacation_pay ?? mine.vacationPay,
      bonuses: manager.bonuses ?? mine.bonuses,
    };
  }
  return {
    ...manager,
    entityId: mine.entityId,
    monthId: mine.monthId ?? manager.monthId,
    sheetId: mine.sheetId ?? manager.sheetId,
  };
}

export function classifyReviewItems(rows: DealRow[]): { items: ReviewItem[]; autoResolve: ReviewResolution[] } {
  const pending = rows.filter((row) => isAwaitingRepReview(row.status));
  const liveRows = rows.filter((row) => isLiveStatus(row.status) && isPayload(row.live_data));
  const liveByStock = new Map<string, DealRow>();
  const liveByKey = new Map<string, DealRow>();
  for (const row of liveRows) {
    const payload = row.live_data as DealPayload;
    liveByKey.set(`${payload.kind}:${payload.entityId}`, row);
    const key = stockKey(payload);
    if (key && !liveByStock.has(key)) liveByStock.set(key, row);
  }

  const items: ReviewItem[] = [];
  const autoResolve: ReviewResolution[] = [];

  for (const row of pending) {
    const manager = isPayload(row.staged_data) ? row.staged_data : isPayload(row.proposed_data) ? row.proposed_data : null;
    const mineOnRow = isPayload(row.live_data) ? row.live_data : null;
    if (!manager) {
      autoResolve.push({ id: row.id, action: "decline", discard_staged: true });
      continue;
    }

    if (mineOnRow) {
      if (payloadsMatch(mineOnRow, manager)) {
        autoResolve.push({ id: row.id, action: "decline", discard_staged: true });
        continue;
      }
      items.push({
        id: row.id,
        kind: "conflict",
        title: payloadLabel(manager),
        manager,
        mine: mineOnRow,
        diffs: diffPayloads(mineOnRow, manager),
      });
      continue;
    }

    const stock = stockKey(manager);
    const liveMatch = stock ? liveByStock.get(stock) : liveByKey.get(`${manager.kind}:${manager.entityId}`);
    const livePayload = liveMatch && isPayload(liveMatch.live_data) ? liveMatch.live_data : null;

    if (liveMatch && livePayload) {
      if (payloadsMatch(livePayload, manager)) {
        autoResolve.push({ id: row.id, action: "decline", live_id: liveMatch.id, discard_staged: true });
        continue;
      }
      items.push({
        id: row.id,
        liveId: liveMatch.id,
        kind: "conflict",
        title: payloadLabel(manager),
        manager,
        mine: livePayload,
        diffs: diffPayloads(livePayload, manager),
      });
      continue;
    }

    items.push({
      id: row.id,
      kind: "addition",
      title: payloadLabel(manager),
      manager,
      mine: null,
      diffs: [],
    });
  }

  return { items, autoResolve };
}

export function resolutionForChoice(item: ReviewItem, choice: ReviewChoice): ReviewResolution {
  if (item.kind === "addition") {
    if (choice === "accept" || choice === "use_manager") {
      return { id: item.id, action: "accept", live_data: item.manager ?? {}, previous_data: {} };
    }
    return { id: item.id, action: "decline", discard_staged: true };
  }
  if (choice === "use_manager" && item.manager) {
    const liveData = item.mine ? applyManagerValues(item.mine, item.manager) : item.manager;
    return {
      id: item.id,
      action: "use_manager",
      live_id: item.liveId,
      live_data: liveData,
      previous_data: item.manager,
      discard_staged: Boolean(item.liveId && item.liveId !== item.id),
    };
  }
  return {
    id: item.id,
    action: "keep_mine",
    live_id: item.liveId,
    live_data: item.mine ?? {},
    previous_data: item.manager ?? {},
    discard_staged: Boolean(item.liveId && item.liveId !== item.id),
  };
}
