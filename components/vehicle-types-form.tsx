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
      <p className="empty-note vehicle-types-lead">
        {compact
          ? "Deal Type dropdown list. “Exclude Unit” keeps earnings but skips pack volume."
          : "Names for the Deal Type column. Mark Exclude Unit when a type should not raise unit count."}
      </p>
      {types.length === 0 ? (
        <p className="empty-note">No types yet. Add one below, then pick it on each deal.</p>
      ) : (
        <ul className="vehicle-type-list">
          {types.map((type, index) => {
            const label = type.label.trim() || `vehicle type ${index + 1}`;
            return (
              <li
                key={type.id}
                className="vehicle-type-row flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 mb-1.5 transition-colors hover:bg-slate-50"
              >
                <input
                  aria-label={`Vehicle type ${index + 1}`}
                  value={type.label}
                  onChange={(event) => onChange(renameVehicleType(types, type.id, event.target.value))}
                  className="vehicle-type-name min-w-0 flex-1 bg-transparent py-0.5 text-sm font-medium text-slate-800 outline-none border-b border-transparent focus:border-emerald-500"
                />
                <label
                  className="vehicle-type-exclude flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500"
                  title="Excluded from unit count — earnings still count"
                >
                  <input
                    type="checkbox"
                    aria-label={`Exclude ${label} from unit count`}
                    checked={Boolean(type.excludeFromUnitCount)}
                    onChange={(event) =>
                      onChange(setVehicleTypeExcludeFromUnitCount(types, type.id, event.target.checked))
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Exclude Unit</span>
                </label>
                <button
                  type="button"
                  title="Delete type"
                  aria-label={`Remove ${label}`}
                  onClick={() => onChange(removeVehicleType(types, type.id))}
                  className="vehicle-type-remove shrink-0 rounded p-1 text-slate-300 transition-colors hover:text-rose-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
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
          size="sm"
          onClick={(event) => {
            event.preventDefault();
            handleAdd();
          }}
        >
          <Plus data-icon="inline-start" />
          Add
        </Button>
      </form>
    </section>
  );
}
