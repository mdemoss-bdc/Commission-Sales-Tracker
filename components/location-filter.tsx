"use client";

import { setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { setLocationFilter, useOrg } from "@/lib/org-store";
import { canManageOrg } from "@/lib/roles";
import { UNASSIGNED_STORE_FILTER, matchesLocationFilter } from "@/lib/locations";

export function StoreFilterBar({ countNote }: { countNote?: string }) {
  const org = useOrg();
  const entryRepId = useEntryRepId();
  if (!canManageOrg(org.profile?.role)) return null;

  const stores = [...org.locations].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="store-filter-bar no-print">
      <label>
        Filter by Store:
        <select
          value={org.locationFilterId ?? ""}
          onChange={(event) => {
            const next = event.target.value || null;
            setLocationFilter(next);
            if (!entryRepId) return;
            const selected = org.people.find((person) => person.id === entryRepId);
            if (selected && !matchesLocationFilter(selected.location_id, next)) {
              setEntryRepId(null);
            }
          }}
          aria-label="Filter by store"
        >
          <option value="">All Stores</option>
          <option value={UNASSIGNED_STORE_FILTER}>Unassigned</option>
          {stores.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      {countNote ? <p className="store-filter-count">{countNote}</p> : null}
    </div>
  );
}
