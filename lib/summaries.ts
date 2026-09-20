import {

  countTrades,

  countUnitsByCategory,

  currentPayTiers,

  getCommissionRate,

  isCountedUnit,

  isHourlyPayMode,

  regularPayAmount,

  roundMoney,

  saleCommission,

  sheetVacationPay,

  sumField,

  unitContribution,

} from "./commission.ts";

import { type DealType } from "./deal-types.ts";

import { formatMoney } from "./format.ts";

import type {

  CommissionTier,

  MonthRecord,

  PaySheet,

  Sale,

  Totals,

  TrackerState,

  VehicleTypeOption,

} from "./types.ts";

import { resolveVehicleTypeCategory } from "./vehicles.ts";



export function emptyTotals(): Totals {

  return {

    units: 0,

    totalNewUnits: 0,

    totalUsedUnits: 0,

    trades: 0,

    gross: 0,

    flat: 0,

    fi: 0,

    service: 0,

    bonus: 0,

    vacation: 0,

    regular: 0,

    pay: 0,

  };

}



export function summarizeSales(

  sales: Sale[] | null | undefined,

  tiers: CommissionTier[] = currentPayTiers(),

  vehicleTypes?: VehicleTypeOption[] | null,

): Totals {

  const rows = Array.isArray(sales) ? sales : [];

  const totalNewUnits = countUnitsByCategory(rows, vehicleTypes, "NEW");

  const totalUsedUnits = countUnitsByCategory(rows, vehicleTypes, "USED");

  const units = roundMoney(totalNewUnits + totalUsedUnits);

  const rate = getCommissionRate(units, tiers);

  return {

    units,

    totalNewUnits,

    totalUsedUnits,

    trades: countTrades(rows, vehicleTypes),

    gross: sumField(rows, "gross"),

    flat: sumField(rows, "flat"),

    fi: sumField(rows, "fi"),

    service: sumField(rows, "service"),

    bonus: 0,

    vacation: 0,

    regular: 0,

    pay: roundMoney(rows.reduce((sum, sale) => sum + saleCommission(sale, rate), 0)),

  };

}



export function addTotals(left: Totals, right: Totals): Totals {

  return {

    units: roundMoney(left.units + right.units),

    totalNewUnits: roundMoney((left.totalNewUnits ?? 0) + (right.totalNewUnits ?? 0)),

    totalUsedUnits: roundMoney((left.totalUsedUnits ?? 0) + (right.totalUsedUnits ?? 0)),

    trades: left.trades + right.trades,

    gross: roundMoney(left.gross + right.gross),

    flat: roundMoney(left.flat + right.flat),

    fi: roundMoney(left.fi + right.fi),

    service: roundMoney(left.service + right.service),

    bonus: roundMoney(left.bonus + right.bonus),

    vacation: roundMoney(left.vacation + right.vacation),

    regular: roundMoney(left.regular + right.regular),

    pay: roundMoney(left.pay + right.pay),

  };

}



export function summarizeSheet(

  sheet: PaySheet | null | undefined,

  tiers: CommissionTier[] = currentPayTiers(),

  vehicleTypes?: VehicleTypeOption[] | null,

): Totals {

  const salesTotals = summarizeSales(sheet?.sales, tiers, vehicleTypes);

  const vacation = sheetVacationPay(sheet);

  const bonus = roundMoney((sheet?.bonuses ?? []).reduce((sum, item) => sum + (item.amount || 0), 0));

  const regular = regularPayAmount(sheet?.regularHours ?? 0, sheet?.hourlyRate ?? 0);

  if (isHourlyPayMode(sheet)) {

    return {

      ...salesTotals,

      vacation,

      bonus,

      regular,

      pay: roundMoney(regular + vacation + bonus),

    };

  }

  return {

    ...salesTotals,

    vacation,

    bonus,

    regular: 0,

    pay: roundMoney(salesTotals.pay + vacation + bonus),

  };

}



export function summarizeMonth(

  month: MonthRecord | null | undefined,

  tiers: CommissionTier[] = currentPayTiers(),

  vehicleTypes?: VehicleTypeOption[] | null,

): Totals {

  return (month?.sheets ?? [])

    .map((sheet) => summarizeSheet(sheet, tiers, vehicleTypes))

    .reduce(addTotals, emptyTotals());

}



export function summarizeAll(

  state: TrackerState | null | undefined,

  tiers: CommissionTier[] = currentPayTiers(),

): Totals {

  const vehicleTypes = state?.vehicleTypes ?? [];

  return (state?.months ?? [])

    .map((month) => summarizeMonth(month, tiers, vehicleTypes))

    .reduce(addTotals, emptyTotals());

}



