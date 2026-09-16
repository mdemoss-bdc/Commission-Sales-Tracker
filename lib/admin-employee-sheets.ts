import { getCachedProfile, isMissingColumn, isMissingFunction, isMissingRelation, isMissingTable, listProfiles, missingColumnName } from "./org.ts";
import { buildPayTrackerDocument, trackerStateFromPayTrackerDocument } from "./pay-tracker-state.ts";
import { canManageOrg, type UserRole } from "./roles.ts";
import { hasTrackerData, parseTrackerState } from "./storage.ts";
import { getSupabase } from "./supabase.ts";
import { ADMIN_EMPLOYEE_SHEET_SELECT, ADMIN_EMPLOYEE_SHEETS_TABLE } from "./supabase-schema.ts";
import type { TrackerState } from "./types.ts";

type OverlayView = "live" | "overlay" | "staged";

export const ADMIN_SHEET_DRAFT = "draft";
export const ADMIN_SHEET_PUSHED = "pushed";
export const ADMIN_SHEET_APPROVED_FINAL = "approved_final";
export const ADMIN_LEDGER_UNAVAILABLE = "missing-admin-employee-sheets";

export type AdminSheetStatus =
  | typeof ADMIN_SHEET_DRAFT
  | typeof ADMIN_SHEET_PUSHED
  | typeof ADMIN_SHEET_APPROVED_FINAL;

export type AdminEmployeeSheet = {
  employeeId: string;
  orgId: string | null;
  locationId: string | null;
  monthId: string | null;
  sheetData: unknown;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
  if (current === ADMIN_SHEET_PUSHED) return ADMIN_SHEET_PUSHED;
  return ADMIN_SHEET_DRAFT;
}

export function isApprovedFinalAdminSheet(status: string | null | undefined): boolean {
  return status === ADMIN_SHEET_APPROVED_FINAL;
}

export function shouldPersistOverlayToAdminLedger(input: {
  view: OverlayView;
  actorRole?: UserRole | null;
  targetRepId?: string | null;
}): boolean {
  return input.view === "overlay" && Boolean(input.targetRepId) && canManageOrg(input.actorRole);
}

export function isAdminLedgerUnavailable(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message === ADMIN_LEDGER_UNAVAILABLE ||
    isMissingTable(message) ||
    isMissingFunction(message) ||
    message.includes("admin_employee_sheets") ||
    message.includes("upsert_admin_employee_sheet")
  );
}

export function parseAdminSheetData(value: unknown): TrackerState | null {
  const fromDocument = trackerStateFromPayTrackerDocument(value);
  if (fromDocument && hasTrackerData(fromDocument)) return fromDocument;
  return parseTrackerState(value);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseAdminEmployeeSheet(raw: unknown): AdminEmployeeSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const employeeId = asText(row.employee_id);
  if (!employeeId) return null;
  const sheetData = row.sheet_data ?? {};
  return {
    employeeId,
    orgId: asText(row.org_id),
    locationId: asText(row.location_id),
    monthId: asText(row.month_id),
    sheetData,
    status: asText(row.status) ?? ADMIN_SHEET_DRAFT,
    createdBy: asText(row.created_by),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
    state: parseAdminSheetData(sheetData),
  };
}

export async function loadAdminEmployeeSheet(employeeId: string): Promise<AdminSheetLoad> {
  const supabase = getSupabase();
  if (!supabase) return { status: "missing" };
  const { data, error } = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .select(ADMIN_EMPLOYEE_SHEET_SELECT)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error.message, error.code) || isMissingRelation(error.message, error.code)) {
      return { status: "missing" };
    }
    console.error("admin_employee_sheets select failed:", error.message);
    return { status: "error", message: error.message };
  }
  return { status: "ready", row: parseAdminEmployeeSheet(data) };
}

async function currentActorId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? getCachedProfile()?.id ?? null;
}

export async function upsertAdminEmployeeSheet(input: {
  employeeId: string;
  state: TrackerState;
  locationId?: string | null;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const actor = await currentActorId();
  if (!actor) return "Not signed in.";
  const document = JSON.parse(JSON.stringify(buildPayTrackerDocument(input.state, input.employeeId))) as ReturnType<
    typeof buildPayTrackerDocument
  >;
  const rpc = await supabase.rpc("upsert_admin_employee_sheet", {
    target_employee: input.employeeId,
    payload: document,
    p_month_id: document.month_id,
    p_location_id: input.locationId || null,
  });
  if (!rpc.error) return null;
  if (isMissingRelation(rpc.error.message, rpc.error.code)) return ADMIN_LEDGER_UNAVAILABLE;
  console.error("upsert_admin_employee_sheet failed:", rpc.error.message);

  const profile = getCachedProfile();
  const people = await listProfiles();
  const employee = people.find((person) => person.id === input.employeeId);
  const row = {
    employee_id: input.employeeId,
    org_id: employee?.org_id ?? profile?.org_id ?? null,
    location_id: input.locationId || employee?.location_id || null,
    month_id: document.month_id,
    sheet_data: document,
    status: ADMIN_SHEET_DRAFT,
    created_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(row, { onConflict: "employee_id" });
  if (!error) return null;
  if (isMissingColumn(error.message, error.code)) {
    const stripped = { ...row } as Record<string, unknown>;
    const column = missingColumnName(error.message);
    if (column && column in stripped) delete stripped[column];
    const retry = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(stripped, { onConflict: "employee_id" });
    if (!retry.error) return null;
  }
  if (isMissingRelation(error.message, error.code)) return ADMIN_LEDGER_UNAVAILABLE;
  console.error("admin_employee_sheets upsert failed:", error.message);
  return error.message;
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
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const document = JSON.parse(JSON.stringify(buildPayTrackerDocument(input.state, input.employeeId))) as ReturnType<
    typeof buildPayTrackerDocument
  >;
  const rpc = await supabase.rpc("apply_manager_approval_to_admin_sheet", {
    target_employee: input.employeeId,
    payload: document,
  });
  if (!rpc.error) return null;
  if (isMissingRelation(rpc.error.message, rpc.error.code)) {
    const { error } = await supabase.from(ADMIN_EMPLOYEE_SHEETS_TABLE).upsert(
      {
        employee_id: input.employeeId,
        sheet_data: document,
        status: ADMIN_SHEET_APPROVED_FINAL,
        month_id: document.month_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id" },
    );
    if (!error || isMissingRelation(error.message, error.code)) return null;
    console.error("admin_employee_sheets approval overwrite failed:", error.message);
    return error.message;
  }
  console.error("apply_manager_approval_to_admin_sheet failed:", rpc.error.message);
  return rpc.error.message;
}

export async function recallAdminEmployeeSheetStatus(employeeId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const { error } = await supabase
    .from(ADMIN_EMPLOYEE_SHEETS_TABLE)
    .update({ status: ADMIN_SHEET_DRAFT, updated_at: new Date().toISOString() })
    .eq("employee_id", employeeId);
  if (!error || isMissingRelation(error.message, error.code)) return null;
  console.error("admin_employee_sheets recall failed:", error.message);
  return error.message;
}
