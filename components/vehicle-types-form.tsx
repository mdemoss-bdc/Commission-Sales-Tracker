"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addVehicleType,
  removeVehicleType,
  renameVehicleType,
  setVehicleTypeExcludeFromUnitCount,
} from "@/lib/vehicles";
import type { VehicleTypeOption } from "@/lib/types";

type VehicleTypesFormProps = {
  types: VehicleTypeOption[];
  onChange: (types: VehicleTypeOption[]) => void;
  compact?: boolean;
};

export function VehicleTypesForm({ types, onChange, compact = false }: VehicleTypesFormProps) {
  const [draft, setDraft] = useState("");

  function handleAdd() {
    const next = addVehicleType(types, draft);
    if (next === types) return;
    onChange(next);
    setDraft("");
  }

  return (
    <section className="summary-card vehicle-types-card">
      <h2>Vehicle types</h2>
      <p className="empty-note">
        {compact
          ? "The Deal Type dropdown uses this list. Mark types to exclude from unit count when needed (earnings still count)."
          : "These names appear in the Deal Type column on every sales sheet. Toggle Exclude from unit count for types like Street Purchase that should not raise pack volume."}
      </p>
      {types.length === 0 ? (
        <p className="empty-note">No types yet. Add one below, then pick it on each deal.</p>
      ) : (
        <ul className="vehicle-type-list">
          {types.map((type, index) => (
            <li key={type.id} className="vehicle-type-row">
              <input
                aria-label={`Vehicle type ${index + 1}`}
                value={type.label}
                onChange={(event) => onChange(renameVehicleType(types, type.id, event.target.value))}
                className="sheet-input"
              />
              <label className="check-cell" style={{ display: "flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  aria-label={`Exclude ${type.label || `vehicle type ${index + 1}`} from unit count`}
                  checked={Boolean(type.excludeFromUnitCount)}
                  onChange={(event) =>
                    onChange(setVehicleTypeExcludeFromUnitCount(types, type.id, event.target.checked))
                  }
                />
                <span className="empty-note" style={{ margin: 0 }}>
                  Exclude from unit count
                </span>
              </label>
              <button
                type="button"
                aria-label={`Remove ${type.label || `vehicle type ${index + 1}`}`}
                onClick={() => onChange(removeVehicleType(types, type.id))}
                className="remove-btn"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="vehicle-type-add"
        onSubmit={(event) => {
          event.preventDefault();
          handleAdd();
        }}
      >
        <input
          aria-label="New vehicle type"
          placeholder="Add a vehicle type"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="sheet-input"
        />
        <Button
          type="submit"
          variant="outline"
          onClick={(event) => {
            event.preventDefault();
            handleAdd();
          }}
        >
          <Plus data-icon="inline-start" />
          Add type
        </Button>
      </form>
    </section>
  );
}
