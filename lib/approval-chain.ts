import { formatMoney } from "./format.ts";
import { trackerStateFromPayTrackerDocument } from "./pay-tracker-state.ts";
import { summarizeAll } from "./summaries.ts";
import type { ExtraPay, PaySheet, Sale, TrackerState } from "./types.ts";
import { explicitBonuses } from "./worksheet-persist.ts";

export const ADMIN_PUSHED = "admin_pushed";
export const REP_ACCEPTED_NO_CHANGES = "rep_accepted_no_changes";
export const REP_MODIFIED = "rep_modified";
export const MANAGER_APPROVED = "manager_approved";

export type ApprovalChainStatus =
  | typeof ADMIN_PUSHED
  | typeof REP_ACCEPTED_NO_CHANGES
  | typeof REP_MODIFIED
  | typeof MANAGER_APPROVED;

export type ApprovalDiffLine = {
  kind: "sale" | "bonus" | "vacation" | "total";
  summary: string;
};

export type ApprovalChainRecord = {
  employeeId: string;
  status: string;
  monthId: string | null;
  adminBaseline: TrackerState | null;
  repDraft: TrackerState | null;
  diffs: ApprovalDiffLine[];
  payDelta: number;
  finalizedLabel: string | null;
  denyReason?: string | null;
};

export const APPROVED_FINALIZED_LABEL = "Approved / Finalized";
export const APPROVED_FINALIZED_UPDATED_LABEL = "Approved / Finalized (Updated)";
export const ACCEPT_NO_CHANGES_LABEL = "Accept";
export const SUBMIT_CHANGES_TO_MANAGER_LABEL = "Submit Changes to Manager";
export const SUBMITTED_TO_MANAGER_LABEL = "Submitted to Manager ✓";
export const SUBMITTED_TO_MANAGER_BANNER = "Submitted to Manager for review";
export const EMPTY_TRACKER: TrackerState = { months: [], vehicleTypes: [] };
export const PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL = "Push Sheet to Employee & Manager";
export const DELETE_RESET_PUSH_LABEL = "Delete / Reset Push";
export const APPROVE_PUSH_TO_ADMIN_LABEL = "Approve Changes & Submit to Admin";
export const DENY_CHANGES_LABEL = "Deny Changes";
export const PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL = "Pending Employee & Manager Approval";
export const PENDING_EMPLOYEE_ACCEPTANCE_LABEL = "Pending Employee Acceptance";
export const EMPLOYEE_ACCEPTED_NO_CHANGES_LABEL = "Employee Accepted (No Changes)";
export const SUBMITTED_TO_PAYROLL_ADMIN_LABEL = "Submitted to Payroll/Admin";
export const MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL = "Manager Approved — Ready for Payroll";
export const AWAITING_REP_ACTION_LABEL = PENDING_EMPLOYEE_ACCEPTANCE_LABEL;
export const ACCEPTED_NO_CHANGES_LABEL = EMPLOYEE_ACCEPTED_NO_CHANGES_LABEL;

export type ApprovalRosterViewer = "admin" | "manager";

export function isAdminPushedStatus(status: string | null | undefined): boolean {
  return (
    status === ADMIN_PUSHED ||
    status === "awaiting_review" ||
    status === "pending_rep_review" ||
    status === "pushed"
  );
}

export function isRepAcceptedNoChanges(status: string | null | undefined): boolean {
  return status === REP_ACCEPTED_NO_CHANGES;
}

export function isRepModifiedStatus(status: string | null | undefined): boolean {
  return status === REP_MODIFIED || status === "pending_manager_approval";
}

export function isManagerApprovedStatus(status: string | null | undefined): boolean {
  return status === MANAGER_APPROVED || status === "pending_admin_approval";
}

export function isAwaitingRepAction(status: string | null | undefined): boolean {
  return isAdminPushedStatus(status);
}

export function isAwaitingManagerAudit(status: string | null | undefined): boolean {
  return isRepAcceptedNoChanges(status) || status === REP_MODIFIED;
}

