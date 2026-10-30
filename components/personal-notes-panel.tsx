"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/use-auth-session";
import {
  PERSONAL_NOTES_MAX_ROWS,
  createPersonalNote,
  loadCloudPersonalNotes,
  loadLocalPersonalNotes,
  padNoteRows,
  parsePersonalNotes,
  saveCloudPersonalNotes,
  saveLocalPersonalNotes,
  type PersonalNote,
  type StoredPersonalNotes,
} from "@/lib/personal-notes";

const SAVE_DEBOUNCE_MS = 500;

/** Canonical form for change detection: parsed rows, exactly as displayed. */
function canonicalJson(notes: PersonalNote[]): string {
  return JSON.stringify(parsePersonalNotes(notes));
}

/**
 * Rows to render for a stored value. Exact (v2) values render as saved —
 * blank slots included, so deletions stick. Legacy values pad out to the
 * default slot count one last time.
 */
function displayRows(stored: StoredPersonalNotes): PersonalNote[] {
  if (stored.exact) return stored.notes.length > 0 ? stored.notes : [createPersonalNote()];
  return padNoteRows(stored.notes);
}

/**
 * Personal notes — one private label/value list per user, shown beside the
 * green sheet header on every pay sheet. Stored outside TrackerState (see
 * lib/personal-notes.ts), so it can never enter the office sheet, the
 * submit-to-manager payload, comparisons, or print (note the no-print class).
 */
export function PersonalNotesPanel() {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const [rows, setRows] = useState<PersonalNote[]>(() => padNoteRows([]));
  const hydratedForRef = useRef<string | null>(null);
  // Set on the first local edit: a late cloud load must never overwrite rows
  // the user has already started typing in.
  const dirtyRef = useRef(false);
  const savedJsonRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load: local mirror first (instant), then the cloud row when signed in.
  useEffect(() => {
    const key = userId ?? "guest";
    if (hydratedForRef.current === key) return;
    hydratedForRef.current = key;
    dirtyRef.current = false;
    const localStored = loadLocalPersonalNotes(userId);
    const localDisplay = displayRows(localStored);
    savedJsonRef.current = canonicalJson(localDisplay);
    setRows(localDisplay);
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const cloudStored = await loadCloudPersonalNotes(userId);
      if (cancelled || cloudStored === null) return;
      // The user started typing while the cloud row was in flight: keep their
      // rows. The debounced save below pushes the local notes up instead.
      if (dirtyRef.current) return;
      if (cloudStored.notes.length > 0 || localStored.notes.length === 0) {
        const cloudDisplay = displayRows(cloudStored);
        savedJsonRef.current = canonicalJson(cloudDisplay);
        saveLocalPersonalNotes(userId, cloudDisplay);
        setRows(cloudDisplay);
      } else {
        // First sign-in on a device with local notes: lift them to the cloud.
        void saveCloudPersonalNotes(userId, localDisplay);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Save: debounced, on every edit. Rows persist exactly as displayed —
  // blank slots included — so a deleted row stays deleted.
  useEffect(() => {
    if (hydratedForRef.current === null) return;
    const canonical = parsePersonalNotes(rows);
    const json = JSON.stringify(canonical);
    if (json === savedJsonRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savedJsonRef.current = json;
      saveLocalPersonalNotes(userId, canonical);
      if (userId) void saveCloudPersonalNotes(userId, canonical);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [rows, userId]);

  function updateRow(id: string, patch: Partial<PersonalNote>) {
    dirtyRef.current = true;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    dirtyRef.current = true;
    setRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length > 0 ? next : [createPersonalNote()];
    });
  }

  function addRow() {
    dirtyRef.current = true;
    setRows((current) =>
      current.length >= PERSONAL_NOTES_MAX_ROWS ? current : [...current, createPersonalNote()],
    );
  }

  return (
    <section
      className="summary-card personal-notes-card no-print w-full shrink-0 lg:w-[360px]"
      aria-label="Personal notes"
    >
      <h2>Personal notes</h2>
      <p className="empty-note" style={{ marginTop: "0.25rem" }}>
        Private to you — shows on all your sheets, never submitted or printed.
      </p>
      <div className="personal-notes-rows" style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.6rem" }}>
        {rows.map((row, index) => (
          <div key={row.id} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              aria-label={`Note ${index + 1} label`}
              placeholder="Label"
              value={row.label}
              onChange={(event) => updateRow(row.id, { label: event.target.value })}
              className="personal-notes-input"
              style={{ flex: 2, minWidth: 0 }}
            />
            <input
              aria-label={`Note ${index + 1} value`}
              placeholder="Value"
              value={row.value}
              onChange={(event) => updateRow(row.id, { value: event.target.value })}
              className="personal-notes-input"
              style={{ flex: 3, minWidth: 0 }}
            />
            <button
              type="button"
              aria-label={`Remove note ${index + 1}`}
              onClick={() => removeRow(row.id)}
              className="remove-btn"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {rows.length < PERSONAL_NOTES_MAX_ROWS ? (
        <div style={{ marginTop: "0.6rem" }}>
          <Button type="button" variant="outline" onClick={addRow}>
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        </div>
      ) : null}
    </section>
  );
}
