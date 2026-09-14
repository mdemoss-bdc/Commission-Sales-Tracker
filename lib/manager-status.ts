import { displayName } from "./names.ts";
import { sortByFullName } from "./roster.ts";
import { isLiveRecordStatus, isPipelineRecordStatus, type LocationRecord, type UserProfile } from "./roles.ts";
import type { DealRow } from "./deal-records.ts";

export type ManagerStoreStatus = {
  locationId: string;
  storeName: string;
  managers: UserProfile[];
  managerLabel: string;
  repCount: number;
  pendingCount: number;
  finalizedCount: number;
  complete: boolean;
  pendingLabel: string;
};

export function isRepFinalized(
  rep: Pick<UserProfile, "id">,
  deals: Array<Pick<DealRow, "rep_id" | "status">>,
): boolean {
  const rows = deals.filter((row) => row.rep_id === rep.id);
  if (rows.some((row) => isPipelineRecordStatus(row.status))) return false;
  return rows.some((row) => isLiveRecordStatus(row.status));
}

export function managerSubmissionRows(
  locations: LocationRecord[],
  people: UserProfile[],
  deals: Array<Pick<DealRow, "rep_id" | "status" | "location_id">>,
): ManagerStoreStatus[] {
  return [...locations]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    .map((store) => {
      const managers = sortByFullName(
        people.filter((person) => person.role === "manager" && person.location_id === store.id),
      );
      const reps = sortByFullName(people.filter((person) => person.role === "rep" && person.location_id === store.id));
      const finalizedCount = reps.filter((rep) => isRepFinalized(rep, deals)).length;
      const pendingCount = reps.length - finalizedCount;
      const complete = reps.length > 0 && pendingCount === 0;
      const managerLabel =
        managers.length === 0
          ? "No manager assigned"
          : managers.map((person) => displayName(person)).join(", ");
      const pendingLabel =
        reps.length === 0
          ? "No sales reps assigned"
          : complete
            ? `All ${reps.length} rep${reps.length === 1 ? "" : "s"} submitted`
            : `${pendingCount} of ${reps.length} reps pending submission`;
      return {
        locationId: store.id,
        storeName: store.name,
        managers,
        managerLabel,
        repCount: reps.length,
        pendingCount,
        finalizedCount,
        complete,
        pendingLabel,
      };
    });
}
