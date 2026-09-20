/**
 * Manager Clearinghouse — admin baseline vs sales-rep submission.
 * States:
 *   A awaiting_rep — admin sent baseline; rep has not submitted
 *   B match — both present, 0 discrepancies
 *   C discrepancies — both present with diffs
 *   idle / authorized — nothing for manager to do
 */

import {
  AUTHORIZED_BY_MANAGER,
  EMPTY_TRACKER,
  SENT_TO_MANAGER,
  SUBMITTED_TO_MANAGER,
  approvalPayDelta,
  itemizedApprovalDiffs,
  isManagerApprovedStatus,
  type ApprovalChainRecord,
  type ApprovalDiffLine,
} from "./approval-chain.ts";
import {
  ADMIN_SHEET_SENT_TO_MANAGER,
  ADMIN_SHEET_PUSHED,
  isApprovedFinalAdminSheet,
  isPaidAdminSheet,
  type AdminEmployeeSheet,
} from "./admin-employee-sheets.ts";
import { summarizeAll } from "./summaries.ts";
import type { TrackerState } from "./types.ts";

export type ClearinghouseState = "idle" | "awaiting_rep" | "match" | "discrepancies" | "authorized";

export const AWAITING_SALES_REP_LABEL = "Awaiting Sales Rep";
export const AUTHORIZE_ADMIN_SKIP_REP_LABEL = "Authorize Admin Version (Skip Rep)";
export const ZERO_DISCREPANCIES_LABEL = "0 Discrepancies";
export const AUTHORIZE_SEND_TO_ADMIN_LABEL = "Authorize & Send to Admin";
export const ACCEPT_REP_CHANGES_LABEL = "Accept Rep Changes";
export const KEEP_ADMIN_NUMBERS_LABEL = "Keep Admin Numbers";
export const EDIT_AND_AUTHORIZE_LABEL = "Edit & Authorize";
export const SUBMIT_SHEET_TO_MANAGER_LABEL = "Submit Sheet to Manager";
export const PUSH_TO_MANAGER_LABEL = "Push to Manager";
export const PUSH_ALL_TO_MANAGER_LABEL = "Push All to Manager";
export const AUTHORIZED_BY_MANAGER_BANNER = "Pay sheet authorized by manager";

export type ClearinghouseRow = {
  employeeId: string;
  state: ClearinghouseState;
  discrepancyCount: number;
  payDelta: number;
  diffs: ApprovalDiffLine[];
  adminBaseline: TrackerState | null;
  repDraft: TrackerState | null;
  adminSheet: AdminEmployeeSheet | null;
  chain: ApprovalChainRecord | null;
};

function adminBaselineReady(sheet: AdminEmployeeSheet | null | undefined, chain: ApprovalChainRecord | null): boolean {
  if (sheet && isPaidAdminSheet(sheet.status, sheet.isPaid)) return false;
  if (sheet && isApprovedFinalAdminSheet(sheet.status)) return false;
  const status = (sheet?.status ?? "").toLowerCase();
  if (
    status === ADMIN_SHEET_SENT_TO_MANAGER ||
    status === ADMIN_SHEET_PUSHED ||
    status === "sent_to_manager" ||
    status === "pushed"
  ) {
    return true;
  }
  const chainStatus = (chain?.status ?? "").toLowerCase();
  if (chainStatus === SENT_TO_MANAGER || chainStatus === "admin_pushed" || chainStatus === "pushed") {
    return Boolean(chain?.adminBaseline);
  }
  return Boolean(chain?.adminBaseline && !isManagerApprovedStatus(chain.status));
}

function repHasSubmitted(chain: ApprovalChainRecord | null): boolean {
  if (!chain) return false;
  const status = (chain.status ?? "").toLowerCase();
  if (
    status === SUBMITTED_TO_MANAGER ||
    status === "rep_modified" ||
    status === "pending_manager_approval" ||
    status === "rep_authorized_no_changes" ||
    status === "rep_accepted_no_changes"
  ) {
    return Boolean(chain.repDraft) || status === "rep_modified" || status === SUBMITTED_TO_MANAGER;
  }
  return Boolean(chain.repDraft && (chain.diffs?.length > 0 || chain.payDelta !== 0));
}

