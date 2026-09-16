import { isPendingEmployeeReview } from "./rep-review.ts";
import { UNASSIGNED_STORE_FILTER } from "./locations.ts";
import { displayName } from "./names.ts";
import type { DealRow } from "./deal-records.ts";
import type { UserProfile } from "./roles.ts";
import {
  isResettablePushStatus,
  rosterApprovalLabel,
  rosterToneFromChain,
  type ApprovalChainRecord,
  type ApprovalRosterViewer,
  type RosterApprovalTone,
} from "./approval-chain.ts";

export type RosterBadge = "ready" | "awaiting" | "idle" | "accepted" | "modified" | "finalized";

export function sortByFullName<T extends { full_name?: string | null; email?: string | null }>(people: T[]): T[] {
  return [...people].sort((left, right) =>
    displayName(left).localeCompare(displayName(right), undefined, { sensitivity: "base" }),
  );
}

export function chainForRep(
  chains: ApprovalChainRecord[] | null | undefined,
  repId: string,
): ApprovalChainRecord | null {
  return (chains ?? []).find((row) => row.employeeId === repId) ?? null;
}

export function rosterStatus(
  rep: UserProfile,
  deals: Array<Pick<DealRow, "rep_id" | "status">>,
  chain?: ApprovalChainRecord | null,
): RosterBadge {
  const tone = rosterToneFromChain(chain?.status);
  if (tone === "awaiting" || tone === "accepted" || tone === "modified" || tone === "finalized") return tone;
  const rows = deals.filter((row) => row.rep_id === rep.id);
  if (rows.some((row) => isPendingEmployeeReview(row.status))) return "awaiting";
  if (rep.roster_ready) return "ready";
  if (
    rows.some(
      (row) =>
        row.status === "pending_manager_approval" ||
        row.status === "pending_admin_approval" ||
        row.status === "approved",
    )
  ) {
    return "ready";
  }
  if (
    rows.length > 0 &&
    rows.every((row) =>
      ["pending_manager_approval", "pending_admin_approval", "approved", "active"].includes(row.status),
    )
  ) {
    return "ready";
  }
  return "idle";
}

export function allRepsReady(
  reps: UserProfile[],
  deals: Array<Pick<DealRow, "rep_id" | "status">>,
  chains?: ApprovalChainRecord[] | null,
): boolean {
  return (
    reps.length > 0 &&
    reps.every((rep) => {
      const status = rosterStatus(rep, deals, chainForRep(chains, rep.id));
      return status === "ready" || status === "accepted" || status === "modified" || status === "finalized";
    })
  );
}

export function activeRosterLocationId(
  profile: UserProfile | null,
  locationFilterId: string | null,
): string | null {
  if (!profile) return null;
  if (profile.role === "manager") return profile.location_id;
  if (profile.role === "admin" && locationFilterId && locationFilterId !== UNASSIGNED_STORE_FILTER) {
    return locationFilterId;
  }
  return null;
}

export function rosterBadgeLabel(
  status: RosterBadge,
  chain?: ApprovalChainRecord | null,
  viewer?: ApprovalRosterViewer,
): string {
  const tone = status as RosterApprovalTone;
  if (status === "accepted" || status === "modified" || status === "finalized" || status === "awaiting") {
    return rosterApprovalLabel(tone, chain?.payDelta ?? 0, chain?.finalizedLabel, viewer);
  }
  if (status === "ready") return rosterApprovalLabel("ready", 0, null, viewer);
  return "Not submitted";
}

export function hasResettablePush(
  deals: Array<Pick<DealRow, "rep_id" | "status">>,
  chain: ApprovalChainRecord | null | undefined,
  repId: string,
): boolean {
  if (isResettablePushStatus(chain?.status)) return true;
  return deals.some((row) => row.rep_id === repId && isResettablePushStatus(row.status));
}