export function normalizeApprovalStatus(status: string | null | undefined): ApprovalChainStatus | null {
  if (status === ADMIN_PUSHED) return ADMIN_PUSHED;
  if (status === REP_ACCEPTED_NO_CHANGES) return REP_ACCEPTED_NO_CHANGES;
  if (status === REP_MODIFIED) return REP_MODIFIED;
  if (status === MANAGER_APPROVED) return MANAGER_APPROVED;
  if (status === "pending_manager_approval") return REP_MODIFIED;
  if (status === "pending_admin_approval") return MANAGER_APPROVED;
  if (isAdminPushedStatus(status)) return ADMIN_PUSHED;
  return null;
}

export function approvalPayDelta(adminPay: number, repPay: number): number {
  return Math.round(((repPay || 0) - (adminPay || 0)) * 100) / 100;
}

export function formatSignedMoney(delta: number): string {
  const amount = formatMoney(Math.abs(delta || 0));
  if (delta > 0) return `+${amount}`;
  if (delta < 0) return `-${amount}`;
  return amount;
}

export type ReviewDeltaTone = "positive" | "negative" | "neutral";

export function reviewDeltaDisplay(adminPay: number, workingPay: number): {
  adminPay: number;
  workingPay: number;
  delta: number;
  label: string;
  tone: ReviewDeltaTone;
} {
  const delta = approvalPayDelta(adminPay, workingPay);
  const tone: ReviewDeltaTone = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
  return { adminPay, workingPay, delta, label: formatSignedMoney(delta), tone };
}

export function modifiedByRepBadgeLabel(delta: number): string {
  return employeeSubmittedChangesLabel(delta);
}

export function employeeSubmittedChangesLabel(delta: number): string {
  return `Employee Submitted Changes (${formatSignedMoney(delta)} difference)`;
}

export function finalizedLabelForStatus(status: string | null | undefined): string {
  if (status === REP_MODIFIED || status === MANAGER_APPROVED) return APPROVED_FINALIZED_UPDATED_LABEL;
  return APPROVED_FINALIZED_LABEL;
}

export function shouldOverwriteAdminMaster(_status?: string | null): boolean {
  return true;
}

export function adminMasterAfterManagerApproval(input: {
  status: string | null | undefined;
  adminBaseline: TrackerState;
  repDraft: TrackerState | null;
}): { state: TrackerState; finalizedLabel: string; overwritten: boolean } {
  const employeeSheet = input.repDraft ?? input.adminBaseline;
  return {
    state: employeeSheet,
    finalizedLabel: MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL,
    overwritten: true,
  };
}

function saleKey(sale: Sale): string {
  const stock = sale.stockNumber.trim().toLowerCase();
  if (stock) return `stock:${stock}`;
  const customer = sale.customerName.trim().toLowerCase();
  if (customer) return `customer:${customer}`;
  return `id:${sale.id}`;
}

function bonusKey(bonus: ExtraPay): string {
  const label = bonus.label.trim().toLowerCase();
  return label ? `label:${label}` : `id:${bonus.id}`;
}

function sheetsFromState(state: TrackerState | null | undefined): PaySheet[] {
  return (state?.months ?? []).flatMap((month) => month.sheets ?? []);
}

function salesFromState(state: TrackerState | null | undefined): Sale[] {
  return sheetsFromState(state).flatMap((sheet) => sheet.sales ?? []);
}

function bonusesFromState(state: TrackerState | null | undefined): ExtraPay[] {
  return sheetsFromState(state).flatMap((sheet) => explicitBonuses(sheet.bonuses));
}