export function salesFromSheet(sheet: PaySheet | null | undefined): Sale[] {

  return Array.isArray(sheet?.sales) ? sheet.sales : [];

}



export function salesFromMonth(month: MonthRecord | null | undefined): Sale[] {

  return (month?.sheets ?? []).flatMap(salesFromSheet);

}



export function salesFromState(state: TrackerState | null | undefined): Sale[] {

  return (state?.months ?? []).flatMap(salesFromMonth);

}



export type DealTypeMix = Record<DealType, { units: number; trades: number; gross: number }>;



export function dealTypeStats(

  sales: Sale[] | null | undefined,

  vehicleTypes?: VehicleTypeOption[] | null,

): DealTypeMix {

  const blank = () => ({ units: 0, trades: 0, gross: 0 });

  const mix: DealTypeMix = {

    new: blank(),

    used: blank(),

    lease_buyout: blank(),

  };

  for (const sale of Array.isArray(sales) ? sales : []) {

    if (!isCountedUnit(sale)) continue;

    const category = resolveVehicleTypeCategory(vehicleTypes, sale.vehicleType);

    const units = unitContribution(sale, vehicleTypes, { includeOther: true });

    const bucketKey: DealType =
      category === "USED" ? "used" : category === "OTHER" ? "lease_buyout" : "new";

    const bucket = mix[bucketKey];

    bucket.units = roundMoney(bucket.units + units);

    if (units > 0 && sale.tradeIn) bucket.trades += 1;

    bucket.gross = roundMoney(bucket.gross + sale.gross);

  }

  return mix;

}



export function dealTypeStatExtras(

  sales: Sale[] | null | undefined,

  vehicleTypes?: VehicleTypeOption[] | null,

): { label: string; value: string }[] {

  const mix = dealTypeStats(sales, vehicleTypes);

  return [

    { label: "New", value: String(mix.new.units) },

    { label: "Used", value: String(mix.used.units) },

    { label: "Other", value: String(mix.lease_buyout.units) },

  ];

}



export function hideHeaderStatOnPrint(label: string): boolean {

  const key = label.trim().toLowerCase().replace(/[_-]+/g, " ");

  return (

    key === "gross" ||

    key === "total pay" ||

    key === "total" ||

    key === "trades" ||

    key === "new" ||

    key === "used" ||

    key === "other" ||

    key === "lease bo" ||

    key === "lease buyout"

  );

}



export type PrintAddonRow = {

  key: string;

  label: string;

  detail: string;

  amount: number;

  kind: "deal" | "vacation" | "regular" | "grand";

};



function formatHours(hours: number): string {

  return Number.isInteger(hours) ? String(hours) : String(hours);

}



export function vacationPayPrintDetail(hours = 0, rate = 0): string {

  if (hours > 0 && rate > 0) return `${formatHours(hours)} hrs × ${formatMoney(rate)}/hr`;

  if (hours > 0) return `${formatHours(hours)} hrs`;

  if (rate > 0) return `${formatMoney(rate)}/hr`;

  return "";

}



export function dealPayFromTotals(totals: Totals): number {

  return roundMoney(totals.pay - totals.vacation - totals.bonus - totals.regular);

}



export function printAddonRows(input: {

  totals: Totals;

  vacationHours?: number;

  vacationRate?: number;

  regularHours?: number;

  hourlyRate?: number;

}): PrintAddonRow[] {

  const vacationDetail = vacationPayPrintDetail(input.vacationHours ?? 0, input.vacationRate ?? 0);

  const regularDetail = vacationPayPrintDetail(input.regularHours ?? 0, input.hourlyRate ?? 0);

  const rows: PrintAddonRow[] = [];

  if (input.totals.regular > 0) {

    rows.push({

      key: "regular",

      label: "Regular Hourly Pay",

      detail: regularDetail ? `(${regularDetail})` : "",

      amount: input.totals.regular,

      kind: "regular",

    });

  } else {

    rows.push({

      key: "deal",

      label: "Commissions + Flats + F&I + Service",

      detail: "",

      amount: dealPayFromTotals(input.totals),

      kind: "deal",

    });

  }

  rows.push(

    {

      key: "vacation",

      label: "Vacation Pay",

      detail: vacationDetail ? `(${vacationDetail})` : "",

      amount: input.totals.vacation,

      kind: "vacation",

    },

    {

      key: "grand",

      label: "Final Total Pay",

      detail: "(Includes all worksheet pay)",

      amount: input.totals.pay,

      kind: "grand",

    },

  );

  return rows;

}


