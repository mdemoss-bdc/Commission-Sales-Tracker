import { UNASSIGNED_STORE_FILTER } from "./locations.ts";
import { displayName } from "./names.ts";
import type { DealRow } from "./deal-records.ts";
import type { UserProfile } from "./roles.ts";

export type RosterBadge = "ready" | "awaiting" | "idle";

export function sortByFullName<T extends { full_name?: string | null; email?: string | null }>(people: T[]): T[] {
  return [...people].sort((left, right) =>
    displayName(left).localeCompare(displayName(right), undefined, { sensitivity: "base" }),
  );
}

export function rosterStatus(rep: UserProfile, deals: Array<Pick<DealRow, "rep_id" | "status">>): RosterBadge {
  const rows = deals.filter((row) => row.rep_id === rep.id);
  if (rows.some((row) => row.status === "pending_rep_review")) return "awaiting";
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

export function allRepsReady(reps: UserProfile[], deals: Array<Pick<DealRow, "rep_id" | "status">>): boolean {
  return reps.length > 0 && reps.every((rep) => rosterStatus(rep, deals) === "ready");
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

export function rosterBadgeLabel(status: RosterBadge): string {
  if (status === "ready") return "Ready / Submitted";
  if (status === "awaiting") return "Awaiting Employee";
  return "Not submitted";
}
