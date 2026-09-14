import { isPayload, payloadKey, workingPayload, type DealPayload, type DealRow } from "./deal-records.ts";
import { isPipelineRecordStatus } from "./roles.ts";

export function rowUpdatedAt(row: { updated_at?: string; created_at?: string }): number {
  const stamp = row.updated_at || row.created_at || "";
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : 0;
}

export function payPeriodKey(payload: DealPayload | null | undefined): string {
  if (!payload) return "unknown";
  const month = payload.monthId || `${payload.year ?? ""}-${payload.month ?? ""}`;
  const sheet = payload.sheetId || (payload.kind === "sheet" ? payload.entityId : "") || "sheet";
  return `${month}::${sheet}`;
}

export function submissionMatchKey(payload: DealPayload | null | undefined): string | null {
  if (!payload) return null;
  const period = payPeriodKey(payload);
  const stock = payload.sale?.stockNumber?.trim().toLowerCase() ?? "";
  if (payload.kind === "sale" && stock) return `${period}::sale::${stock}`;
  return `${period}::${payloadKey(payload)}`;
}

export function rowSubmissionMatchKey(row: DealRow): string | null {
  const payload =
    (isPayload(row.staged_data) && row.staged_data) ||
    (isPayload(row.proposed_data) && row.proposed_data) ||
    (isPayload(row.live_data) && row.live_data) ||
    null;
  return submissionMatchKey(payload);
}

export function latestByMatchKey<T extends DealRow>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.rep_id}::${rowSubmissionMatchKey(row) ?? row.id}`;
    const current = latest.get(key);
    if (!current || rowUpdatedAt(row) >= rowUpdatedAt(current)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function latestPeriodRows<T extends DealRow>(rows: T[]): T[] {
  const collapsed = latestByMatchKey(rows);
  const byRep = new Map<string, T[]>();
  for (const row of collapsed) {
    const list = byRep.get(row.rep_id) ?? [];
    list.push(row);
    byRep.set(row.rep_id, list);
  }
  const picked: T[] = [];
  for (const group of byRep.values()) {
    const newest = group.reduce((best, row) => (rowUpdatedAt(row) >= rowUpdatedAt(best) ? row : best));
    const period = payPeriodKey(workingPayload(newest));
    picked.push(...group.filter((row) => payPeriodKey(workingPayload(row)) === period));
  }
  return picked;
}

export function latestRowByRep<T extends { rep_id: string; updated_at?: string; created_at?: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.rep_id);
    if (!current || rowUpdatedAt(row) >= rowUpdatedAt(current)) latest.set(row.rep_id, row);
  }
  return [...latest.values()];
}

export function lastSubmittedAt(rows: Array<{ updated_at?: string; created_at?: string }>): string | undefined {
  let best: { updated_at?: string; created_at?: string } | undefined;
  for (const row of rows) {
    if (!best || rowUpdatedAt(row) >= rowUpdatedAt(best)) best = row;
  }
  return best?.updated_at || best?.created_at;
}

export function lastSubmittedLabel(iso: string | undefined): string {
  if (!iso) return "Last submitted: just now (Latest Version)";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Last submitted: just now (Latest Version)";
  const formatted = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `Last submitted: ${formatted} (Latest Version)`;
}

export function supersededPipelineIds(rows: DealRow[], keepIds: string[]): string[] {
  const keep = new Set(keepIds);
  const keepRows = rows.filter((row) => keep.has(row.id));
  const periods = new Set(keepRows.map((row) => payPeriodKey(workingPayload(row))));
  if (periods.size === 0) return [];
  return rows
    .filter((row) => {
      if (!isPipelineRecordStatus(row.status)) return false;
      if (keep.has(row.id)) return false;
      return periods.has(payPeriodKey(workingPayload(row)));
    })
    .map((row) => row.id);
}

export function lastSubmittedForRep(
  rows: Array<{ rep_id: string; status?: string; updated_at?: string; created_at?: string }>,
  repId: string,
): string | undefined {
  return lastSubmittedAt(
    rows.filter((row) => row.rep_id === repId && row.status !== "rejected" && row.status !== "draft"),
  );
}
