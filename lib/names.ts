export function displayName(person: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const name = person.full_name?.trim() ?? "";
  const email = person.email?.trim() ?? "";
  if (name && name.toLowerCase() !== email.toLowerCase()) return name;
  return email || "Unknown";
}

export function hasDistinctEmail(person: {
  full_name?: string | null;
  email?: string | null;
}): boolean {
  const email = person.email?.trim() ?? "";
  if (!email) return false;
  return displayName(person).toLowerCase() !== email.toLowerCase();
}

export function personOptionLabel(
  person: { full_name?: string | null; email?: string | null },
  locationName?: string | null,
): string {
  const name = displayName(person);
  return locationName ? `${name} · ${locationName}` : name;
}

export function metadataFullName(meta: Record<string, unknown> | null | undefined): string | null {
  const value = meta?.full_name;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
