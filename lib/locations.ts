export function matchesLocationFilter(
  locationId: string | null | undefined,
  filterId: string | null,
): boolean {
  if (!filterId) return true;
  return locationId === filterId;
}

export function locationFilterLabel(name: string): string {
  return `${name} Only`;
}
