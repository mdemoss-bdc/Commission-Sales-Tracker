"use client";

import { useMemo, useState } from "react";
import {
  ADMIN_ROSTER_ADD_YEAR_LABEL,
  ADMIN_ROSTER_SPLIT_OPTIONS,
  adminRosterMonthOptions,
  buildAdminRosterYearOptions,
  composeAdminRosterPeriod,
  normalizeAdminRosterSplit,
  type AdminRosterSplitChoice,
} from "@/lib/admin-roster";
import type { PayPeriodIdentity } from "@/lib/pay-period";

const EXTRA_YEARS_SESSION_KEY = "admin-roster-extra-years";

function readExtraYears(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(EXTRA_YEARS_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => Number.isInteger(value));
  } catch {
    return [];
  }
}

function writeExtraYears(years: number[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(EXTRA_YEARS_SESSION_KEY, JSON.stringify(years));
  } catch {
    // ignore storage failures
  }
}

export function AdminRosterPeriodControls({
  period,
  onPeriodChange,
}: {
  period: PayPeriodIdentity;
  onPeriodChange: (next: PayPeriodIdentity) => void;
}) {
  const [extraYears, setExtraYears] = useState<number[]>(() => readExtraYears());
  const [addingYear, setAddingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState("");

  const year = period.year ?? new Date().getFullYear();
  const month = period.month ?? new Date().getMonth() + 1;
  const split = normalizeAdminRosterSplit(period.split);
  const yearOptions = useMemo(() => buildAdminRosterYearOptions(new Date(), [year, ...extraYears]), [extraYears, year]);
  const monthOptions = useMemo(() => adminRosterMonthOptions(), []);

  function commit(next: { year?: number; month?: number; split?: AdminRosterSplitChoice }) {
    onPeriodChange(
      composeAdminRosterPeriod({
        year: next.year ?? year,
        month: next.month ?? month,
        split: next.split ?? split,
      }),
    );
  }

  function addYear(raw: string) {
    const parsed = Number(raw.trim());
    if (!Number.isInteger(parsed) || parsed < 1970 || parsed > 2100) return;
    const merged = [...new Set([...extraYears, parsed])].sort((left, right) => right - left);
    setExtraYears(merged);
    writeExtraYears(merged);
    setAddingYear(false);
    setYearDraft("");
    commit({ year: parsed });
  }

  return (
    <div className="admin-roster-period-controls" role="group" aria-label="Pay period">
      <label className="admin-roster-period-field">
        Year
        <select
          aria-label="Pay period year"
          value={year}
          onChange={(event) => commit({ year: Number(event.target.value) })}
        >
          {yearOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {addingYear ? (
        <label className="admin-roster-period-field admin-roster-add-year-field">
          Add year
          <input
            type="number"
            inputMode="numeric"
            min={1970}
            max={2100}
            autoFocus
            aria-label="Add pay period year"
            placeholder="YYYY"
            value={yearDraft}
            onChange={(event) => setYearDraft(event.target.value)}
            onBlur={() => {
              if (yearDraft.trim()) addYear(yearDraft);
              else setAddingYear(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addYear(yearDraft);
              }
              if (event.key === "Escape") {
                setAddingYear(false);
                setYearDraft("");
              }
            }}
          />
        </label>
      ) : (
        <button
          type="button"
          className="admin-roster-add-year"
          onClick={() => {
            setAddingYear(true);
            setYearDraft("");
          }}
        >
          {ADMIN_ROSTER_ADD_YEAR_LABEL}
        </button>
      )}
      <label className="admin-roster-period-field">
        Month
        <select
          aria-label="Pay period month"
          value={month}
          onChange={(event) => commit({ month: Number(event.target.value) })}
        >
          {monthOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="admin-roster-period-field">
        Period
        <select
          aria-label="Pay period split"
          value={split}
          onChange={(event) => commit({ split: event.target.value as AdminRosterSplitChoice })}
        >
          {ADMIN_ROSTER_SPLIT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
