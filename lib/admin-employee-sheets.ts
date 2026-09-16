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
import { canManageOrg, type UserRole } from "./roles.ts";
import { parseTrackerState } from "./storage.ts";
import { getSupabase } from "./supabase.ts";
import { ADMIN_EMPLOYEE_SHEET_SELECT, ADMIN_EMPLOYEE_SHEET_SELECT_MIN, ADMIN_EMPLOYEE_SHEETS_TABLE } from "./supabase-schema.ts";
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
  return status === ADMIN_SHEET_PAID || isPaidFlag === true;
}

export function isApprovedFinalAdminSheet(status: string | null | undefined): boolean {
  return (
    status === ADMIN_SHEET_FINAL_APPROVED ||
    status === ADMIN_SHEET_APPROVED_FINAL ||
    status === "manager_approved"
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
  const isPaid = isPaidAdminSheet(status, asBoolean(row.is_paid));
  const monthId = asText(row.month_id);
  const periodKey = asText(row.period_key) ?? monthId;
  return {
    employeeId,
    orgId: asText(row.org_id),
    locationId: asText(row.location_id),
    monthId,
    periodKey,
    sheetData,
    status: isPaid ? ADMIN_SHEET_PAID : status,
    createdBy: asText(row.created_by),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
    paidAt: asText(row.paid_at),
    isPaid,
    state: parseAdminSheetData(sheetData),
  };
}

export async function loadAdminEmployeeSheet(employeeId: string): Promise<AdminSheetLoad> {
  const supabase = getSupabase();
  if (!supabase) return { status: "missing" };
  const first = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .select(ADMIN_EMPLOYEE_SHEET_SELECT)
    .eq("employee_id", employeeId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const result = first.error && isMissingColumn(first.error.message, first.error.code)
    ? await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .select(ADMIN_EMPLOYEE_SHEET_SELECT_MIN)
        .eq("employee_id", employeeId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : first;
  if (result.error) {
    if (isMissingTable(result.error.message, result.error.code) || isMissingRelation(result.error.message, result.error.code)) {
      return { status: "missing" };
    }
    console.error("admin_employee_sheets select failed:", result.error.message);
    return { status: "error", message: result.error.message };
  }
  return { status: "ready", row: parseAdminEmployeeSheet(result.data) };
}

export async function loadAdminEmployeeSheets(): Promise<AdminEmployeeSheet[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const first = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .select(ADMIN_EMPLOYEE_SHEET_SELECT)
    .order("updated_at", { ascending: false });
  const result = first.error && isMissingColumn(first.error.message, first.error.code)
    ? await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .select(ADMIN_EMPLOYEE_SHEET_SELECT_MIN)
        .order("updated_at", { ascending: false })
    : first;
  if (result.error) {
    if (isMissingTable(result.error.message, result.error.code) || isMissingRelation(result.error.message, result.error.code)) {
      return [];
    }
    console.error("admin_employee_sheets list failed:", result.error.message);
    return [];
  }
  return (result.data ?? []).map(parseAdminEmployeeSheet).filter((row): row is AdminEmployeeSheet => Boolean(row));
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
  const existing = await loadAdminEmployeeSheet(employeeId);
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

export async function markAdminEmployeeSheetPaid(employeeId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const paidAt = new Date().toISOString();
  const rpc = await supabase.rpc("mark_admin_employee_sheet_paid", { target_employee: employeeId });
  if (!rpc.error) return null;
  if (isMissingFunction(rpc.error.message, rpc.error.code) || isMissingRelation(rpc.error.message, rpc.error.code)) {
    const attempts: Array<Record<string, unknown>> = [
      { status: ADMIN_SHEET_PAID, is_paid: true, paid_at: paidAt, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, paid_at: paidAt, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, is_paid: true, updated_at: paidAt },
      { status: ADMIN_SHEET_PAID, updated_at: paidAt },
    ];
    let lastError: string | null = null;
    for (const payload of attempts) {
      const result = await supabase
        .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
        .update(payload)
        .eq("employee_id", employeeId)
        .select("employee_id");
      if (!result.error) {
        if ((result.data?.length ?? 0) === 0) {
          return "Sheet must be finalized before it can be marked paid.";
        }
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
