import { MONTH_NAMES, MAX_SHEETS_PER_MONTH, type MonthRecord, type PaySheet, type TrackerState } from "./types.ts";
import { nextSheetRange } from "./sheet-range.ts";

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "Unknown"} ${year}`;
}

export function sortMonths(months: MonthRecord[]): MonthRecord[] {
  return [...months].sort((left, right) => right.year - left.year || right.month - left.month);
}

export function createPaySheet(startDay = 1, endDay = 15): PaySheet {
  return {
    id: crypto.randomUUID(),
    startDay,
    endDay,
    sales: [],
    regularHours: 0,
    hourlyRate: 0,
    vacationHours: 0,
    vacationRate: 0,
    vacationPay: 0,
    bonuses: [],
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
    state: { ...state, months: sortMonths([...state.months, record]) },
  };
}

export function addSheet(
  state: TrackerState,
  monthId: string,
): { state: TrackerState; sheetId: string } | { error: string } {
  const month = findMonth(state, monthId);
  if (!month) return { error: "That month could not be found." };
  if (month.sheets.length >= MAX_SHEETS_PER_MONTH) {
    return { error: "Each month can hold two worksheets." };
  }
  const range = nextSheetRange(month.sheets, month.year, month.month);
  const sheet = createPaySheet(range.startDay, range.endDay);
  return {
    sheetId: sheet.id,
    state: {
      ...state,
      months: state.months.map((item) =>
        item.id === monthId ? { ...item, sheets: [...item.sheets, sheet] } : item,
      ),
    },
  };
}

/** Create (or reuse) a month and add a specific half-month pay sheet, then return ids for routing. */
export function addPayPeriodSheet(
  state: TrackerState,
  year: number,
  month: number,
  period: "1st-15th" | "16th-end",
): { state: TrackerState; monthId: string; sheetId: string } | { error: string } {
  if (month < 1 || month > 12) return { error: "Pick a month from January to December." };
  if (year < 2000 || year > 2100) return { error: "Enter a year between 2000 and 2100." };

  let nextState = state;
  let monthId = state.months.find((item) => item.year === year && item.month === month)?.id ?? "";
  if (!monthId) {
    const created = addMonth(state, year, month);
    if ("error" in created) return created;
    nextState = created.state;
    monthId = created.monthId;
  }

  const record = findMonth(nextState, monthId);
  if (!record) return { error: "That month could not be found." };
  if (record.sheets.length >= MAX_SHEETS_PER_MONTH) {
    return { error: "Each month can hold two worksheets." };
  }

  const last = new Date(year, month, 0).getDate();
  const range =
    period === "1st-15th"
      ? { startDay: 1, endDay: Math.min(15, last) }
      : { startDay: 16, endDay: last };

  const already = record.sheets.some((sheet) => {
    const start = sheet.startDay;
    const end = sheet.endDay;
    if (period === "1st-15th") return start <= 1 && end <= 15;
    return start >= 16;
  });
  if (already) {
    return { error: `${monthLabel(year, month)} already has a ${period === "1st-15th" ? "1st–15th" : "16th–end"} sheet.` };
  }

  const sheet = createPaySheet(range.startDay, range.endDay);
  return {
    monthId,
    sheetId: sheet.id,
    state: {
      ...nextState,
      months: nextState.months.map((item) =>
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
    ...state,
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
