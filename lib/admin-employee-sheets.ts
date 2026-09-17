import { getCachedProfile, isMissingColumn, isMissingFunction, isMissingRelation, isMissingTable, listProfiles, missingColumnName } from "./org.ts";
import {
  buildPayTrackerDocument,
  collectWorksheetDeals,
  compileManagerApprovalSnapshot,
  extractDealsFromSheetData,
  serializeManagerApprovalPayload,
  trackerHasSales,
  trackerStateFromPayTrackerDocument,
  worksheetContentScore,
} from "./pay-tracker-state.ts";
import { assembleWorkingState, isActiveWorksheetDealRow, type DealRow } from "./deal-records.ts";
import {
  periodFromUnknown,
  strictMatchesPeriodKey,
  type PayPeriodIdentity,
} from "./pay-period.ts";
import { canManageOrg, type UserRole } from "./roles.ts";
import { parseTrackerState } from "./storage.ts";
import { getSupabase } from "./supabase.ts";
import {
  ADMIN_EMPLOYEE_SHEET_SELECT,
  ADMIN_EMPLOYEE_SHEET_SELECT_MIN,
  ADMIN_EMPLOYEE_SHEETS_TABLE,
  DEAL_RECORDS_TABLE,
  PAY_TRACKER_STATE_TABLE,
} from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

type OverlayView = "live" | "overlay" | "staged";

export const ADMIN_SHEET_DRAFT = "draft";
export const ADMIN_SHEET_PUSHED = "pushed";
export const ADMIN_SHEET_APPROVED_FINAL = "approved_final";
export const ADMIN_SHEET_FINAL_APPROVED = "admin_final_approved";
export const ADMIN_SHEET_PAID = "paid";
export const ADMIN_LEDGER_UNAVAILABLE = "missing-admin-employee-sheets";

export type AdminSheetStatus =
  | typeof ADMIN_SHEET_DRAFT
  | typeof ADMIN_SHEET_PUSHED
  | typeof ADMIN_SHEET_APPROVED_FINAL
  | typeof ADMIN_SHEET_FINAL_APPROVED
  | typeof ADMIN_SHEET_PAID;

export type AdminEmployeeSheet = {
  employeeId: string;
  orgId: string | null;
  locationId: string | null;
  monthId: string | null;
  periodKey: string | null;
  sheetData: unknown;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  paidAt: string | null;
  isPaid: boolean;
  state: TrackerState | null;
};

export type AdminSheetLoad =
  | { status: "ready"; row: AdminEmployeeSheet | null }
  | { status: "missing" }
  | { status: "error"; message: string };

export function adminMasterSheetTitle(employeeName: string): string {
  const cleaned = employeeName.trim() || "Employee";
  return `Admin Master Sheet: ${cleaned}`;
}

export function nextAdminSheetStatusOnEdit(current: string | null | undefined): AdminSheetStatus {
  if (isPaidAdminSheet(current)) return ADMIN_SHEET_PAID;
  if (current === ADMIN_SHEET_PUSHED) return ADMIN_SHEET_PUSHED;
  return ADMIN_SHEET_DRAFT;
}

export function isPaidAdminSheet(status: string | null | undefined, isPaidFlag?: boolean | null): boolean {
  if (isPaidFlag === true) return true;
  const key = (status ?? "").trim().toUpperCase();
  return key === "PAID" || key === "DISBURSED";
}

export function isApprovedFinalAdminSheet(status: string | null | undefined): boolean {
  const key = (status ?? "").trim().toLowerCase();
  return (
    key === ADMIN_SHEET_FINAL_APPROVED ||
    key === ADMIN_SHEET_APPROVED_FINAL ||
    key === "manager_approved"
  );
}

export function isAuthorizedAdminSheet(status: string | null | undefined, isPaidFlag?: boolean | null): boolean {
  return isApprovedFinalAdminSheet(status) || isPaidAdminSheet(status, isPaidFlag);
}

export function shouldPersistOverlayToAdminLedger(input: {
  view: OverlayView;
  actorRole?: UserRole | null;
  targetRepId?: string | null;
}): boolean {
  return input.view === "overlay" && Boolean(resolveAdminLedgerEmployeeId({ targetRepId: input.targetRepId })) && canManageOrg(input.actorRole);
}

