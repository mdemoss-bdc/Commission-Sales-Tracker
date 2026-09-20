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
  USER_NOTIFICATIONS_TABLE,
  USER_PROFILES_TABLE,
} from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

type OverlayView = "live" | "overlay" | "staged";

export const ADMIN_SHEET_DRAFT = "draft";
export const ADMIN_SHEET_PUSHED = "pushed";
/** Admin baseline routed to the manager clearinghouse. */
export const ADMIN_SHEET_SENT_TO_MANAGER = "sent_to_manager";
export const ADMIN_SHEET_APPROVED_FINAL = "approved_final";
export const ADMIN_SHEET_FINAL_APPROVED = "admin_final_approved";
export const ADMIN_SHEET_SUBMITTED_TO_PAYROLL = "submitted_to_payroll";
export const ADMIN_SHEET_PAID = "paid";
export const ADMIN_LEDGER_UNAVAILABLE = "missing-admin-employee-sheets";

export type AdminSheetStatus =
  | typeof ADMIN_SHEET_DRAFT
  | typeof ADMIN_SHEET_PUSHED
  | typeof ADMIN_SHEET_SENT_TO_MANAGER
  | typeof ADMIN_SHEET_APPROVED_FINAL
  | typeof ADMIN_SHEET_FINAL_APPROVED
  | typeof ADMIN_SHEET_SUBMITTED_TO_PAYROLL
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
    key === ADMIN_SHEET_SUBMITTED_TO_PAYROLL ||
    key === "manager_approved" ||
    key === "submitted_to_payroll"
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
  /** When true, write is_paid / paid status (Mark Paid). Draft / push saves pass false. */
  isPaid?: boolean;
  /** Override ledger status; defaults from prior row + isPaid. */
  status?: string | null;
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

  const profile = getCachedProfile();
  if (!canManageOrg(profile?.role)) {
    return "Only an admin can save the admin sheet copy.";
  }

  const people = await listProfiles();
  const employee = people.find((person) => person.id === employeeId);
  const existing = await loadAdminEmployeeSheet(employeeId, periodKey);
  const prior = existing.status === "ready" ? existing.row : null;
  const priorStatus = prior?.status ?? null;
  const isPaidStatus = input.isPaid === true;
  const now = new Date().toISOString();
  let status =
    typeof input.status === "string" && input.status.trim() ? input.status.trim() : null;
  if (!status) {
    if (isPaidStatus) {
      status = ADMIN_SHEET_PAID;
    } else if (isPaidAdminSheet(priorStatus, prior?.isPaid)) {
      // Save Draft clears paid — reopen as editable draft.
      status = ADMIN_SHEET_DRAFT;
    } else {
      status = nextAdminSheetStatusOnEdit(priorStatus);
    }
  }

  // Direct table write — never call upsert_admin_employee_sheet RPC (404 when missing from schema cache).
  let existingId: string | null = null;
  {
    let lookup = await supabase
      .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
      .select("id")
      .eq("employee_id", employeeId)
      .eq("period_key", periodKey)
      .maybeSingle();
    if (lookup.error && isMissingColumn(lookup.error.message, lookup.error.code)) {
      lookup = await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .select("id")
        .eq("employee_id", employeeId)
        .eq("month_id", periodKey)
        .maybeSingle();
    }
    if (
      lookup.error &&
      !isMissingRelation(lookup.error.message, lookup.error.code) &&
      !isMissingTable(lookup.error.message, lookup.error.code) &&
      !isMissingColumn(lookup.error.message, lookup.error.code)
    ) {
      console.error("[Save Sheet Error]: lookup failed", lookup.error);
      return lookup.error.message;
    }
    existingId =
      lookup.data && typeof (lookup.data as { id?: unknown }).id === "string"
        ? (lookup.data as { id: string }).id
        : null;
  }

  const payload: Record<string, unknown> = {
    employee_id: employeeId,
    org_id: employee?.org_id ?? profile?.org_id ?? null,
    location_id: input.locationId || employee?.location_id || null,
    month_id: periodKey,
    period_key: periodKey,
    sheet_data: document,
    status,
    is_paid: isPaidStatus,
    paid_at: isPaidStatus ? now : null,
    created_by: actor,
    updated_at: now,
  };

  let attempt = payload;
  for (let i = 0; i < 8; i += 1) {
    let saveError: { message: string; code?: string } | null = null;
    if (existingId) {
      const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).update(attempt).eq("id", existingId);
      saveError = error;
    } else {
      const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).insert(attempt);
      saveError = error;
    }

    if (!saveError) {
      console.log("[Save Sheet] Direct table write ok", {
        employeeId,
        periodKey,
        is_paid: isPaidStatus,
        status,
        mode: existingId ? "update" : "insert",
      });
      return null;
    }

    if (isMissingRelation(saveError.message, saveError.code) || isMissingTable(saveError.message, saveError.code)) {
      return ADMIN_LEDGER_UNAVAILABLE;
    }
    if (isMissingColumn(saveError.message, saveError.code)) {
      const column = missingColumnName(saveError.message);
      console.error("admin_employee_sheets save missing column, retrying without:", column ?? saveError.message);
      if (column && column in attempt) {
        const next = { ...attempt };
        delete next[column];
        attempt = next;
        continue;
      }
    }
    // Insert raced / unique conflict — switch to match update by employee + period.
    const conflict =
      !existingId &&
      (saveError.code === "23505" ||
        saveError.message.toLowerCase().includes("duplicate") ||
        saveError.message.toLowerCase().includes("unique"));
    if (conflict) {
      const { error: matchError } = await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .update(attempt)
        .eq("employee_id", employeeId)
        .eq("period_key", periodKey);
      if (!matchError) {
        console.log("[Save Sheet] Direct table write ok", {
          employeeId,
          periodKey,
          is_paid: isPaidStatus,
          status,
          mode: "update-match",
        });
        return null;
      }
      if (isMissingColumn(matchError.message, matchError.code)) {
        const { error: monthMatch } = await supabase
          .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
          .update(attempt)
          .eq("employee_id", employeeId)
          .eq("month_id", periodKey);
        if (!monthMatch) return null;
      }
    }
    // No id column / lookup miss — fall back to insert without id match.
    if (existingId && (saveError.message.toLowerCase().includes('"id"') || saveError.code === "42703")) {
      existingId = null;
      continue;
    }
    console.error("[Save Sheet Error]:", saveError);
    return saveError.message;
  }
  return "admin_employee_sheets save failed after column retries.";
}

