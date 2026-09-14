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

export function vehicleLabel(
  types: VehicleTypeOption[] | null | undefined,
  id: string,
): string {
  if (!id) return "";
  const match = (Array.isArray(types) ? types : []).find((type) => type.id === id);
  return match?.label ?? LEGACY_LABELS[id] ?? id;
}

export function optionsForSelect(
  types: VehicleTypeOption[] | null | undefined,
  selected: string,
): VehicleTypeOption[] {
  const list = Array.isArray(types) ? types : [];
  if (!selected || list.some((type) => type.id === selected)) return list;
  return [...list, { id: selected, label: vehicleLabel(list, selected) }];
}
