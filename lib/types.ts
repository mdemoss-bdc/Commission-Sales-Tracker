export const VEHICLE_TYPES = [
  { value: "honda", label: "Honda" },
  { value: "volkswagen", label: "Volkswagen" },
  { value: "used", label: "Used" },
] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number]["value"];

export type SheetTab = "deals" | "backend";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MAX_SHEETS_PER_MONTH = 2;

export interface ExtraPay {
  id: string;
  label: string;
  amount: number;
}

export interface Sale {
  id: string;
  stockNumber: string;
  customerName: string;
  vehicleType: VehicleType | "";
  tradeIn: boolean;
  gross: number;
  flat: number;
  fi: number;
  service: number;
  drive360: number;
  carCare: number;
  gap: number;
}

export interface PaySheet {
  id: string;
  name: string;
  sales: Sale[];
  vacationPay: number;
  bonuses: ExtraPay[];
}

export interface MonthRecord {
  id: string;
  year: number;
  month: number;
  sheets: PaySheet[];
}

export interface TrackerState {
  months: MonthRecord[];
}

export interface CommissionTier {
  min: number;
  max: number;
  rate: number;
  label: string;
}

export interface Totals {
  units: number;
  trades: number;
  gross: number;
  flat: number;
  fi: number;
  service: number;
  drive360: number;
  carCare: number;
  gap: number;
  bonus: number;
  vacation: number;
  pay: number;
}