export async function markAdminEmployeeSheetPushed(
  employeeId: string,
  periodKey?: string | null,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const now = new Date().toISOString();
  const key = typeof periodKey === "string" && periodKey.trim() ? periodKey.trim() : null;
  // Clearinghouse: baseline is sent to the manager (legacy "pushed" kept as fallback status).
  const attempts: Array<Record<string, unknown>> = [
    { status: ADMIN_SHEET_SENT_TO_MANAGER, is_paid: false, paid_at: null, updated_at: now },
    { status: ADMIN_SHEET_SENT_TO_MANAGER, is_paid: false, updated_at: now },
    { status: ADMIN_SHEET_SENT_TO_MANAGER, updated_at: now },
    { status: ADMIN_SHEET_PUSHED, is_paid: false, paid_at: null, updated_at: now },
    { status: ADMIN_SHEET_PUSHED, updated_at: now },
  ];
  let lastError: string | null = null;
  for (const payload of attempts) {
    let query = supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).update(payload).eq("employee_id", employeeId);
    if (key) query = query.or(`period_key.eq.${key},month_id.eq.${key}`);
    const { error } = await query;
    if (!error) {
      console.log("[Save Sheet] Marked sent_to_manager", { employeeId, periodKey: key, status: payload.status });
      return null;
    }
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return null;
    }
    if (isMissingColumn(error.message, error.code) || isMissingEnumValueLike(error.message)) {
      lastError = error.message;
      continue;
    }
    console.error("admin_employee_sheets mark sent_to_manager failed:", error.message);
    return error.message;
  }
  if (lastError) console.error("admin_employee_sheets mark sent_to_manager failed:", lastError);
  return lastError;
}

function isMissingEnumValueLike(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("invalid input value for enum") || text.includes("sent_to_manager");
}

