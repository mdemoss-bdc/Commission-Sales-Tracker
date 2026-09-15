"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addVehicleType, removeVehicleType, renameVehicleType } from "@/lib/vehicles";
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
          ? "The Deal Type dropdown uses this list. Add New, Used, Honda, Volkswagen, Lease Buyout, or any category you sell."
          : "These names appear in the Deal Type column on every sales sheet. Add the makes or categories you sell — New, Used, Honda, Volkswagen, Lease Buyout, or anything else."}
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
