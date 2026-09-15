"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { getAvailableOrgLocations } from "@/lib/org";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { activeStoreChangedMessage } from "@/lib/assignment";
import { setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { matchesLocationFilter } from "@/lib/locations";
import type { LocationRecord } from "@/lib/roles";

export function ActiveStorePicker() {
  const org = useOrg();
  const { switchOwnLocation } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [stores, setStores] = useState<LocationRecord[]>(org.locations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    setStores([...org.locations].sort((a, b) => a.name.localeCompare(b.name)));
  }, [org.locations]);

  useEffect(() => {
    let cancelled = false;
    void getAvailableOrgLocations().then((rows) => {
      if (cancelled) return;
      setStores([...rows].sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      cancelled = true;
    };
  }, [org.profile?.org_id, org.locations.length]);

  if (!org.profile) return null;

  const currentId = org.profile.location_id ?? "";
  const noStores = stores.length === 0;

  async function handleChange(nextId: string) {
    if (!nextId || nextId === currentId) return;
    const store = stores.find((item) => item.id === nextId);
    if (!store) return;
    setBusy(true);
    setError("");
    const message = await switchOwnLocation(nextId);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    if (entryRepId) {
      const selected = org.people.find((person) => person.id === entryRepId);
      if (selected && !matchesLocationFilter(selected.location_id, nextId)) {
        setEntryRepId(null);
      }
    }
    const note = activeStoreChangedMessage(store.name);
    setToast(note);
    window.setTimeout(() => {
      setToast((current) => (current === note ? "" : current));
    }, 2800);
  }

  return (
    <div className="store-picker">
      <label className="store-picker-label">
        <MapPin aria-hidden="true" />
        <span>Store:</span>
        <select
          value={stores.some((store) => store.id === currentId) ? currentId : ""}
          disabled={busy || noStores}
          aria-label="Active store"
          onChange={(event) => {
            void handleChange(event.target.value);
          }}
        >
          {noStores ? (
            <option value="">No stores yet</option>
          ) : stores.some((store) => store.id === currentId) ? null : (
            <option value="" disabled>
              Select a store
            </option>
          )}
          {stores.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      {toast ? (
        <p className="store-picker-toast" role="status">
          {toast}
        </p>
      ) : null}
      {error ? (
        <p className="store-picker-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
