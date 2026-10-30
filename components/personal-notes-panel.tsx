"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/use-auth-session";
import {
  PERSONAL_NOTES_MAX_ROWS,
  cleanPersonalNotes,
  createPersonalNote,
  loadCloudPersonalNotes,
  loadLocalPersonalNotes,
  padNoteRows,
  saveCloudPersonalNotes,
  saveLocalPersonalNotes,
  type PersonalNote,
} from "@/lib/personal-notes";

const SAVE_DEBOUNCE_MS = 500;

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
  const savedJsonRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load: local mirror first (instant), then the cloud row when signed in.
  useEffect(() => {
    const key = userId ?? "guest";
    if (hydratedForRef.current === key) return;
    hydratedForRef.current = key;
    const local = loadLocalPersonalNotes(userId);
    savedJsonRef.current = JSON.stringify(cleanPersonalNotes(local));
    setRows(padNoteRows(local));
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const cloud = await loadCloudPersonalNotes(userId);
      if (cancelled || cloud === null) return;
      if (cloud.length > 0 || local.length === 0) {
        savedJsonRef.current = JSON.stringify(cleanPersonalNotes(cloud));
        saveLocalPersonalNotes(userId, cloud);
        setRows(padNoteRows(cloud));
      } else {
        // First sign-in on a device with local notes: lift them to the cloud.
        void saveCloudPersonalNotes(userId, local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Save: debounced, on every edit. Fully-empty rows are dropped on save.
  useEffect(() => {
    if (hydratedForRef.current === null) return;
    const cleaned = cleanPersonalNotes(rows);
    const json = JSON.stringify(cleaned);
    if (json === savedJsonRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savedJsonRef.current = json;
      saveLocalPersonalNotes(userId, cleaned);
      if (userId) void saveCloudPersonalNotes(userId, cleaned);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [rows, userId]);

  function updateRow(id: string, patch: Partial<PersonalNote>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => padNoteRows(current.filter((row) => row.id !== id)));
  }

  function addRow() {
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
              className="sheet-input"
              style={{ flex: 2, minWidth: 0 }}
            />
            <input
              aria-label={`Note ${index + 1} value`}
              placeholder="Value"
              value={row.value}
              onChange={(event) => updateRow(row.id, { value: event.target.value })}
              className="sheet-input"
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
