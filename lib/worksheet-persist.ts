import type { ExtraPay, MonthRecord, PaySheet, TrackerState } from "./types.ts";

export const REMOTE_ECHO_HOLD_MS = 1500;

export type WorksheetWriteLock = {
  isDirty: boolean;
  saveInFlight: boolean;
  localEditGeneration: number;
  persistedGeneration: number;
  ignoreRemoteUntilMs: number;
  nowMs: number;
  force?: boolean;
};

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseBonus(value: unknown): ExtraPay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    label: asString(row.label),
    amount: asNumber(row.amount),
  };
}

/**
 * Empty arrays are a real value. Never fall back to a default bonus when
 * `data.bonuses` is `[]` — `[] || [defaultBonus]` must not be used.
 */
export function explicitBonuses(value: unknown): ExtraPay[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseBonus).filter((bonus): bonus is ExtraPay => Boolean(bonus));
}

export function bonusesFromRecord(data: Record<string, unknown> | null | undefined): ExtraPay[] {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "bonuses")) return [];
  return explicitBonuses(data.bonuses);
}

export function sheetWithExplicitBonuses(sheet: PaySheet): PaySheet {
  return {
    ...sheet,
    bonuses: explicitBonuses(sheet.bonuses),
  };
}

export function withExplicitBonuses(state: TrackerState): TrackerState {
  return {
    ...state,
    months: (state.months ?? []).map((month): MonthRecord => ({
      ...month,
      sheets: (month.sheets ?? []).map(sheetWithExplicitBonuses),
    })),
  };
}

export function shouldApplyRemoteWorksheet(lock: WorksheetWriteLock): boolean {
  if (lock.force) return true;
  if (lock.isDirty) return false;
  if (lock.saveInFlight) return false;
  if (lock.localEditGeneration > lock.persistedGeneration) return false;
  if (lock.nowMs < lock.ignoreRemoteUntilMs) return false;
  return true;
}

export function markLocalEdit(currentGeneration: number): {
  isDirty: true;
  localEditGeneration: number;
} {
  return { isDirty: true, localEditGeneration: currentGeneration + 1 };
}

export function resolvePersistedGeneration(input: {
  writeGeneration: number;
  localEditGeneration: number;
}): { isDirty: boolean; persistedGeneration: number } {
  const caughtUp = input.writeGeneration === input.localEditGeneration;
  return {
    isDirty: !caughtUp,
    persistedGeneration: input.writeGeneration,
  };
}
