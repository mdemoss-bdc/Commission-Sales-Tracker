import assert from "node:assert/strict";
import test from "node:test";
import {
  bonusesFromRecord,
  explicitBonuses,
  markLocalEdit,
  resolvePersistedGeneration,
  shouldApplyRemoteWorksheet,
  withExplicitBonuses,
} from "./worksheet-persist.ts";
import type { ExtraPay, TrackerState } from "./types.ts";

const defaultBonus: ExtraPay = { id: "fast-start", label: "Fast Start", amount: 2193.99 };

test("empty bonus arrays stay empty and never fall back to a default bonus", () => {
  assert.deepEqual(explicitBonuses([]), []);
  assert.deepEqual(bonusesFromRecord({ bonuses: [] }), []);
  assert.deepEqual(explicitBonuses([] || [defaultBonus]), []);
  const data = { bonuses: [] as ExtraPay[] };
  const bonuses = Array.isArray(data.bonuses) ? explicitBonuses(data.bonuses) : [defaultBonus];
  assert.deepEqual(bonuses, []);
  assert.notDeepEqual(data.bonuses || [defaultBonus], [defaultBonus]);
});

test("missing bonus fields become an empty array instead of a default bonus", () => {
  assert.deepEqual(explicitBonuses(undefined), []);
  assert.deepEqual(explicitBonuses(null), []);
  assert.deepEqual(bonusesFromRecord({}), []);
  assert.deepEqual(bonusesFromRecord(null), []);
});

test("withExplicitBonuses writes [] onto sheets that have no leftover bonuses", () => {
  const state: TrackerState = {
    vehicleTypes: [],
    months: [
      {
        id: "m1",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "s1",
            startDay: 1,
            endDay: 15,
            sales: [],
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: [],
          },
        ],
      },
    ],
  };
  const next = withExplicitBonuses(state);
  assert.deepEqual(next.months[0]?.sheets[0]?.bonuses, []);
  const json = JSON.parse(JSON.stringify(next)) as TrackerState;
  assert.deepEqual(json.months[0]?.sheets[0]?.bonuses, []);
});

test("dirty or in-flight writes block stale remote hydrates", () => {
  const base = {
    isDirty: false,
    saveInFlight: false,
    localEditGeneration: 0,
    persistedGeneration: 0,
    ignoreRemoteUntilMs: 0,
    nowMs: 10_000,
  };
  assert.equal(shouldApplyRemoteWorksheet(base), true);
  assert.equal(shouldApplyRemoteWorksheet({ ...base, isDirty: true }), false);
  assert.equal(shouldApplyRemoteWorksheet({ ...base, saveInFlight: true }), false);
  assert.equal(
    shouldApplyRemoteWorksheet({ ...base, localEditGeneration: 3, persistedGeneration: 2 }),
    false,
  );
  assert.equal(shouldApplyRemoteWorksheet({ ...base, ignoreRemoteUntilMs: 11_000 }), false);
  assert.equal(shouldApplyRemoteWorksheet({ ...base, isDirty: true, force: true }), true);
});

test("local edit generations stay dirty until the matching write resolves", () => {
  const first = markLocalEdit(0);
  assert.equal(first.isDirty, true);
  assert.equal(first.localEditGeneration, 1);
  const second = markLocalEdit(first.localEditGeneration);
  const midWrite = resolvePersistedGeneration({
    writeGeneration: first.localEditGeneration,
    localEditGeneration: second.localEditGeneration,
  });
  assert.equal(midWrite.isDirty, true);
  assert.equal(midWrite.persistedGeneration, 1);
  const done = resolvePersistedGeneration({
    writeGeneration: second.localEditGeneration,
    localEditGeneration: second.localEditGeneration,
  });
  assert.equal(done.isDirty, false);
  assert.equal(done.persistedGeneration, 2);
});
