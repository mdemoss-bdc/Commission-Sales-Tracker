import { daysInMonth } from "./sheet-range.ts";
import { currentMonth, currentYear, sortMonths } from "./records.ts";
import type { MonthRecord, PaySheet, TrackerState } from "./types.ts";

export type PayPeriodSplit = "part1" | "part2" | "full" | "unknown";

export type PayPeriodIdentity = {
  year: number | null;
  month: number | null;
  split: PayPeriodSplit;
  key: string | null;
  raw: string | null;
};

const PART1_ALIASES = new Set([
  "part1",
  "part-1",
  "first-half",
  "firsthalf",
  "1st-15th",
  "1st–15th",
  "1-15",
  "1–15",
  "1",
  "1st",
]);
const PART2_ALIASES = new Set([
  "part2",
  "part-2",
  "second-half",
  "secondhalf",
  "16th-end",
  "16th–end",
  "16-end",
  "16–end",
  "16th-eom",
  "16",
  "16th",
  "2",
  "2nd",
]);
const FULL_ALIASES = new Set(["full", "full-month", "fullmonth", "month"]);

export function splitFromRange(
  startDay: number | null | undefined,
  endDay: number | null | undefined,
  year: number,
  month: number,
): PayPeriodSplit {
  const last = daysInMonth(year, month);
  const start = Number(startDay);
  const end = Number(endDay);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1) return "unknown";
  if (start === 1 && end === 15) return "part1";
  if (start === 16 && end === last) return "part2";
  if (start === 1 && end === last) return "full";
  if (start <= 15 && end <= 15) return "part1";
  if (start >= 16) return "part2";
  return "full";
}

export function rangeForSplit(
  split: PayPeriodSplit,
  year: number,
  month: number,
): { startDay: number; endDay: number } {
  const last = daysInMonth(year, month);
  if (split === "part2") return { startDay: 16, endDay: last };
  if (split === "full") return { startDay: 1, endDay: last };
  return { startDay: 1, endDay: Math.min(15, last) };
}

export function calendarKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function payPeriodKey(year: number, month: number, split: PayPeriodSplit): string {
  const stamp = calendarKey(year, month);
  if (split === "part2") return `${stamp}-part2`;
  if (split === "full") return `${stamp}-full`;
  if (split === "part1") return `${stamp}-part1`;
  return stamp;
}

export function aliasPeriodKey(year: number, month: number, split: PayPeriodSplit): string[] {
  const stamp = calendarKey(year, month);
  if (split === "part2") {
    return [`${stamp}-part2`, `${stamp}-16th-end`, `${stamp}-16th–end`, `${stamp}-16`, `${stamp}-2`];
  }
  if (split === "part1") {
    return [`${stamp}-part1`, `${stamp}-1st-15th`, `${stamp}-1st–15th`, `${stamp}-1`];
  }
  if (split === "full") return [`${stamp}-full`, stamp];
  return [stamp];
}

export function periodKeyCandidates(period: PayPeriodIdentity | null | undefined): string[] {
  if (!period) return [];
  const keys = new Set<string>();
  if (period.key) keys.add(period.key);
  if (period.raw) keys.add(period.raw);
  if (period.year && period.month && period.split !== "unknown") {
    for (const alias of aliasPeriodKey(period.year, period.month, period.split)) keys.add(alias);
  }
  return [...keys];
}

export function matchesPeriodKey(
  value: string | null | undefined,
  preferred: PayPeriodIdentity | null | undefined,
): boolean {
  if (!value || !preferred) return false;
  const candidates = periodKeyCandidates(preferred);
  if (candidates.includes(value)) return true;
  const parsed = parsePayPeriodKey(value);
  if (parsed.key && candidates.includes(parsed.key)) return true;
  return periodsCompatible(parsed, preferred) && parsed.split !== "unknown" && preferred.split !== "unknown";
}

function parseSplitToken(token: string): PayPeriodSplit {
  const value = token.trim().toLowerCase();
  if (PART2_ALIASES.has(value)) return "part2";
  if (PART1_ALIASES.has(value)) return "part1";
  if (FULL_ALIASES.has(value)) return "full";
  const dayMatch = value.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (n === 2) return "part2";
    if (n >= 16) return "part2";
    if (n >= 1 && n <= 15) return "part1";
  }
  return "unknown";
}

export function parsePayPeriodKey(value: unknown): PayPeriodIdentity {
  const raw = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!raw) {
    return { year: null, month: null, split: "unknown", key: null, raw: null };
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})(?:[-_](.+))?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const split = iso[3] ? parseSplitToken(iso[3]) : "unknown";
    return {
      year,
      month,
      split,
      key: Number.isFinite(year) && Number.isFinite(month) ? payPeriodKey(year, month, split) : null,
      raw,
    };
  }
  return { year: null, month: null, split: parseSplitToken(raw), key: null, raw };
}