export async function applyManagerApprovalToAdminSheet(input: {
  employeeId: string;
  state: TrackerState;
  dealRows?: DealRow[];
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const employeeId = input.employeeId.trim();
  if (!employeeId) return "Employee not found for manager approval.";

  const fromRows = (input.dealRows ?? []).filter(isActiveWorksheetDealRow);
  const snapshot =
    compileManagerApprovalSnapshot({
      preferred: input.state,
      dealRows: fromRows,
    }) ?? (fromRows.length ? assembleWorkingState(fromRows) : input.state);
  const payload = JSON.parse(JSON.stringify(serializeManagerApprovalPayload(snapshot, employeeId))) as ReturnType<
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
    return lockAdminEmployeeSheetApproved(employeeId);
  }

  const periodKey = resolveAdminLedgerPeriodKey({
    monthId: typeof payload.month_id === "string" ? payload.month_id : null,
    routePeriodKey: typeof payload.period_id === "string" ? payload.period_id : null,
    documentMonthId: typeof payload.month_id === "string" ? payload.month_id : null,
  });
  payload.month_id = periodKey;
  payload.period_id = periodKey;
  (payload as { period_key?: string }).period_key = periodKey;
  payload.employee_id = employeeId;

  const profile = getCachedProfile();
  const people = await listProfiles();
  const employee = people.find((person) => person.id === employeeId);
  const actor = profile?.id ?? null;
  const now = new Date().toISOString();

  // Direct upsert against (employee_id, period_key) — skip RPC to avoid unique-constraint / 404 failures.
  const row: Record<string, unknown> = {
    employee_id: employeeId,
    org_id: employee?.org_id ?? profile?.org_id ?? null,
    location_id: employee?.location_id ?? profile?.location_id ?? null,
    month_id: periodKey,
    period_key: periodKey,
    sheet_data: payload,
    status: ADMIN_SHEET_SUBMITTED_TO_PAYROLL,
    is_paid: false,
    paid_at: null,
    created_by: actor,
    updated_at: now,
  };

  let attempt = row;
  for (let i = 0; i < 8; i += 1) {
    const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(attempt, {
      onConflict: "employee_id,period_key",
    });
    if (!error) {
      console.log("[Manager Approval] Upserted admin_employee_sheets", {
        employeeId,
        period_key: periodKey,
        status: ADMIN_SHEET_SUBMITTED_TO_PAYROLL,
        is_paid: false,
      });
      return null;
    }
    if (isMissingRelation(error.message, error.code) || isMissingTable(error.message, error.code)) {
      return ADMIN_LEDGER_UNAVAILABLE;
    }
    if (isMissingColumn(error.message, error.code)) {
      const column = missingColumnName(error.message);
      console.error("admin_employee_sheets manager approval missing column, retrying without:", column ?? error.message);
      if (column && column in attempt) {
        const next = { ...attempt };
        delete next[column];
        attempt = next;
        continue;
      }
    }
    // Unique / conflict target missing — fall back to select + update/insert.
    if (
      error.code === "42P10" ||
      error.message.toLowerCase().includes("no unique") ||
      error.message.toLowerCase().includes("on conflict") ||
      error.code === "23505"
    ) {
      let lookup = await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .select("id")
        .eq("employee_id", employeeId)
        .eq("period_key", periodKey)
        .maybeSingle();
      if (lookup.error && isMissingColumn(lookup.error.message, lookup.error.code)) {
        lookup = await supabase
          .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
          .select("id")
          .eq("employee_id", employeeId)
          .eq("month_id", periodKey)
          .maybeSingle();
      }
      const existingId =
        lookup.data && typeof (lookup.data as { id?: unknown }).id === "string"
          ? (lookup.data as { id: string }).id
          : null;
      if (existingId) {
        const { error: updateError } = await supabase
          .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
          .update(attempt)
          .eq("id", existingId);
        if (!updateError) return null;
        if (isMissingColumn(updateError.message, updateError.code)) {
          const column = missingColumnName(updateError.message);
          if (column && column in attempt) {
            const next = { ...attempt };
            delete next[column];
            attempt = next;
            continue;
          }
        }
        console.error("[Manager Approval] Update failed:", updateError);
        return updateError.message;
      }
      const { error: insertError } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).insert(attempt);
      if (!insertError) return null;
      if (isMissingColumn(insertError.message, insertError.code)) {
        const column = missingColumnName(insertError.message);
        if (column && column in attempt) {
          const next = { ...attempt };
          delete next[column];
          attempt = next;
          continue;
        }
      }
      console.error("[Manager Approval] Insert failed:", insertError);
      return insertError.message;
    }
    console.error("[Manager Approval] Upsert failed:", error);
    return error.message;
  }
  return "admin_employee_sheets manager approval failed after column retries.";
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
  // Direct table update — avoid mark_admin_employee_sheet_paid RPC 404s.
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
      console.log("[Save Sheet] Marked paid", { employeeId, periodKey: key });
      await syncEmployeeSnapshotPaid(employeeId, key, paidAt);
      return null;
    }
    if (isMissingRelation(result.error.message, result.error.code) || isMissingTable(result.error.message, result.error.code)) {
      return "Admin pay sheet ledger is unavailable. Could not mark this sheet paid.";
    }
    if (isMissingColumn(result.error.message, result.error.code)) {
      lastError = result.error.message;
      continue;
    }
    console.error("[Save Sheet Error]: mark paid failed", result.error);
    return result.error.message;
  }
  if (lastError) console.error("[Save Sheet Error]: mark paid failed", lastError);
  return lastError ?? "Could not mark this pay sheet as paid.";
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

