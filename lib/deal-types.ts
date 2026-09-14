export const DEAL_TYPES = ["new", "used", "lease_buyout"] as const;

export type DealType = (typeof DEAL_TYPES)[number];

export const DEFAULT_DEAL_TYPE: DealType = "new";

const LABELS: Record<DealType, string> = {
  new: "New",
  used: "Used",
  lease_buyout: "Lease Buyout",
};

export function dealTypeLabel(type: DealType | string | null | undefined): string {
  return LABELS[parseDealType(type)];
}

export function parseDealType(value: unknown): DealType {
  if (typeof value !== "string") return DEFAULT_DEAL_TYPE;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "used") return "used";
  if (normalized === "lease_buyout" || normalized === "leasebuyout" || normalized === "buyout") {
    return "lease_buyout";
  }
  if (normalized === "new") return DEFAULT_DEAL_TYPE;
  return DEFAULT_DEAL_TYPE;
}

export function isDealType(value: unknown): value is DealType {
  return value === "new" || value === "used" || value === "lease_buyout";
}