/** Prefer explicit admin target, then URL/query/session context, never empty string. */
export function resolveAdminLedgerEmployeeId(input: {
  targetRepId?: string | null;
  urlRepId?: string | null;
  stateEmployeeId?: string | null;
}): string | null {
  for (const candidate of [input.targetRepId, input.urlRepId, input.stateEmployeeId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function resolveAdminLedgerPeriodKey(input: {
  monthId?: string | null;
  routePeriodKey?: string | null;
  documentMonthId?: string | null;
}): string {
  for (const candidate of [input.monthId, input.routePeriodKey, input.documentMonthId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "legacy";
}

export function isAdminLedgerUnavailable(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message === ADMIN_LEDGER_UNAVAILABLE ||
    isMissingTable(message) ||
    isMissingFunction(message) ||
    message.includes("admin_employee_sheets") ||
    message.includes("upsert_admin_employee_sheet") ||
    message.includes("mark_admin_employee_sheet_paid")
  );
}

export function parseAdminSheetData(value: unknown): TrackerState | null {
  const fromDocument = trackerStateFromPayTrackerDocument(value);
  if (fromDocument && (trackerHasSales(fromDocument) || worksheetContentScore(fromDocument) > 0 || (fromDocument.months ?? []).some((month) => (month.sheets ?? []).length > 0))) {
    return fromDocument;
  }
  const parsed = parseTrackerState(value);
  if (parsed && (trackerHasSales(parsed) || parsed.months.length > 0)) return parsed;
  const deals = extractDealsFromSheetData(value);
  if (deals.length > 0) {
    const envelope = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const rebuilt = trackerStateFromPayTrackerDocument({ ...envelope, deals, records: deals });
    if (rebuilt && trackerHasSales(rebuilt)) return rebuilt;
  }
  return fromDocument && trackerHasSales(fromDocument) ? fromDocument : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export function parseAdminEmployeeSheet(raw: unknown): AdminEmployeeSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const employeeId = asText(row.employee_id);
  if (!employeeId) return null;
  const sheetData = row.sheet_data ?? {};
  const status = asText(row.status) ?? ADMIN_SHEET_DRAFT;
  // Strict DB flag only — never infer isPaid from status text alone.
  const isPaid = asBoolean(row.is_paid);
  const monthId = asText(row.month_id);
  const periodKey = asText(row.period_key) ?? monthId;
  return {
    employeeId,
    orgId: asText(row.org_id),
    locationId: asText(row.location_id),
    monthId,
    periodKey,
    sheetData,
    status: isPaid && status.toLowerCase() !== ADMIN_SHEET_PAID ? ADMIN_SHEET_PAID : status,
    createdBy: asText(row.created_by),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
    paidAt: asText(row.paid_at),
    isPaid,
    state: parseAdminSheetData(sheetData),
  };
}

/** Escape PostgREST filter values that include en-dashes or other reserved characters. */
function quotePeriodFilterValue(value: string): string {
  if (/^[a-zA-Z0-9._-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function resolvePreferredPeriod(periodKey: string): PayPeriodIdentity {
  const preferred = periodFromUnknown(periodKey);
  if (preferred.key) return preferred;
  return {
    ...preferred,
    key: periodKey,
    raw: preferred.raw ?? periodKey,
  };
}

/**
 * Query filter for admin_employee_sheets: exact `period_key` (and legacy `month_id` same value).
 * Does not use year/month/period/store_id columns — those are not on this table.
 */
function adminPeriodKeyFilter(periodKey: string, withPeriodKeyColumn: boolean): { column: "period_key" | "month_id"; value: string } | { or: string } {
  const key = periodKey.trim();
  if (withPeriodKeyColumn) {
    // Prefer exact period_key; also accept legacy rows that stored the same string in month_id.
    return { or: `period_key.eq.${quotePeriodFilterValue(key)},month_id.eq.${quotePeriodFilterValue(key)}` };
  }
  return { column: "month_id", value: key };
}

export async function loadAdminEmployeeSheet(
  employeeId: string,
  periodKey?: string | null,
): Promise<AdminSheetLoad> {
  const supabase = getSupabase();
  if (!supabase) return { status: "missing" };
  const client = supabase;
  const key = typeof periodKey === "string" && periodKey.trim() ? periodKey.trim() : null;

  async function run(select: string, withPeriodKeyColumn: boolean) {
    let query = client
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .select(select)
      .eq("employee_id", employeeId)
      .order("updated_at", { ascending: false })
      .limit(key ? 20 : 1);
    if (key) {
      const filter = adminPeriodKeyFilter(key, withPeriodKeyColumn);
      query = "or" in filter ? query.or(filter.or) : query.eq(filter.column, filter.value);
    }
    return key ? query : query.maybeSingle();
  }

  let first = await run(ADMIN_EMPLOYEE_SHEET_SELECT, true);
  if (first.error && isMissingColumn(first.error.message, first.error.code)) {
    first = await run(ADMIN_EMPLOYEE_SHEET_SELECT_MIN, !missingColumnName(first.error.message)?.includes("period"));
    if (first.error && isMissingColumn(first.error.message, first.error.code)) {
      first = await run(
        ADMIN_EMPLOYEE_SHEET_SELECT_MIN.replace(",period_key", "").replace("period_key,", ""),
        false,
      );
    }
  }
  const result = first;
  if (result.error) {
    if (isMissingTable(result.error.message, result.error.code) || isMissingRelation(result.error.message, result.error.code)) {
      return { status: "missing" };
    }
    console.error("admin_employee_sheets select failed:", result.error.message);
    return { status: "error", message: result.error.message };
  }
  if (!key) {
    const row = result.data ? parseAdminEmployeeSheet(result.data as unknown) : null;
    return { status: "ready", row };
  }
  const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : [])
    .map((item) => parseAdminEmployeeSheet(item as unknown))
    .filter((row): row is AdminEmployeeSheet => Boolean(row))
    .filter((row) => matchesAdminSheetPeriodKey(row, key))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  return { status: "ready", row: rows[0] ?? null };
}

export async function loadAdminEmployeeSheets(periodKey?: string | null): Promise<AdminEmployeeSheet[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const client = supabase;
  const key = typeof periodKey === "string" && periodKey.trim() ? periodKey.trim() : null;

  async function run(select: string, withPeriodKeyColumn: boolean) {
    let query = client.from(ADMIN_EMPLOYEE_SHEETS_TABLE).select(select).order("updated_at", { ascending: false });
    if (key) {
      const filter = adminPeriodKeyFilter(key, withPeriodKeyColumn);
      query = "or" in filter ? query.or(filter.or) : query.eq(filter.column, filter.value);
    }
    return query;
  }

  let first = await run(ADMIN_EMPLOYEE_SHEET_SELECT, true);
  if (first.error && isMissingColumn(first.error.message, first.error.code)) {
    const withoutPeriod = ADMIN_EMPLOYEE_SHEET_SELECT_MIN.replace(",period_key", "").replace("period_key,", "");
    first = await run(withoutPeriod, false);
  }
  if (first.error) {
    if (isMissingTable(first.error.message, first.error.code) || isMissingRelation(first.error.message, first.error.code)) {
      return [];
    }
    console.error("admin_employee_sheets list failed:", first.error.message);
    return [];
  }
  const rows = (first.data ?? [])
    .map(parseAdminEmployeeSheet)
    .filter((row): row is AdminEmployeeSheet => Boolean(row));
  if (!key) return rows;
  return rows.filter((row) => matchesAdminSheetPeriodKey(row, key));
}

function matchesAdminSheetPeriodKey(row: AdminEmployeeSheet, periodKey: string): boolean {
  const target = periodKey.trim();
  if (!target) return false;
  // Exact schema match on period_key (preferred) or legacy month_id copy of the same key.
  if (row.periodKey === target || row.monthId === target) return true;
  const preferred = resolvePreferredPeriod(target);
  if (strictMatchesPeriodKey(row.periodKey, preferred)) return true;
  if (strictMatchesPeriodKey(row.monthId, preferred)) return true;
  return false;
}

async function currentActorId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? getCachedProfile()?.id ?? null;
}

export async function upsertAdminEmployeeSheet(input: {
  employeeId?: string | null;
  state: TrackerState;
  locationId?: string | null;
  monthId?: string | null;
  urlRepId?: string | null;
  routePeriodKey?: string | null;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const actor = await currentActorId();
  if (!actor) return "Not signed in.";

  const employeeId = resolveAdminLedgerEmployeeId({
    targetRepId: input.employeeId,
    urlRepId: input.urlRepId,
  });
  if (!employeeId) {
    console.error("Admin ledger save aborted: missing employee_id (no entryRepId, URL rep, or target).");
    return "Employee not found for admin ledger save.";
  }

  const periodKey = resolveAdminLedgerPeriodKey({
    monthId: input.monthId,
    routePeriodKey: input.routePeriodKey,
  });

  const document = JSON.parse(JSON.stringify(buildPayTrackerDocument(input.state, employeeId))) as ReturnType<
    typeof buildPayTrackerDocument
  > & { period_key?: string };
  document.employee_id = employeeId;
  document.month_id = periodKey;
  document.period_id = periodKey;
  document.period_key = periodKey;

  const rpc = await supabase.rpc("upsert_admin_employee_sheet", {
    target_employee: employeeId,
    payload: document,
    p_month_id: periodKey,
    p_location_id: input.locationId || null,
  });
  if (!rpc.error) return null;

  if (
    !isMissingFunction(rpc.error.message, rpc.error.code) &&
    !isMissingRelation(rpc.error.message, rpc.error.code)
  ) {
    console.error("upsert_admin_employee_sheet failed:", rpc.error.message, rpc.error.code ?? "");
  }

  if (isMissingRelation(rpc.error.message, rpc.error.code) || isMissingFunction(rpc.error.message, rpc.error.code)) {
    // Fall through to direct table upsert when the RPC is unavailable.
  } else if (
    rpc.error.message.toLowerCase().includes("only an admin") ||
    rpc.error.message.toLowerCase().includes("not signed in") ||
    rpc.error.message.toLowerCase().includes("employee not found")
  ) {
    return rpc.error.message;
  }

  const profile = getCachedProfile();
  const people = await listProfiles();
  const employee = people.find((person) => person.id === employeeId);
  const existing = await loadAdminEmployeeSheet(employeeId, periodKey);
  const priorStatus = existing.status === "ready" ? existing.row?.status : null;
  const row: Record<string, unknown> = {
    employee_id: employeeId,
    org_id: employee?.org_id ?? profile?.org_id ?? null,
    location_id: input.locationId || employee?.location_id || null,
    month_id: periodKey,
    period_key: periodKey,
    sheet_data: document,
    status: nextAdminSheetStatusOnEdit(priorStatus),
    created_by: actor,
    updated_at: new Date().toISOString(),
  };

  let attempt = row;
  let conflictTarget = "employee_id,period_key";
  for (let i = 0; i < 8; i += 1) {
    const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(attempt, {
      onConflict: conflictTarget,
    });
    if (!error) return null;
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return ADMIN_LEDGER_UNAVAILABLE;
    }
    if (isMissingColumn(error.message, error.code)) {
      const column = missingColumnName(error.message);
      console.error("admin_employee_sheets upsert missing column, retrying without:", column ?? error.message);
      if (column && column in attempt) {
        const next = { ...attempt };
        delete next[column];
        attempt = next;
        if (column === "period_key") conflictTarget = "employee_id";
        continue;
      }
    }
    if (
      conflictTarget === "employee_id,period_key" &&
      (error.message.toLowerCase().includes("no unique") ||
        error.message.toLowerCase().includes("on conflict") ||
        error.code === "42P10")
    ) {
      console.error("admin_employee_sheets composite conflict unavailable, falling back to employee_id:", error.message);
      conflictTarget = "employee_id";
      continue;
    }
    console.error("admin_employee_sheets upsert failed:", error.message, error.code ?? "");
    return error.message;
  }
  return "admin_employee_sheets upsert failed after column retries.";
}

export async function markAdminEmployeeSheetPushed(employeeId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const rpc = await supabase.rpc("mark_admin_employee_sheet_pushed", { target_employee: employeeId });
  if (!rpc.error) return null;
  if (isMissingRelation(rpc.error.message, rpc.error.code)) {
    const { error } = await supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .update({ status: ADMIN_SHEET_PUSHED, updated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    if (!error || isMissingRelation(error.message, error.code)) return null;
    console.error("admin_employee_sheets mark pushed failed:", error.message);
    return error.message;
  }
  console.error("mark_admin_employee_sheet_pushed failed:", rpc.error.message);
  return rpc.error.message;
}

export async function applyManagerApprovalToAdminSheet(input: {
  employeeId: string;
  state: TrackerState;
  dealRows?: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const fromRows = (input.dealRows ?? []).filter(isActiveWorksheetDealRow);
  const snapshot =
    compileManagerApprovalSnapshot({
      preferred: input.state,
      dealRows: fromRows,
    }) ?? (fromRows.length ? assembleWorkingState(fromRows) : input.state);
  const payload = JSON.parse(JSON.stringify(serializeManagerApprovalPayload(snapshot, input.employeeId))) as ReturnType<
    typeof serializeManagerApprovalPayload
  >;
  const deals = payload.deals?.length ? payload.deals : collectWorksheetDeals(snapshot);
  payload.deals = deals;
  payload.records = deals;
  payload.state = {
    months: snapshot.months ?? [],
    vehicleTypes: snapshot.vehicleTypes ?? [],
    deals,
  };
  if (!payload || typeof payload !== "object") {
    return lockAdminEmployeeSheetApproved(input.employeeId);
  }
  const rpc = await supabase.rpc("apply_manager_approval_to_admin_sheet", {
    target_employee: input.employeeId,
    payload,
  });
  if (!rpc.error) return null;
  if (isMissingRelation(rpc.error.message, rpc.error.code)) {
    const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(
      {
        employee_id: input.employeeId,
        sheet_data: payload,
        status: ADMIN_SHEET_FINAL_APPROVED,
        month_id: payload.month_id,
        period_key: payload.month_id || payload.period_id || "legacy",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,period_key" },
    );
    if (!error || isMissingRelation(error.message, error.code)) return null;
    console.error("admin_employee_sheets approval overwrite failed:", error.message);
    return error.message;
  }
  console.error("apply_manager_approval_to_admin_sheet failed:", rpc.error.message);
  return rpc.error.message;
}

export async function lockAdminEmployeeSheetApproved(employeeId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const rpc = await supabase.rpc("lock_admin_employee_sheet_approved", { target_employee: employeeId });
  if (!rpc.error) return null;
  if (isMissingRelation(rpc.error.message, rpc.error.code)) {
    const { error } = await supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .update({ status: ADMIN_SHEET_FINAL_APPROVED, updated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    if (!error || isMissingRelation(error.message, error.code)) return null;
    console.error("admin_employee_sheets lock approved failed:", error.message);
    return error.message;
  }
  console.error("lock_admin_employee_sheet_approved failed:", rpc.error.message);
  return rpc.error.message;
}

export async function markAdminEmployeeSheetPaid(
  employeeId: string,
  periodKey?: string | null,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const paidAt = new Date().toISOString();
  const key = typeof periodKey === "string" && periodKey.trim() ? periodKey.trim() : null;
  const rpc = key
    ? await supabase.rpc("mark_admin_employee_sheet_paid", {
        target_employee: employeeId,
        p_period_key: key,
      })
    : await supabase.rpc("mark_admin_employee_sheet_paid", { target_employee: employeeId });
  if (!rpc.error) {
    await syncEmployeeSnapshotPaid(employeeId, key, paidAt);
    return null;
  }
  if (isMissingFunction(rpc.error.message, rpc.error.code) || isMissingRelation(rpc.error.message, rpc.error.code)) {
    const attempts: Array<Record<string, unknown>> = [
      { status: ADMIN_SHEET_PAID, is_paid: true, paid_at: paidAt, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, paid_at: paidAt, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, is_paid: true, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, updated_at: paidAt },
    ];
    let lastError: string | null = null;
    for (const payload of attempts) {
      let query = supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).update(payload).eq("employee_id", employeeId);
      if (key) query = query.or(`period_key.eq.${key},month_id.eq.${key}`);
      const result = await query.select("employee_id");
      if (!result.error) {
        if ((result.data?.length ?? 0) === 0) {
          return "Sheet must be finalized before it can be marked paid.";
        }
        await syncEmployeeSnapshotPaid(employeeId, key, paidAt);
        return null;
      }
      if (isMissingRelation(result.error.message, result.error.code)) {
        return "Admin pay sheet ledger is unavailable. Could not mark this sheet paid.";
      }
      if (isMissingColumn(result.error.message, result.error.code)) {
        lastError = result.error.message;
        continue;
      }
      console.error("admin_employee_sheets mark paid failed:", result.error.message);
      return result.error.message;
    }
    if (lastError) console.error("admin_employee_sheets mark paid failed:", lastError);
    return lastError ?? "Could not mark this pay sheet as paid.";
  }
  console.error("mark_admin_employee_sheet_paid failed:", rpc.error.message);
  return rpc.error.message;
}

async function syncEmployeeSnapshotPaid(
  employeeId: string,
  periodKey: string | null,
  paidAt: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    let tracker = supabase
      .from(PAY_TRACKER_STATE_TABLE)
      .update({ status: ADMIN_SHEET_PAID, updated_at: paidAt })
      .or(`employee_id.eq.${employeeId},user_id.eq.${employeeId},id.eq.${employeeId}`);
    if (periodKey) tracker = tracker.eq("month_id", periodKey);
    await tracker;

    await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({ status: ADMIN_SHEET_PAID, updated_at: paidAt })
      .eq("rep_id", employeeId)
      .in("status", [
        "admin_final_approved",
        "approved_final",
        "manager_approved",
        "rep_authorized_no_changes",
        "rep_accepted_no_changes",
        "rep_modified",
        "pending_admin_approval",
        "pending_manager_approval",
        "paid",
      ]);
  } catch {
    /* best-effort sync for environments without the updated RPC */
  }
}

/** Rep-facing lock check against admin_employee_sheets (security-definer RPC). */
export async function loadMyAdminSheetLockStatus(
  periodKey?: string | null,
): Promise<{ status: string; isPaid: boolean } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const key = typeof periodKey === "string" && periodKey.trim() ? periodKey.trim() : null;
  const rpc = await supabase.rpc("get_my_admin_sheet_lock_status", {
    p_period_key: key,
  });
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (!row || typeof row !== "object") return null;
    const status = typeof (row as { status?: unknown }).status === "string" ? (row as { status: string }).status : "";
    const isPaid =
      (row as { is_paid?: unknown }).is_paid === true || isPaidAdminSheet(status, false);
    if (!status && !isPaid) return null;
    return { status, isPaid };
  }
  if (isMissingFunction(rpc.error.message, rpc.error.code)) {
    // Fallback: try direct select (works only if a future policy allows employee self-read).
    let query = supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .select("status,is_paid,period_key,month_id")
      .eq("employee_id", (await currentActorId()) ?? "")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (key) query = query.or(`period_key.eq.${key},month_id.eq.${key}`);
    const result = await query.maybeSingle();
    if (result.error || !result.data) return null;
    const status = typeof result.data.status === "string" ? result.data.status : "";
    const isPaid = result.data.is_paid === true || isPaidAdminSheet(status, false);
    return { status, isPaid };
  }
  return null;
}

export async function recallAdminEmployeeSheetStatus(employeeId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .update({ status: ADMIN_SHEET_DRAFT, updated_at: new Date().toISOString() })
    .eq("employee_id", employeeId)
    .neq("status", ADMIN_SHEET_PAID);
  if (!error || isMissingRelation(error.message, error.code)) return null;
  console.error("admin_employee_sheets recall failed:", error.message);
  return error.message;
}

/** Delete a period row from the admin ledger. Never calls upsert_admin_employee_sheet RPC. */
export async function deleteAdminEmployeeSheet(input: {
  employeeId: string;
  periodKey: string;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const employeeId = input.employeeId.trim();
  const periodKey = input.periodKey.trim();
  if (!employeeId || !periodKey) {
    console.error("Admin ledger delete aborted: missing employee_id or period_key.");
    return "Employee not found for admin ledger delete.";
  }

  let { error } = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .delete()
    .match({ employee_id: employeeId, period_key: periodKey });

  if (error && isMissingColumn(error.message, error.code)) {
    const fallback = await supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .delete()
      .eq("employee_id", employeeId)
      .eq("month_id", periodKey);
    error = fallback.error;
  }

  if (error) {
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return ADMIN_LEDGER_UNAVAILABLE;
    }
    console.error("admin_employee_sheets delete failed:", error.message, error.code ?? "");
    return error.message;
  }

  await cleanupAdminPeriodSnapshots({ employeeId, periodKey });
  return null;
}

/** Reset a period row to a blank draft. Never calls upsert_admin_employee_sheet RPC. */
export async function resetAdminEmployeeSheet(input: {
  employeeId: string;
  periodKey: string;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const employeeId = input.employeeId.trim();
  const periodKey = input.periodKey.trim();
  if (!employeeId || !periodKey) {
    console.error("Admin ledger reset aborted: missing employee_id or period_key.");
    return "Employee not found for admin ledger reset.";
  }

  const patch: Record<string, unknown> = {
    sheet_data: {},
    status: ADMIN_SHEET_DRAFT,
    is_paid: false,
    paid_at: null,
    month_id: periodKey,
    period_key: periodKey,
    updated_at: new Date().toISOString(),
  };

  let attempt = patch;
  for (let i = 0; i < 6; i += 1) {
    let { error } = await supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .update(attempt)
      .match({ employee_id: employeeId, period_key: periodKey });

    if (error && isMissingColumn(error.message, error.code) && missingColumnName(error.message) === "period_key") {
      const fallback = await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .update(attempt)
        .eq("employee_id", employeeId)
        .eq("month_id", periodKey);
      error = fallback.error;
    }

    if (!error) {
      await cleanupAdminPeriodSnapshots({ employeeId, periodKey });
      return null;
    }
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return ADMIN_LEDGER_UNAVAILABLE;
    }
    if (isMissingColumn(error.message, error.code)) {
      const column = missingColumnName(error.message);
      if (column && column in attempt) {
        const next = { ...attempt };
        delete next[column];
        attempt = next;
        continue;
      }
    }
    // No row for this period — treat as already cleared.
    if (error.code === "PGRST116" || error.message.toLowerCase().includes("0 rows")) {
      return null;
    }
    console.error("admin_employee_sheets reset failed:", error.message, error.code ?? "");
    return error.message;
  }
  return "admin_employee_sheets reset failed after column retries.";
}

async function cleanupAdminPeriodSnapshots(input: {
  employeeId: string;
  periodKey: string;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const now = new Date().toISOString();
  // Clear admin push / approval overlays only — never touch pay_tracker_state.state (employee workbook).
  const trackerPatch = {
    admin_pushed_snapshot: null,
    rep_draft: null,
    approval_diffs: [],
    pay_delta: 0,
    finalized_label: null,
    deny_reason: null,
    status: "draft",
    updated_at: now,
  };
  const byMonth = await supabase
    .from(PAY_TRACKER_STATE_TABLE)
    .update(trackerPatch)
    .or(`employee_id.eq.${input.employeeId},user_id.eq.${input.employeeId},id.eq.${input.employeeId}`)
    .eq("month_id", input.periodKey);
  if (
    byMonth.error &&
    !isMissingRelation(byMonth.error.message, byMonth.error.code) &&
    !isMissingTable(byMonth.error.message, byMonth.error.code)
  ) {
    if (!isMissingColumn(byMonth.error.message, byMonth.error.code)) {
      console.error("pay_tracker_state period cleanup failed:", byMonth.error.message);
    }
  }

  // Strip admin push snapshots from deal rows; do not delete the employee's deal records.
  try {
    await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({ admin_pushed_snapshot: null, updated_at: now })
      .eq("rep_id", input.employeeId)
      .not("admin_pushed_snapshot", "is", null);
  } catch {
    /* best-effort; employee live deals remain intact */
  }
}

/**
 * Admin-only: permanently delete the admin ledger row for one employee + period_key.
 * Does not delete the employee's personal pay tracker workbook or live deal rows.
 * Paid sheets may be deleted by admins (caller should confirm in the UI).
 */
export async function deleteAdminSheetCopy(input: {
  employeeId: string;
  periodKey: string;
  allowPaid?: boolean;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const profile = getCachedProfile();
  if (!canManageOrg(profile?.role)) {
    return "Only an admin can reset the admin sheet copy.";
  }

  const employeeId = input.employeeId.trim();
  const periodKey = input.periodKey.trim();
  if (!employeeId || !periodKey) {
    return "Employee or pay period missing for admin sheet reset.";
  }

  const error = await deleteAdminEmployeeSheet({ employeeId, periodKey });
  if (!error) {
    console.log("[Delete Sheet] Removed admin_employee_sheets row", { employeeId, periodKey });
  }
  return error;
}