export function clearinghouseDiscrepancyCount(
  admin: TrackerState | null | undefined,
  rep: TrackerState | null | undefined,
): { count: number; payDelta: number; diffs: ApprovalDiffLine[] } {
  const baseline = admin ?? EMPTY_TRACKER;
  const draft = rep ?? EMPTY_TRACKER;
  const diffs = itemizedApprovalDiffs(baseline, draft).filter((line) => line.kind !== "total");
  const payDelta = approvalPayDelta(summarizeAll(baseline).pay, summarizeAll(draft).pay);
  const count = diffs.length + (payDelta !== 0 ? 1 : 0);
  return { count, payDelta, diffs };
}

export function resolveClearinghouseRow(input: {
  employeeId: string;
  chain: ApprovalChainRecord | null;
  adminSheet: AdminEmployeeSheet | null;
}): ClearinghouseRow {
  const { employeeId, chain, adminSheet } = input;
  if (chain && (isManagerApprovedStatus(chain.status) || chain.status === AUTHORIZED_BY_MANAGER)) {
    return {
      employeeId,
      state: "authorized",
      discrepancyCount: 0,
      payDelta: 0,
      diffs: [],
      adminBaseline: chain.adminBaseline,
      repDraft: chain.repDraft,
      adminSheet,
      chain,
    };
  }
  if (adminSheet && isApprovedFinalAdminSheet(adminSheet.status)) {
    return {
      employeeId,
      state: "authorized",
      discrepancyCount: 0,
      payDelta: 0,
      diffs: [],
      adminBaseline: chain?.adminBaseline ?? adminSheet.state,
      repDraft: chain?.repDraft ?? null,
      adminSheet,
      chain,
    };
  }

  const baselineReady = adminBaselineReady(adminSheet, chain);
  if (!baselineReady) {
    return {
      employeeId,
      state: "idle",
      discrepancyCount: 0,
      payDelta: 0,
      diffs: [],
      adminBaseline: chain?.adminBaseline ?? null,
      repDraft: chain?.repDraft ?? null,
      adminSheet,
      chain,
    };
  }

  const adminBaseline = chain?.adminBaseline ?? adminSheet?.state ?? null;
  if (!repHasSubmitted(chain)) {
    return {
      employeeId,
      state: "awaiting_rep",
      discrepancyCount: 0,
      payDelta: 0,
      diffs: [],
      adminBaseline,
      repDraft: null,
      adminSheet,
      chain,
    };
  }

  const { count, payDelta, diffs } = clearinghouseDiscrepancyCount(adminBaseline, chain?.repDraft);
  return {
    employeeId,
    state: count === 0 ? "match" : "discrepancies",
    discrepancyCount: count,
    payDelta,
    diffs,
    adminBaseline,
    repDraft: chain?.repDraft ?? null,
    adminSheet,
    chain,
  };
}

export function clearinghouseBadgeLabel(row: ClearinghouseRow): string {
  if (row.state === "awaiting_rep") return AWAITING_SALES_REP_LABEL;
  if (row.state === "match") return ZERO_DISCREPANCIES_LABEL;
  if (row.state === "discrepancies") {
    return `${row.discrepancyCount} Discrepanc${row.discrepancyCount === 1 ? "y" : "ies"}`;
  }
  if (row.state === "authorized") return "Authorized";
  return "Not started";
}

export function clearinghouseTone(row: ClearinghouseRow): "idle" | "awaiting" | "accepted" | "modified" | "finalized" {
  if (row.state === "awaiting_rep") return "awaiting";
  if (row.state === "match") return "accepted";
  if (row.state === "discrepancies") return "modified";
  if (row.state === "authorized") return "finalized";
  return "idle";
}