/** Reset / delete admin sheet for a period: remove ledger row and cascade push queues. */
export async function resetAdminEmployeeSheet(input: {
  employeeId: string;
  periodKey: string;
}): Promise<string | null> {
  return cascadeDeleteAdminPush(input);
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
    // Fall back: clear overlays for this employee without month filter when month_id column varies.
    const fallback = await supabase
      .from(PAY_TRACKER_STATE_TABLE)
      .update(trackerPatch)
      .or(`employee_id.eq.${input.employeeId},user_id.eq.${input.employeeId},id.eq.${input.employeeId}`);
    if (fallback.error && !isMissingRelation(fallback.error.message, fallback.error.code)) {
      console.error("pay_tracker_state employee cleanup failed:", fallback.error.message);
    }
  }

  // Clear in-flight push / review statuses on deal_records — keep live_data and personal drafts.
  const pushStatuses = [
    "pending_rep_review",
    "awaiting_review",
    "pushed",
    "admin_pushed",
    "staged",
    "pending_manager_approval",
    "rep_modified",
    "rep_authorized_no_changes",
    "rep_accepted_no_changes",
    "rejected_by_manager",
  ];
  for (const status of pushStatuses) {
    const { error } = await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({
        status: "draft",
        proposed_data: {},
        reject_reason: null,
        updated_at: now,
      })
      .eq("rep_id", input.employeeId)
      .eq("status", status);
    if (error && !isMissingRelation(error.message, error.code) && !isMissingTable(error.message, error.code)) {
      if (!isMissingColumn(error.message, error.code)) {
        console.error("deal_records push cleanup failed:", status, error.message);
      }
    }
  }

  // Best-effort: strip admin push snapshot columns if present.
  try {
    await supabase
      .from(DEAL_RECORDS_TABLE)
      .update({ admin_pushed_snapshot: null, updated_at: now })
      .eq("rep_id", input.employeeId)
      .not("admin_pushed_snapshot", "is", null);
  } catch {
    /* best-effort; employee live deals remain intact */
  }

  // Mark roster not ready so manager "Submit Ready Sheets" count drops.
  const roster = await supabase.from(USER_PROFILES_TABLE).update({ roster_ready: false }).eq("id", input.employeeId);
  if (roster.error && !isMissingColumn(roster.error.message, roster.error.code) && !isMissingRelation(roster.error.message, roster.error.code)) {
    console.error("roster_ready clear failed:", roster.error.message);
  }

  // Clear unread push notifications for this employee so PUSHED NUMBERS REVIEW disappears.
  const { error: noteError } = await supabase
    .from(USER_NOTIFICATIONS_TABLE)
    .update({ is_read: true })
    .eq("user_id", input.employeeId)
    .eq("is_read", false);
  if (noteError && !isMissingRelation(noteError.message, noteError.code) && !isMissingTable(noteError.message, noteError.code)) {
    console.error("user_notifications clear failed:", noteError.message);
  }

  try {
    const { clearPushReviewSession } = await import("./push-review.ts");
    clearPushReviewSession(input.employeeId, input.periodKey);
  } catch {
    /* ignore */
  }
}

/**
 * Delete the admin ledger row and cascade-clear manager/rep push workflow state
 * for this employee + period. Does not delete the salesperson's personal workbook
 * or live deal lines.
 */
export async function cascadeDeleteAdminPush(input: {
  employeeId: string;
  periodKey: string;
}): Promise<string | null> {
  const deleteError = await deleteAdminEmployeeSheet(input);
  if (deleteError && deleteError !== ADMIN_LEDGER_UNAVAILABLE) return deleteError;
  // deleteAdminEmployeeSheet already runs cleanupAdminPeriodSnapshots
  return deleteError === ADMIN_LEDGER_UNAVAILABLE ? null : deleteError;
}

/**
 * Admin-only: permanently delete the admin ledger row for one employee + period_key.
 * Cascades push/review cleanup. Does not delete the employee's personal workbook.
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

  const error = await cascadeDeleteAdminPush({ employeeId, periodKey });
  if (!error) {
    console.log("[Delete Sheet] Removed admin_employee_sheets row + cascade", { employeeId, periodKey });
  }
  return error;
}
