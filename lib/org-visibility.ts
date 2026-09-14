import { matchesLocationFilter } from "./locations.ts";
import { canManageOrg } from "./roles.ts";
import type { UserProfile } from "./roles.ts";

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
): T[] {
  if (canManageOrg(profile.role)) return rows;
  if (profile.role === "manager") {
    if (!profile.location_id) return [];
    return rows.filter((row) => row.location_id === profile.location_id);
  }
  return rows.filter((row) => row.rep_id === profile.id);
}

export function entryRepsFor(
  profile: UserProfile | null,
  people: UserProfile[],
  locationFilterId: string | null = null,
): UserProfile[] {
  if (!profile) return [];
  return people.filter((person) => {
    if (person.role !== "rep") return false;
    if (!matchesLocationFilter(person.location_id, locationFilterId)) return false;
    if (canManageOrg(profile.role)) return true;
    return (
      profile.role === "manager" &&
      Boolean(profile.location_id) &&
      person.location_id === profile.location_id
    );
  });
}