export function periodFromRange(
  year: number,
  month: number,
  startDay?: number | null,
  endDay?: number | null,
  raw?: string | null,
): PayPeriodIdentity {
  const split = splitFromRange(startDay, endDay, year, month);
  return {
    year,
    month,
    split,
    key: payPeriodKey(year, month, split),
    raw: raw ?? payPeriodKey(year, month, split),
  };
}

export function periodFromSheet(
  sheet: Pick<PaySheet, "startDay" | "endDay" | "id"> | null | undefined,
  month: Pick<MonthRecord, "id" | "year" | "month"> | null | undefined,
): PayPeriodIdentity {
  if (!month) return parsePayPeriodKey(sheet?.id);
  const fromId = parsePayPeriodKey(month.id);
  const split = sheet ? splitFromRange(sheet.startDay, sheet.endDay, month.year, month.month) : fromId.split;
  return {
    year: month.year,
    month: month.month,
    split: split === "unknown" ? fromId.split : split,
    key: payPeriodKey(month.year, month.month, split === "unknown" ? fromId.split : split),
    raw: month.id,
  };
}

export function periodFromUnknown(value: unknown): PayPeriodIdentity {
  if (typeof value === "string") return parsePayPeriodKey(value);
  if (!value || typeof value !== "object") {
    return { year: null, month: null, split: "unknown", key: null, raw: null };
  }
  const row = value as Record<string, unknown>;
  const nested =
    row.state && typeof row.state === "object" && !Array.isArray(row.state)
      ? (row.state as Record<string, unknown>)
      : null;
  const raw =
    (typeof row.period_id === "string" && row.period_id) ||
    (typeof row.periodId === "string" && row.periodId) ||
    (typeof row.month_id === "string" && row.month_id) ||
    (typeof row.monthId === "string" && row.monthId) ||
    (nested && typeof nested.period_id === "string" && nested.period_id) ||
    (nested && typeof nested.month_id === "string" && nested.month_id) ||
    null;
  const parsed = parsePayPeriodKey(raw);
  const year =
    parsed.year ??
    (typeof row.year === "number" ? row.year : null) ??
    (nested && typeof nested.year === "number" ? nested.year : null);
  const month =
    parsed.month ??
    (typeof row.month === "number" ? row.month : null) ??
    (nested && typeof nested.month === "number" ? nested.month : null);
  const startDay =
    typeof row.startDay === "number"
      ? row.startDay
      : typeof row.start_day === "number"
        ? row.start_day
        : null;
  const endDay =
    typeof row.endDay === "number" ? row.endDay : typeof row.end_day === "number" ? row.end_day : null;
  if (year && month) {
    const split =
      parsed.split !== "unknown" ? parsed.split : splitFromRange(startDay, endDay, year, month);
    return { year, month, split, key: payPeriodKey(year, month, split), raw };
  }
  return parsed;
}

export function activePayPeriod(now = new Date()): PayPeriodIdentity {
  const year = currentYear(now);
  const month = currentMonth(now);
  const split: PayPeriodSplit = now.getDate() >= 16 ? "part2" : "part1";
  return { year, month, split, key: payPeriodKey(year, month, split), raw: payPeriodKey(year, month, split) };
}

export function periodsCompatible(left: PayPeriodIdentity, right: PayPeriodIdentity): boolean {
  if (left.year && right.year && left.year !== right.year) return false;
  if (left.month && right.month && left.month !== right.month) return false;
  if (left.split === "unknown" || right.split === "unknown" || left.split === "full" || right.split === "full") {
    return true;
  }
  return left.split === right.split;
}

export function periodMatchScore(candidate: PayPeriodIdentity, preferred: PayPeriodIdentity | null | undefined): number {
  if (!preferred) return 0;
  let score = 0;
  if (candidate.year && preferred.year && candidate.year === preferred.year) score += 10;
  if (candidate.month && preferred.month && candidate.month === preferred.month) score += 20;
  if (candidate.split !== "unknown" && preferred.split !== "unknown" && candidate.split === preferred.split) score += 40;
  if (candidate.split !== "unknown" && preferred.split !== "unknown" && candidate.split !== preferred.split && candidate.split !== "full" && preferred.split !== "full") {
    score -= 50;
  }
  return score;
}

export function sheetHasSales(sheet: PaySheet | null | undefined): boolean {
  return Boolean(sheet && (sheet.sales ?? []).length > 0);
}

export function monthHasSales(month: MonthRecord | null | undefined): boolean {
  return Boolean(month?.sheets.some(sheetHasSales));
}

