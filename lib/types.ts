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

export interface VehicleTypeOption {
  id: string;
  label: string;
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
}

export interface PaySheet {
  id: string;
  startDay: number;
  endDay: number;
  sales: Sale[];
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
  trades: number;
  gross: number;
  flat: number;
  fi: number;
  service: number;
  bonus: number;
  vacation: number;
  pay: number;
}
