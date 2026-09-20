import type { VehicleTypeCategory, VehicleTypeOption } from "./types.ts";
import { VEHICLE_TYPE_CATEGORIES } from "./types.ts";

export const LEGACY_VEHICLE_TYPES: VehicleTypeOption[] = [
  { id: "honda", label: "Honda", category: "NEW", excludeFromUnitCount: false },
  { id: "volkswagen", label: "Volkswagen", category: "NEW", excludeFromUnitCount: false },
  { id: "used", label: "Used", category: "USED", excludeFromUnitCount: false },
];

const LEGACY_LABELS: Record<string, string> = {
  honda: "Honda",
  volkswagen: "Volkswagen",
  used: "Used",
};

const OTHER_LABELS = new Set([
  "street purchase",
  "lease buyout",
  "lease_buyout",
  "leasebuyout",
  "buyout",
]);

/** Infer NEW / USED / OTHER from a type label when category is missing. */
export function defaultVehicleTypeCategory(label: string | null | undefined): VehicleTypeCategory {
  const key = (label ?? "").trim().toLowerCase().replace(/[\s-]+/g, " ");
  if (!key) return "NEW";
  if (key === "used") return "USED";
  if (OTHER_LABELS.has(key) || key.includes("street purchase") || key.includes("lease buyout")) {
    return "OTHER";
  }
  return "NEW";
}

export function parseVehicleTypeCategory(
  value: unknown,
  label?: string | null,
): VehicleTypeCategory {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if ((VEHICLE_TYPE_CATEGORIES as string[]).includes(normalized)) {
      return normalized as VehicleTypeCategory;
    }
    const lower = value.trim().toLowerCase();
    if (lower === "new") return "NEW";
    if (lower === "used") return "USED";
    if (lower === "other" || lower === "lease_buyout" || lower === "lease buyout") return "OTHER";
  }
  return defaultVehicleTypeCategory(label);
}

export function withVehicleTypeCategory(type: VehicleTypeOption): VehicleTypeOption {
  return {
    ...type,
    category: parseVehicleTypeCategory(type.category, type.label),
    excludeFromUnitCount: Boolean(type.excludeFromUnitCount),
  };
}

export function createVehicleType(label: string): VehicleTypeOption | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return {
    id: crypto.randomUUID(),
    label: trimmed,
    category: defaultVehicleTypeCategory(trimmed),
    excludeFromUnitCount: false,
  };
}

export function addVehicleType(
  types: VehicleTypeOption[] | null | undefined,
  label: string,
): VehicleTypeOption[] {
  const list = Array.isArray(types) ? types : [];
  const created = createVehicleType(label);
  if (!created) return list;
  if (list.some((type) => type.label.toLowerCase() === created.label.toLowerCase())) {
    return list;
  }
  return [...list, created];
}

export function renameVehicleType(
  types: VehicleTypeOption[] | null | undefined,
  id: string,
  label: string,
): VehicleTypeOption[] {
  const list = Array.isArray(types) ? types : [];
  return list.map((type) => (type.id === id ? { ...type, label } : type));
}

export function setVehicleTypeExcludeFromUnitCount(
  types: VehicleTypeOption[] | null | undefined,
  id: string,
  excludeFromUnitCount: boolean,
): VehicleTypeOption[] {
  const list = Array.isArray(types) ? types : [];
  return list.map((type) => (type.id === id ? { ...type, excludeFromUnitCount } : type));
}

export function setVehicleTypeCategory(
  types: VehicleTypeOption[] | null | undefined,
  id: string,
  category: VehicleTypeCategory,
): VehicleTypeOption[] {
  const list = Array.isArray(types) ? types : [];
  const next = parseVehicleTypeCategory(category);
  return list.map((type) => (type.id === id ? { ...type, category: next } : type));
}

export function removeVehicleType(
  types: VehicleTypeOption[] | null | undefined,
  id: string,
): VehicleTypeOption[] {
  return (Array.isArray(types) ? types : []).filter((type) => type.id !== id);
}

export const FALLBACK_VEHICLE_LABEL = "Standard";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return Boolean(value && UUID_PATTERN.test(value.trim()));
}

export function preferredVehicleTypeKey(id: string | null | undefined, named?: string | null): string {
  const label = named?.trim() ?? "";
  if (label && !isUuid(label)) return label;
  const key = id?.trim() ?? "";
  if (key && !isUuid(key)) return key;
  return key || label;
}

export function findVehicleType(
  types: VehicleTypeOption[] | null | undefined,
  vehicleTypeId: string | null | undefined,
): VehicleTypeOption | null {
  if (!vehicleTypeId?.trim()) return null;
  const list = Array.isArray(types) ? types : [];
  const key = vehicleTypeId.trim();
  const lowered = key.toLowerCase();
  return (
    list.find(
      (type) =>
        type.id === key ||
        type.id.toLowerCase() === lowered ||
        type.label.trim().toLowerCase() === lowered,
    ) ?? null
  );
}

export function resolveVehicleTypeCategory(
  types: VehicleTypeOption[] | null | undefined,
  vehicleTypeId: string | null | undefined,
): VehicleTypeCategory {
  const match = findVehicleType(types, vehicleTypeId);
  if (match) return parseVehicleTypeCategory(match.category, match.label);
  return defaultVehicleTypeCategory(vehicleTypeId);
}

export function vehicleLabel(
  types: VehicleTypeOption[] | null | undefined,
  id: string | null | undefined,
  named?: string | null,
): string {
  const explicit = named?.trim() ?? "";
  if (explicit && !isUuid(explicit)) return explicit;
  const key = preferredVehicleTypeKey(id, explicit);
  if (!key) return explicit;
  const list = Array.isArray(types) ? types : [];
  const byId = list.find((type) => type.id === key);
  if (byId?.label.trim()) return byId.label.trim();
  const lowered = key.toLowerCase();
  const byLabel = list.find((type) => type.label.trim().toLowerCase() === lowered);
  if (byLabel?.label.trim()) return byLabel.label.trim();
  const legacy = LEGACY_LABELS[lowered];
  if (legacy) return legacy;
  if (!isUuid(key)) return key;
  return explicit && !isUuid(explicit) ? explicit : FALLBACK_VEHICLE_LABEL;
}

export function optionsForSelect(
  types: VehicleTypeOption[] | null | undefined,
  selected: string,
): VehicleTypeOption[] {
  const list = (Array.isArray(types) ? types : []).map(withVehicleTypeCategory);
  if (!selected || list.some((type) => type.id === selected)) return list;
  return [
    ...list,
    withVehicleTypeCategory({
      id: selected,
      label: vehicleLabel(list, selected),
      category: defaultVehicleTypeCategory(vehicleLabel(list, selected)),
    }),
  ];
}

export function vehicleTypeCategoryLabel(category: VehicleTypeCategory): string {
  if (category === "USED") return "Used";
  if (category === "OTHER") return "Other";
  return "New";
}