export function pickSheetsForPeriod(
  month: MonthRecord | null | undefined,
  preferred?: PayPeriodIdentity | null,
): PaySheet[] {
  const sheets = month?.sheets ?? [];
  if (sheets.length === 0) return [];
  const withSales = sheets.filter(sheetHasSales);
  if (!preferred) return withSales.length ? withSales : sheets;
  const matching = sheets.filter((sheet) =>
    periodsCompatible(periodFromSheet(sheet, month), preferred),
  );
  const matchingSales = matching.filter(sheetHasSales);
  if (matchingSales.length > 0) return matchingSales;
  if (withSales.length > 0) return withSales;
  if (matching.length > 0) return matching;
  return sheets;
}

export function pickMonthForPeriod(
  state: TrackerState | null | undefined,
  preferred?: PayPeriodIdentity | null,
  now = new Date(),
): MonthRecord | null {
  const months = sortMonths(state?.months ?? []);
  if (months.length === 0) return null;
  const target = preferred ?? activePayPeriod(now);
  let best: MonthRecord | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const month of months) {
    const sales = month.sheets.reduce((sum, sheet) => sum + (sheet.sales ?? []).length, 0);
    const extras = month.sheets.reduce(
      (sum, sheet) =>
        sum +
        (sheet.bonuses ?? []).length +
        ((sheet.vacationHours ?? 0) > 0 || (sheet.vacationRate ?? 0) > 0 ? 1 : 0),
      0,
    );
    const period = periodFromSheet(month.sheets.find(sheetHasSales) ?? month.sheets[0], month);
    const score =
      sales * 1000 +
      extras * 10 +
      periodMatchScore(period, target) +
      (month.year === target.year && month.month === target.month ? 5 : 0);
    if (score > bestScore) {
      best = month;
      bestScore = score;
    }
  }
  if (best && (monthHasSales(best) || bestScore > 0)) return best;
  const year = target.year ?? currentYear(now);
  const month = target.month ?? currentMonth(now);
  return months.find((row) => row.year === year && row.month === month) ?? months[0] ?? null;
}

export function mergeTrackerMonths(states: Array<TrackerState | null | undefined>): TrackerState | null {
  const vehicleTypes: TrackerState["vehicleTypes"] = [];
  const byCalendar = new Map<string, MonthRecord>();
  for (const state of states) {
    if (!state) continue;
    for (const type of state.vehicleTypes ?? []) {
      if (!vehicleTypes.some((item) => item.id === type.id)) vehicleTypes.push(type);
    }
    for (const month of state.months ?? []) {
      const stamp = calendarKey(month.year, month.month);
      let host = byCalendar.get(stamp);
      if (!host) {
        host = { id: month.id, year: month.year, month: month.month, sheets: [] };
        byCalendar.set(stamp, host);
      }
      for (const sheet of month.sheets ?? []) {
        const split = splitFromRange(sheet.startDay, sheet.endDay, month.year, month.month);
        const existing =
          host.sheets.find((item) => item.id === sheet.id) ??
          host.sheets.find((item) => splitFromRange(item.startDay, item.endDay, month.year, month.month) === split);
        if (!existing) {
          host.sheets.push({
            ...sheet,
            sales: [...(sheet.sales ?? [])],
            bonuses: [...(sheet.bonuses ?? [])],
          });
          continue;
        }
        const seen = new Set(existing.sales.map((sale) => sale.id));
        for (const sale of sheet.sales ?? []) {
          if (!seen.has(sale.id)) {
            existing.sales.push(sale);
            seen.add(sale.id);
          }
        }
        if ((sheet.sales ?? []).length > (existing.sales ?? []).length) {
          existing.startDay = sheet.startDay;
          existing.endDay = sheet.endDay;
        }
        if ((sheet.vacationHours ?? 0) > 0) existing.vacationHours = sheet.vacationHours;
        if ((sheet.vacationRate ?? 0) > 0) existing.vacationRate = sheet.vacationRate;
        if ((sheet.vacationPay ?? 0) > 0) existing.vacationPay = sheet.vacationPay;
        if ((sheet.bonuses ?? []).length > (existing.bonuses ?? []).length) existing.bonuses = [...(sheet.bonuses ?? [])];
      }
    }
  }
  const months = sortMonths([...byCalendar.values()]);
  if (months.length === 0 && vehicleTypes.length === 0) return null;
  return { months, vehicleTypes };
}

export function rangeFromPeriodIdentity(period: PayPeriodIdentity): { startDay: number; endDay: number } | null {
  if (!period.year || !period.month) return null;
  if (period.split === "unknown") return null;
  return rangeForSplit(period.split, period.year, period.month);
}
