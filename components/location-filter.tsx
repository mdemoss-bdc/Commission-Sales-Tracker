"use client";

import { setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { setLocationFilter, useOrg } from "@/lib/org-store";
import { canManageOrg } from "@/lib/roles";
import { locationFilterLabel } from "@/lib/locations";

export function LocationFilter() {
  const org = useOrg();
  const entryRepId = useEntryRepId();
  if (!canManageOrg(org.profile?.role) || org.locations.length === 0) return null;

  return (
    <label className="location-filter no-print">
      Store
      <select
        value={org.locationFilterId ?? ""}
        onChange={(event) => {
          const next = event.target.value || null;
          setLocationFilter(next);
          if (!entryRepId || !next) return;
          const selected = org.people.find((person) => person.id === entryRepId);
          if (selected && selected.location_id !== next) setEntryRepId(null);
        }}
        aria-label="Filter by location"
      >
        <option value="">All Locations</option>
        {org.locations.map((location) => (
          <option key={location.id} value={location.id}>
            {locationFilterLabel(location.name)}
          </option>
        ))}
      </select>
    </label>
  );
}
