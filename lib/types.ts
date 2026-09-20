import type { DealType } from "./deal-types.ts";

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

export type VehicleTypeCategory = "NEW" | "USED" | "OTHER";

export const VEHICLE_TYPE_CATEGORIES: VehicleTypeCategory[] = ["NEW", "USED", "OTHER"];

export interface VehicleTypeOption {
  id: string;
  label: string;
  /** Volume bucket for New / Used KPI cards. OTHER never counts toward Total Units. */
  category?: VehicleTypeCategory;
  /** When true, deals of this type do not count toward unit volume (earnings still count). */
  excludeFromUnitCount?: boolean;
}

export interface Sale {
  id: string;
  stockNumber: string;
  customerName: string;
  vehicleType: string;
  dealType: DealType;
  tradeIn: boolean;
  gross: number;
  flat: number;
  fi: number;
  service: number;
  /** When true, this deal counts as 0.5 units (unless vehicle type excludes unit count). */
  splitDeal?: boolean;
  duplicateConfirmed?: boolean;
}

export interface PaySheet {
  id: string;
  startDay: number;
  endDay: number;
  sales: Sale[];
  /** Regular (non-vacation) hours worked — hourly pay mode when paired with hourlyRate > 0. */
  regularHours?: number;
  /** Regular hourly pay rate ($ / hr). */
  hourlyRate?: number;
  vacationHours: number;
  vacationRate: number;
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
  vehicleTypes: VehicleTypeOption[];
}

export interface CommissionTier {
  min: number;
  max: number;
  rate: number;
  label: string;
}

export interface Totals {
  units: number;
  /** Units from vehicle types categorized NEW (splits + exclude respected). */
  totalNewUnits: number;
  /** Units from vehicle types categorized USED (splits + exclude respected). */
  totalUsedUnits: number;
  trades: number;
  gross: number;
  flat: number;
  fi: number;
  service: number;
  bonus: number;
  vacation: number;
  /** Regular hourly pay (hours × rate) when hourly mode is active; otherwise 0. */
  regular: number;
  pay: number;
}
