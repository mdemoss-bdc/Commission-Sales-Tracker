export function canSubmitSignup(fullName: string, locationId: string): boolean {
  return fullName.trim().length >= 2 && Boolean(locationId.trim());
}

export function metadataLocationId(meta: Record<string, unknown> | null | undefined): string | null {
  const value = meta?.location_id;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
