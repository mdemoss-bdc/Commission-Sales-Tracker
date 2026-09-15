import { matchesLocationFilter } from "./locations.ts";
import { rooftopIdForDeal } from "./assignment.ts";
import { canManageOrg, type UserProfile } from "./roles.ts";
import { sortByFullName } from "./roster.ts";

export function visiblePeople(profile: UserProfile, people: UserProfile[]): UserProfile[] {
  if (canManageOrg(profile.role)) return people;
  if (profile.role === "manager") {
    if (!profile.location_id) return people.filter((person) => person.id === profile.id);
    return people.filter(
      (person) => person.id === profile.id || person.location_id === profile.location_id,
    );
  }
  return people.filter((person) => person.id === profile.id);
}

export function visibleDeals<T extends { rep_id: string; location_id: string | null }>(
  profile: UserProfile,
  rows: T[],
  people: Array<Pick<UserProfile, "id" | "location_id">> = [],
): T[] {
  if (canManageOrg(profile.role)) return rows;
  if (profile.role === "manager") {
    if (!profile.location_id) return [];
    return rows.filter((row) => rooftopIdForDeal(row, people) === profile.location_id);
  }
  return rows.filter((row) => row.rep_id === profile.id);
}

export function viewLocationFilterId(
  profile: UserProfile | null | undefined,
  locationFilterId: string | null,
): string | null {
  if (profile?.role === "manager") return profile.location_id;
  return locationFilterId;
}

export function peopleForView(
  profile: UserProfile | null,
  people: UserProfile[],
  locationFilterId: string | null,
): UserProfile[] {
  if (canManageOrg(profile?.role) && !locationFilterId) return [];
  const filterId = viewLocationFilterId(profile, locationFilterId);
  if (profile?.role === "manager" && !filterId) {
    return people.filter((person) => person.id === profile.id);
  }
  return people.filter((person) => matchesLocationFilter(person.location_id, filterId));
}

export function dealsForView<T extends { rep_id: string; location_id: string | null }>(
  profile: UserProfile | null,
  rows: T[],
  people: Array<Pick<UserProfile, "id" | "location_id">>,
  locationFilterId: string | null,
): T[] {
  const filterId = viewLocationFilterId(profile, locationFilterId);
  if (profile?.role === "manager" && !filterId) return [];
  return rows.filter((row) => matchesLocationFilter(rooftopIdForDeal(row, people), filterId));
}

export function entryRepsFor(
  profile: UserProfile | null,
  people: UserProfile[],
  locationFilterId: string | null = null,
): UserProfile[] {
  if (!profile) return [];
  return sortByFullName(
    people.filter((person) => {
      if (person.role !== "rep") return false;
      if (canManageOrg(profile.role) && !locationFilterId) return false;
      const filterId = viewLocationFilterId(profile, locationFilterId);
      if (profile.role === "manager" && !filterId) return false;
      if (!matchesLocationFilter(person.location_id, filterId)) return false;
      if (canManageOrg(profile.role)) return true;
      return profile.role === "manager";
    }),
  );
}
