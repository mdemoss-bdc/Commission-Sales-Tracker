import { getSupabase, isSupabaseConfigured } from "./supabase.ts";

/**
 * Personal notes — a private, per-user label/value list shown beside the
 * sheet header on every pay sheet. Deliberately NOT part of TrackerState:
 * notes never enter deal_records payloads, pay_tracker_state snapshots,
 * office comparisons, submit-to-manager flows, or print. Storage is a
 * dedicated owner-only table (public.user_notes) plus a local mirror.
 */

export interface PersonalNote {
  id: string;
  label: string;
  value: string;
}

/** Blank slots rendered by default so the table is immediately type-ready. */
export const PERSONAL_NOTES_DEFAULT_SLOTS = 10;
/** Hard cap on rows (saved entries and slots alike). */
export const PERSONAL_NOTES_MAX_ROWS = 12;

const USER_NOTES_TABLE = "user_notes";

export function personalNotesStorageKey(userId: string | null): string {
  return `pay-tracker:personal-notes:${userId ?? "guest"}`;
}

export function createPersonalNote(): PersonalNote {
  return { id: crypto.randomUUID(), label: "", value: "" };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parsePersonalNotes(value: unknown): PersonalNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const notes: PersonalNote[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = asString(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    notes.push({ id, label: asString(row.label), value: asString(row.value) });
    if (notes.length >= PERSONAL_NOTES_MAX_ROWS) break;
  }
  return notes;
}

function isBlankNote(note: PersonalNote): boolean {
  return note.label.trim() === "" && note.value.trim() === "";
}

/** What actually gets saved: fully-empty rows dropped, capped at the max. */
export function cleanPersonalNotes(notes: PersonalNote[]): PersonalNote[] {
  return notes.filter((note) => !isBlankNote(note)).slice(0, PERSONAL_NOTES_MAX_ROWS);
}

/**
 * Display rows: saved entries first (in order), blank editable slots filling
 * the rest up to the default slot count. More saved entries than the default
 * are all shown (up to the max).
 */
export function padNoteRows(notes: PersonalNote[]): PersonalNote[] {
  const entries = parsePersonalNotes(notes).slice(0, PERSONAL_NOTES_MAX_ROWS);
  const rows = [...entries];
  while (rows.length < PERSONAL_NOTES_DEFAULT_SLOTS) rows.push(createPersonalNote());
  return rows;
}

export function loadLocalPersonalNotes(userId: string | null): PersonalNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(personalNotesStorageKey(userId));
    if (!raw) return [];
    return parsePersonalNotes(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveLocalPersonalNotes(userId: string | null, notes: PersonalNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      personalNotesStorageKey(userId),
      JSON.stringify(cleanPersonalNotes(notes)),
    );
  } catch {
    // ignore quota / private mode
  }
}

/** Returns the saved notes, or null when there is no row yet / load failed. */
export async function loadCloudPersonalNotes(userId: string): Promise<PersonalNote[] | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(USER_NOTES_TABLE)
    .select("notes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Personal notes load failed:", error.message);
    return null;
  }
  if (!data) return null;
  return parsePersonalNotes((data as { notes?: unknown }).notes);
}

export async function saveCloudPersonalNotes(
  userId: string,
  notes: PersonalNote[],
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from(USER_NOTES_TABLE).upsert(
    {
      user_id: userId,
      notes: cleanPersonalNotes(notes),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("Personal notes save failed:", error.message);
    return false;
  }
  return true;
}