export function itemizedApprovalDiffs(admin: TrackerState, rep: TrackerState): ApprovalDiffLine[] {
  const lines: ApprovalDiffLine[] = [];
  const adminSales = new Map(salesFromState(admin).map((sale) => [saleKey(sale), sale]));
  const repSales = new Map(salesFromState(rep).map((sale) => [saleKey(sale), sale]));
  const seenSales = new Set<string>();

  for (const [key, after] of repSales) {
    seenSales.add(key);
    const before = adminSales.get(key);
    if (!before) {
      lines.push({
        kind: "sale",
        summary: `Added sale Stock #${after.stockNumber || "—"} ${after.customerName || ""}`.trim() +
          ` ${formatMoney(after.gross)}`,
      });
      continue;
    }
    if (before.gross !== after.gross) {
      lines.push({
        kind: "sale",
        summary: `Stock #${after.stockNumber || before.stockNumber || "—"} Gross changed from ${formatMoney(before.gross)} to ${formatMoney(after.gross)}`,
      });
    }
    if (before.flat !== after.flat) {
      lines.push({
        kind: "sale",
        summary: `Stock #${after.stockNumber || before.stockNumber || "—"} Flat changed from ${formatMoney(before.flat)} to ${formatMoney(after.flat)}`,
      });
    }
    if (before.fi !== after.fi) {
      lines.push({
        kind: "sale",
        summary: `Stock #${after.stockNumber || before.stockNumber || "—"} F&I changed from ${formatMoney(before.fi)} to ${formatMoney(after.fi)}`,
      });
    }
    if (before.service !== after.service) {
      lines.push({
        kind: "sale",
        summary: `Stock #${after.stockNumber || before.stockNumber || "—"} Service changed from ${formatMoney(before.service)} to ${formatMoney(after.service)}`,
      });
    }
    if (before.customerName.trim() !== after.customerName.trim() && after.customerName.trim()) {
      lines.push({
        kind: "sale",
        summary: `Stock #${after.stockNumber || before.stockNumber || "—"} Customer changed from ${before.customerName || "—"} to ${after.customerName}`,
      });
    }
  }
  for (const [key, before] of adminSales) {
    if (seenSales.has(key)) continue;
    lines.push({
      kind: "sale",
      summary: `Removed sale Stock #${before.stockNumber || "—"} ${before.customerName || ""}`.trim() +
        ` ${formatMoney(before.gross)}`,
    });
  }

  const adminBonuses = new Map(bonusesFromState(admin).map((bonus) => [bonusKey(bonus), bonus]));
  const repBonuses = new Map(bonusesFromState(rep).map((bonus) => [bonusKey(bonus), bonus]));
  const seenBonuses = new Set<string>();
  for (const [key, after] of repBonuses) {
    seenBonuses.add(key);
    const before = adminBonuses.get(key);
    if (!before) {
      lines.push({
        kind: "bonus",
        summary: `Added ${after.label || "Bonus"} ${formatSignedMoney(after.amount)}`,
      });
      continue;
    }
    if (before.amount !== after.amount) {
      lines.push({
        kind: "bonus",
        summary: `${after.label || before.label || "Bonus"} changed from ${formatMoney(before.amount)} to ${formatMoney(after.amount)}`,
      });
    }
  }
  for (const [key, before] of adminBonuses) {
    if (seenBonuses.has(key)) continue;
    const label = before.label || "Bonus";
    lines.push({
      kind: "bonus",
      summary: `Removed ${/bonus/i.test(label) ? label : `${label} Bonus`} ${formatSignedMoney(-(before.amount || 0))}`,
    });
  }

  const adminVacation = summarizeAll(admin).vacation;
  const repVacation = summarizeAll(rep).vacation;
  if (adminVacation !== repVacation) {
    lines.push({
      kind: "vacation",
      summary: `Vacation pay changed from ${formatMoney(adminVacation)} to ${formatMoney(repVacation)}`,
    });
  }

  const delta = approvalPayDelta(summarizeAll(admin).pay, summarizeAll(rep).pay);
  if (delta !== 0 || lines.length > 0) {
    lines.push({
      kind: "total",
      summary: `Total pay delta ${formatSignedMoney(delta)}`,
    });
  }
  return lines;
}

export function buildRepSubmission(input: {
  adminBaseline: TrackerState;
  repDraft: TrackerState;
}): {
  status: typeof REP_MODIFIED | typeof REP_ACCEPTED_NO_CHANGES;
  diffs: ApprovalDiffLine[];
  payDelta: number;
} {
  const diffs = itemizedApprovalDiffs(input.adminBaseline, input.repDraft);
  const payDelta = approvalPayDelta(summarizeAll(input.adminBaseline).pay, summarizeAll(input.repDraft).pay);
  const changed = diffs.some((line) => line.kind !== "total") || payDelta !== 0;
  return {
    status: changed ? REP_MODIFIED : REP_ACCEPTED_NO_CHANGES,
    diffs: changed ? diffs : [],
    payDelta,
  };
}

