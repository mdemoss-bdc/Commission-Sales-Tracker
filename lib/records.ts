import { MONTH_NAMES, MAX_SHEETS_PER_MONTH, type MonthRecord, type PaySheet, type TrackerState } from "./types.ts";

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "Unknown"} ${year}`;
}

export function sortMonths(months: MonthRecord[]): MonthRecord[] {
  return [...months].sort((left, right) => right.year - left.year || right.month - left.month);
}

export function createPaySheet(name: string): PaySheet {
  return {
    id: crypto.randomUUID(),
    name,
    sales: [],
  };
}

export function createMonth(year: number, month: number): MonthRecord {
  return {
    id: crypto.randomUUID(),
    year,
    month,
    sheets: [],
  };
}

export function findMonth(state: TrackerState, monthId: string): MonthRecord | undefined {
  return (state.months ?? []).find((month) => month.id === monthId);
}

export function findSheet(month: MonthRecord, sheetId: string): PaySheet | undefined {
  return (month.sheets ?? []).find((sheet) => sheet.id === sheetId);
}

export function monthExists(state: TrackerState, year: number, month: number, exceptId?: string): boolean {
  return state.months.some(
    (item) => item.year === year && item.month === month && item.id !== exceptId,
  );
}

export function addMonth(
  state: TrackerState,
  year: number,
  month: number,
): { state: TrackerState; monthId: string } | { error: string } {
  if (month < 1 || month > 12) return { error: "Pick a month from January to December." };
  if (year < 2000 || year > 2100) return { error: "Enter a year between 2000 and 2100." };
  if (monthExists(state, year, month)) {
    return { error: `${monthLabel(year, month)} is already on the board.` };
  }
  const record = createMonth(year, month);
  return {
    monthId: record.id,
    state: { months: sortMonths([...state.months, record]) },
  };
}

export function addSheet(
  state: TrackerState,
  monthId: string,
): { state: TrackerState; sheetId: string } | { error: string } {
  const month = findMonth(state, monthId);
  if (!month) return { error: "That month could not be found." };
  if (month.sheets.length >= MAX_SHEETS_PER_MONTH) {
    return { error: "Each month can hold two sales sheets." };
  }
  const sheet = createPaySheet(`Sheet ${month.sheets.length + 1}`);
  return {
    sheetId: sheet.id,
    state: {
      months: state.months.map((item) =>
        item.id === monthId ? { ...item, sheets: [...item.sheets, sheet] } : item,
      ),
    },
  };
}

export function mapMonth(
  state: TrackerState,
  monthId: string,
  updater: (month: MonthRecord) => MonthRecord,
): TrackerState {
  return {
    months: state.months.map((month) => (month.id === monthId ? updater(month) : month)),
  };
}

export function mapSheet(
  state: TrackerState,
  monthId: string,
  sheetId: string,
  updater: (sheet: PaySheet) => PaySheet,
): TrackerState {
  return mapMonth(state, monthId, (month) => ({
    ...month,
    sheets: month.sheets.map((sheet) => (sheet.id === sheetId ? updater(sheet) : sheet)),
  }));
}

export function currentYear(date = new Date()): number {
  return date.getFullYear();
}

export function currentMonth(date = new Date()): number {
  return date.getMonth() + 1;
}
