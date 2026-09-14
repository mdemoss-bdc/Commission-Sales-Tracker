"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { canManageOrg, canReviewDeals, roleLabel, type UserRole } from "@/lib/roles";
import { workingPayload } from "@/lib/deal-records";

export function OrgPanel() {
  const org = useOrg();
  const { addLocation, assignPerson, decideDeal } = useOrgActions();
  const [locationName, setLocationName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!org.ready || !org.profile) return null;

  const admin = canManageOrg(org.profile.role);
  const reviewer = canReviewDeals(org.profile.role);

  async function handleAddLocation(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const message = await addLocation(locationName);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setLocationName("");
  }

  async function handleAssign(userId: string, patch: { role?: UserRole; location_id?: string | null }) {
    setBusy(true);
    setError("");
    const message = await assignPerson(userId, patch);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <>
      <section className="summary-card no-print">
        <h2>Your role</h2>
        <p className="empty-note">
          Signed in as {roleLabel(org.profile.role)}
          {org.profile.location_id
            ? ` at ${org.locations.find((item) => item.id === org.profile?.location_id)?.name ?? "an assigned store"}`
            : admin
              ? ". Create stores below, then assign managers and reps."
              : ". Ask the admin to assign your store."}
          . The first account on this project is the only admin.
        </p>
      </section>

      {admin ? (
        <section className="summary-card no-print">
          <h2>Locations</h2>
          <p className="empty-note">Stores that managers and reps can be assigned to.</p>
          {org.locations.length === 0 ? (
            <p className="empty-note">No locations yet.</p>
          ) : (
            <ul className="org-list">
              {org.locations.map((location) => (
                <li key={location.id}>{location.name}</li>
              ))}
            </ul>
          )}
          <form className="auth-form" onSubmit={(event) => void handleAddLocation(event)}>
            <label>
              New location
              <Input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="North store"
                required
              />
            </label>
            <Button type="submit" disabled={busy}>
              Add location
            </Button>
          </form>
        </section>
      ) : null}

      {admin ? (
        <section className="summary-card no-print">
          <h2>People</h2>
          <p className="empty-note">
            Assign each salesperson a store and a role. There can only be one admin.
          </p>
          {org.people.length === 0 ? (
            <p className="empty-note">No profiles yet.</p>
          ) : (
            <table className="mini-sheet org-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {org.people.map((person) => (
                  <tr key={person.id}>
                    <th scope="row">{person.full_name || person.email}</th>
                    <td>
                      {person.role === "admin" ? (
                        "Admin"
                      ) : (
                        <select
                          value={person.role}
                          disabled={busy}
                          onChange={(event) =>
                            void handleAssign(person.id, { role: event.target.value as UserRole })
                          }
                        >
                          <option value="rep">Sales rep</option>
                          <option value="manager">Manager</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <select
                        value={person.location_id ?? ""}
                        disabled={busy || person.role === "admin"}
                        onChange={(event) =>
                          void handleAssign(person.id, {
                            location_id: event.target.value || null,
                          })
                        }
                      >
                        <option value="">Unassigned</option>
                        {org.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {reviewer ? (
        <section className="summary-card no-print">
          <h2>Pending manager approval</h2>
          {org.pending.length === 0 ? (
            <p className="empty-note">No staged deals waiting on you.</p>
          ) : (
            <ul className="org-list">
              {org.pending.map((row) => {
                const payload = workingPayload(row);
                const sale = payload?.kind === "sale" ? payload.sale : null;
                const person = org.people.find((item) => item.id === row.rep_id);
                const label = sale
                  ? `${sale.stockNumber || "No stock"} · ${sale.customerName || "No customer"}`
                  : payload?.kind === "sheet"
                    ? "Worksheet extras"
                    : payload?.kind === "vehicle_type"
                      ? `Vehicle type ${payload.vehicleType?.label ?? ""}`
                      : "Record";
                return (
                  <li key={row.id} className="approval-row">
                    <div>
                      <strong>{label}</strong>
                      <p className="empty-note">
                        {person?.full_name || person?.email || "Rep"}
                        {sale ? ` · Gross ${sale.gross}` : ""}
                      </p>
                    </div>
                    <div className="cloud-setup-actions">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void decideDeal(row.id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void decideDeal(row.id, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </>
  );
}
