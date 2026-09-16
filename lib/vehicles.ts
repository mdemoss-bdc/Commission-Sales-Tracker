import type { VehicleTypeOption } from "./types.ts";

export const LEGACY_VEHICLE_TYPES: VehicleTypeOption[] = [
  { id: "honda", label: "Honda" },
  { id: "volkswagen", label: "Volkswagen" },
  { id: "used", label: "Used" },
];

const LEGACY_LABELS: Record<string, string> = {
  honda: "Honda",
  volkswagen: "Volkswagen",
  used: "Used",
};

export function createVehicleType(label: string): VehicleTypeOption | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  return {
    id: crypto.randomUUID(),
    label: trimmed,
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
  const list = Array.isArray(types) ? types : [];
  if (!selected || list.some((type) => type.id === selected)) return list;
  return [...list, { id: selected, label: vehicleLabel(list, selected) }];
}
