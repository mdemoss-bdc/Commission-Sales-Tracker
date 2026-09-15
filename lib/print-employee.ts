import { displayName } from "./names.ts";
import { roleLabel, type UserProfile } from "./roles.ts";

type PrintPerson = Pick<UserProfile, "full_name" | "email" | "role" | "location_id">;

export function printSheetEmployee(input: {
  entryRep?: PrintPerson | null;
  profile?: PrintPerson | null;
  session?: { fullName?: string | null; email?: string | null } | null;
  locations: Array<{ id: string; name: string }>;
}): { name: string; subtitle: string } | null {
  const person = input.entryRep ?? input.profile;
  const name = displayName({
    full_name: person?.full_name ?? input.session?.fullName ?? null,
    email: person?.email ?? input.session?.email ?? null,
  });
  if (!name || name === "Unknown") return null;

  const locationId = person?.location_id ?? null;
  const locationName = locationId
    ? input.locations.find((item) => item.id === locationId)?.name.trim() || null
    : null;
  const title =
    input.entryRep || !person?.role || person.role === "rep"
      ? "Sales Consultant"
      : roleLabel(person.role);

  return {
    name,
    subtitle: locationName ? `${title} • ${locationName}` : title,
  };
}