export function buildForcedRepModification(input: {
  adminBaseline: TrackerState | null | undefined;
  repDraft: TrackerState;
}): {
  status: typeof REP_MODIFIED;
  diffs: ApprovalDiffLine[];
  payDelta: number;
} {
  const baseline = input.adminBaseline ?? EMPTY_TRACKER;
  const submit = buildRepSubmission({ adminBaseline: baseline, repDraft: input.repDraft });
  const pay = summarizeAll(input.repDraft).pay;
  const diffs =
    submit.diffs.length > 0
      ? submit.diffs
      : [{ kind: "total" as const, summary: `Current sheet submitted. Total pay ${formatSignedMoney(pay)}` }];
  return {
    status: REP_MODIFIED,
    diffs,
    payDelta: submit.payDelta,
  };
}

export function trackerFromUnknown(value: unknown): TrackerState | null {
  return trackerStateFromPayTrackerDocument(value);
}

export function chainFromPayTrackerRow(row: {
  employee_id?: string | null;
  user_id?: string | null;
  id: string;
  status: string;
  month_id?: string | null;
  state?: unknown;
  admin_pushed_snapshot?: unknown;
  rep_draft?: unknown;
  approval_diffs?: unknown;
  pay_delta?: unknown;
  finalized_label?: unknown;
  deny_reason?: unknown;
}): ApprovalChainRecord {
  const diffs = Array.isArray(row.approval_diffs)
    ? row.approval_diffs
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const rec = item as Record<string, unknown>;
          const summary = typeof rec.summary === "string" ? rec.summary : "";
          const kind = rec.kind;
          if (!summary) return null;
          if (kind !== "sale" && kind !== "bonus" && kind !== "vacation" && kind !== "total") return null;
          return { kind, summary } satisfies ApprovalDiffLine;
        })
        .filter((item): item is ApprovalDiffLine => Boolean(item))
    : [];
  const payDelta = typeof row.pay_delta === "number" && Number.isFinite(row.pay_delta) ? row.pay_delta : 0;
  return {
    employeeId: row.employee_id || row.user_id || row.id,
    status: row.status,
    monthId: row.month_id ?? null,
    adminBaseline: trackerFromUnknown(row.admin_pushed_snapshot) ?? trackerFromUnknown(row.state),
    repDraft: trackerFromUnknown(row.rep_draft),
    diffs,
    payDelta,
    finalizedLabel: typeof row.finalized_label === "string" ? row.finalized_label : null,
    denyReason: typeof row.deny_reason === "string" && row.deny_reason.trim() ? row.deny_reason.trim() : null,
  };
}

export type RosterApprovalTone = "idle" | "awaiting" | "accepted" | "modified" | "finalized" | "ready";

export function rosterToneFromChain(status: string | null | undefined): RosterApprovalTone | null {
  const normalized = normalizeApprovalStatus(status);
  if (normalized === ADMIN_PUSHED) return "awaiting";
  if (normalized === REP_ACCEPTED_NO_CHANGES) return "accepted";
  if (normalized === REP_MODIFIED) return "modified";
  if (normalized === MANAGER_APPROVED) return "finalized";
  return null;
}

export function rosterApprovalLabel(
  tone: RosterApprovalTone,
  payDelta = 0,
  finalizedLabel?: string | null,
  viewer?: ApprovalRosterViewer,
): string {
  if (tone === "awaiting") {
    return viewer === "admin" ? PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL : PENDING_EMPLOYEE_ACCEPTANCE_LABEL;
  }
  if (tone === "accepted") {
    return viewer === "admin" ? PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL : EMPLOYEE_ACCEPTED_NO_CHANGES_LABEL;
  }
  if (tone === "modified") {
    return viewer === "admin" ? PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL : employeeSubmittedChangesLabel(payDelta);
  }
  if (tone === "finalized") {
    return viewer === "admin"
      ? MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL
      : SUBMITTED_TO_PAYROLL_ADMIN_LABEL;
  }
  if (tone === "ready") return viewer === "admin" ? PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL : "Ready / Submitted";
  return "Not submitted";
}

export function isResettablePushStatus(status: string | null | undefined): boolean {
  return Boolean(
    isAdminPushedStatus(status) ||
      isRepAcceptedNoChanges(status) ||
      isRepModifiedStatus(status) ||
      isManagerApprovedStatus(status),
  );
}
