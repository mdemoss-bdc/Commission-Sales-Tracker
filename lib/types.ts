export const VEHICLE_TYPES = [
  { value: "new-honda", label: "New Honda" },
  { value: "volkswagen", label: "Volkswagen" },
  { value: "used", label: "Used" },
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number]["value"];

export type SheetTab = "deals" | "backend";

export interface Sale {
  id: string;
  stockNumber: string;
  customerName: string;
  vehicleType: VehicleType | "";
  gross: number;
  flat: number;
  fi: number;
  service: number;
  drive360: number;
  carCare: number;
  gap: number;
}

export interface TrackerState {
  sales: Sale[];
  periodLabel: string;
}

export interface CommissionTier {
  min: number;
  max: number;
  rate: number;
  label: string;
}
