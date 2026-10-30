import assert from "node:assert/strict";
import test from "node:test";
import {
  PERSONAL_NOTES_DEFAULT_SLOTS,
  PERSONAL_NOTES_MAX_ROWS,
  cleanPersonalNotes,
  createPersonalNote,
  padNoteRows,
  parsePersonalNotes,
  type PersonalNote,
} from "./personal-notes.ts";

function note(label: string, value: string, id = `id-${label}-${value}`): PersonalNote {
  return { id, label, value };
}

test("parsePersonalNotes keeps valid rows and drops junk", () => {
  const parsed = parsePersonalNotes([
    note("Rent", "$500"),
    { id: "x", label: 42, value: null },
    { label: "no id", value: "skip" },
    "garbage",
    null,
    note("Gym", "45"),
  ]);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], note("Rent", "$500"));
  assert.deepEqual(parsed[1], { id: "x", label: "", value: "" });
  assert.deepEqual(parsed[2], note("Gym", "45"));
});

test("parsePersonalNotes rejects non-arrays and dedupes ids", () => {
  assert.deepEqual(parsePersonalNotes(undefined), []);
  assert.deepEqual(parsePersonalNotes({}), []);
  const parsed = parsePersonalNotes([note("A", "1", "dup"), note("B", "2", "dup")]);
  assert.equal(parsed.length, 1);
});

test("cleanPersonalNotes drops fully-empty rows only", () => {
  const cleaned = cleanPersonalNotes([
    note("Rent", "$500"),
    note("", ""),
    note("  ", " "),
    note("Label only", ""),
    note("", "Value only"),
  ]);
  assert.deepEqual(
    cleaned.map((row) => row.label),
    ["Rent", "Label only", ""],
  );
});

test("padNoteRows fills to the default slot count with saved entries first", () => {
  const rows = padNoteRows([note("Rent", "$500"), note("Gym", "45")]);
  assert.equal(rows.length, PERSONAL_NOTES_DEFAULT_SLOTS);
  assert.equal(rows[0].label, "Rent");
  assert.equal(rows[1].label, "Gym");
  assert.ok(rows.slice(2).every((row) => row.label === "" && row.value === ""));
  // Every slot has a unique id so React keys / row edits stay stable.
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
});

test("padNoteRows with nothing saved renders all blank slots", () => {
  const rows = padNoteRows([]);
  assert.equal(rows.length, PERSONAL_NOTES_DEFAULT_SLOTS);
  assert.ok(rows.every((row) => row.label === "" && row.value === ""));
});

test("padNoteRows shows every saved entry above the default, up to the max", () => {
  const saved = Array.from({ length: 11 }, (_, i) => note(`L${i}`, `V${i}`, `s${i}`));
  assert.equal(padNoteRows(saved).length, 11);
  const over = Array.from({ length: 15 }, (_, i) => note(`L${i}`, `V${i}`, `s${i}`));
  assert.equal(padNoteRows(over).length, PERSONAL_NOTES_MAX_ROWS);
  assert.equal(cleanPersonalNotes(over).length, PERSONAL_NOTES_MAX_ROWS);
});

test("cleaned notes round-trip through parse unchanged", () => {
  const saved = cleanPersonalNotes([note("Rent", "$500"), createPersonalNote(), note("Gym", "45")]);
  assert.deepEqual(parsePersonalNotes(JSON.parse(JSON.stringify(saved))), saved);
});
