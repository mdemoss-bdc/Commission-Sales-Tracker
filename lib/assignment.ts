import { UNASSIGNED_STORE_FILTER } from "./locations.ts";
import type { UserProfile, UserRole } from "./roles.ts";

export function assignmentUpdatedMessage(name: string): string {
  return `Updated assignment for ${name}.`;
}

export function locationUpdatedMessage(name: string): string {
  return `Updated location for ${name}.`;
}

export function activeStoreChangedMessage(storeName: string): string {
  return `Active store changed to ${storeName}.`;
}

export function resolvedAssignmentLocation(input: {
  currentLocationId: string | null;
  nextLocationId?: string | null;
  storeFilterId?: string | null;
  nextRole: UserRole;
}): { locationId: string | null; error: string | null } {
  const fromPatch = input.nextLocationId !== undefined ? input.nextLocationId : input.currentLocationId;
  let locationId = fromPatch;
  const filter = input.storeFilterId?.trim() || null;
  if (
    !locationId &&
    input.nextRole === "manager" &&
    filter &&
    filter !== UNASSIGNED_STORE_FILTER
  ) {
    locationId = filter;
  }
  if (input.nextRole === "manager" && !locationId) {
    return { locationId: null, error: "Select a location when assigning a Manager." };
  }
  return { locationId, error: null };
}

export function rooftopIdForDeal(
  row: { rep_id: string; location_id: string | null },
  people: Array<Pick<UserProfile, "id" | "location_id">>,
): string | null {
  const rep = people.find((person) => person.id === row.rep_id);
  return rep?.location_id ?? row.location_id;
}

export function locationIdForRepSave(input: {
  existingDealLocation: string | null | undefined;
  targetRepId: string;
  actorId: string;
  actorLocationId: string | null | undefined;
  targetRepLocationId: string | null | undefined;
}): string | null {
  if (input.targetRepLocationId) return input.targetRepLocationId;
  if (input.targetRepId === input.actorId) {
    return input.existingDealLocation ?? input.actorLocationId ?? null;
  }
  return input.existingDealLocation ?? null;
}
