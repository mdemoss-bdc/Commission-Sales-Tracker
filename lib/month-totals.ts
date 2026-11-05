import { monthLabel } from "./records.ts";

/** One pay sheet's contribution to a month total. */
export interface SheetPayEntry {
  filterKey: string;
  year: number;
  month: number;
  pay: number;
}

/** A month bucket: every sheet in that month summed into one total. */
export interface MonthPayTotal {
  filterKey: string;
  label: string;
  year: number;
  month: number;
  pay: number;
}

/**
 * Group sheet pay entries by month (the sheets' own year + month, keyed by
 * the sheet filter key) and sum each month's sheets into a single total.
 * Rows come back newest month first. A month with one sheet keeps that
 * sheet's total.
 */
export function summarizePayByMonth(entries: readonly SheetPayEntry[]): MonthPayTotal[] {
  const byMonth = new Map<string, MonthPayTotal>();
  for (const entry of entries) {
    const existing = byMonth.get(entry.filterKey);
    if (existing) {
      existing.pay += entry.pay;
    } else {
      byMonth.set(entry.filterKey, {
        filterKey: entry.filterKey,
        label: monthLabel(entry.year, entry.month),
        year: entry.year,
        month: entry.month,
        pay: entry.pay,
      });
    }
  }
  return [...byMonth.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}
