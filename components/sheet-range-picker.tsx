"use client";

import { daysInMonth, ordinal, normalizeRange } from "@/lib/sheet-range";

type SheetRangePickerProps = {
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  onChange: (range: { startDay: number; endDay: number }) => void;
};

export function SheetRangePicker({
  year,
  month,
  startDay,
  endDay,
  onChange,
}: SheetRangePickerProps) {
  const last = daysInMonth(year, month);
  const range = normalizeRange(startDay, endDay, year, month);
  const presets = [
    { startDay: 1, endDay: Math.min(15, last), label: "1st–15th" },
    { startDay: 16, endDay: last, label: "16th–end" },
    { startDay: 1, endDay: last, label: "Full month" },
  ];

  return (
    <div className="sheet-range-picker">
      <div className="sheet-range-presets" role="group" aria-label="Pay period">
        {presets.map((preset) => {
          const active =
            range.startDay === preset.startDay && range.endDay === preset.endDay;
          return (
            <button
              key={preset.label}
              type="button"
              className={active ? "range-chip active" : "range-chip"}
              onClick={() => onChange({ startDay: preset.startDay, endDay: preset.endDay })}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="sheet-range-custom">
        <label>
          From
          <select
            aria-label="Period start day"
            value={range.startDay}
            onChange={(event) => {
              const nextStart = Number(event.target.value);
              onChange({
                startDay: nextStart,
                endDay: Math.max(range.endDay, nextStart),
              });
            }}
          >
            {Array.from({ length: last }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            aria-label="Period end day"
            value={range.endDay}
            onChange={(event) =>
              onChange({ startDay: range.startDay, endDay: Number(event.target.value) })
            }
          >
            {Array.from({ length: last - range.startDay + 1 }, (_, index) => range.startDay + index).map(
              (day) => (
                <option key={day} value={day}>
                  {day === last ? `${ordinal(day)} (end)` : ordinal(day)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
    </div>
  );
}
