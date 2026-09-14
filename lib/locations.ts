export const UNASSIGNED_STORE_FILTER = "unassigned";

export function matchesLocationFilter(
  locationId: string | null | undefined,
  filterId: string | null,
): boolean {
  if (!filterId) return true;
  if (filterId === UNASSIGNED_STORE_FILTER) return !locationId;
  return locationId === filterId;
}

export function storeFilterSummary(
  count: number,
  filterId: string | null,
  storeName?: string | null,
  noun: { singular: string; plural: string } = { singular: "employee", plural: "employees" },
): string {
  const label = count === 1 ? noun.singular : noun.plural;
  if (!filterId) return `Showing ${count} ${label} across all stores`;
  if (filterId === UNASSIGNED_STORE_FILTER) return `Showing ${count} unassigned ${label}`;
  return `Showing ${count} ${label} at ${storeName || "this store"}`;
}

export function isStoredLocationFilter(filterId: string | null, locationIds: string[]): boolean {
  if (!filterId) return true;
  if (filterId === UNASSIGNED_STORE_FILTER) return true;
  return locationIds.includes(filterId);
}
