export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function clampDay(day: number, year: number, month: number): number {
  const last = daysInMonth(year, month);
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(last, Math.floor(day));
}

export function ordinal(day: number): string {
  const value = Math.floor(day);
  const teen = value % 100;
  if (teen >= 11 && teen <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function normalizeRange(
  startDay: number,
  endDay: number,
  year: number,
  month: number,
): { startDay: number; endDay: number } {
  const last = daysInMonth(year, month);
  const start = clampDay(startDay, year, month);
  const end = Math.min(last, Math.max(start, clampDay(endDay, year, month)));
  return { startDay: start, endDay: end };
}

export function sheetRangeLabel(
  startDay: number,
  endDay: number,
  year: number,
  month: number,
): string {
  const range = normalizeRange(startDay, endDay, year, month);
  const last = daysInMonth(year, month);
  if (range.startDay === 1 && range.endDay === 15) return "1st–15th";
  if (range.startDay === 16 && range.endDay === last) return "16th–end";
  if (range.startDay === 1 && range.endDay === last) return `1st–${ordinal(last)}`;
  return `${ordinal(range.startDay)}–${ordinal(range.endDay)}`;
}

export function nextSheetRange(
  sheets: { startDay: number; endDay: number }[],
  year: number,
  month: number,
): { startDay: number; endDay: number } {
  const last = daysInMonth(year, month);
  if (sheets.length === 0) return { startDay: 1, endDay: Math.min(15, last) };
  const first = normalizeRange(sheets[0]?.startDay ?? 1, sheets[0]?.endDay ?? 15, year, month);
  if (first.startDay <= 15 && first.endDay <= 15) return { startDay: 16, endDay: last };
  return { startDay: 1, endDay: Math.min(15, last) };
}

export function rangeFromLegacyName(name: string, index: number): { startDay: number; endDay: number } {
  const value = name.trim().toLowerCase();
  const match = value.match(/(\d{1,2})\s*[-–]\s*(\d{1,2}|end)/);
  if (match) {
    const startDay = Number(match[1]);
    const endDay = match[2] === "end" ? 31 : Number(match[2]);
    return { startDay, endDay };
  }
  if (/sheet\s*2/.test(value) || index >= 1) return { startDay: 16, endDay: 31 };
  return { startDay: 1, endDay: 15 };
}
