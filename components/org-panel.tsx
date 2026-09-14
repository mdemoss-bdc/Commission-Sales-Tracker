"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retryCloudSync } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { canManageOrg, canReviewDeals, roleLabel, type UserRole } from "@/lib/roles";
import { diffPayloads, editedPayload, originalPayload, payloadLabel } from "@/lib/deal-records";

export function OrgPanel() {
  const org = useOrg();
  const { addLocation, assignPerson, approveDeal, rejectDeal } = useOrgActions();
  const [locationName, setLocationName] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
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

  async function handleApprove(id: string) {
    setBusy(true);
    setError("");
    const message = await approveDeal(id);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    retryCloudSync();
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) {
      setError("Add a reject reason.");
      return;
    }
    setBusy(true);
    setError("");
    const message = await rejectDeal(id, rejectReason.trim());
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    retryCloudSync();
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
          . There is only one admin, who assigns managers and employees to locations. Managers only
          see reps at their store.
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
            Only the admin can promote someone to manager or assign them to a location. There can
            never be a second admin.
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

      {reviewer && !admin ? (
        <section className="summary-card no-print">
          <h2>Your store</h2>
          <p className="empty-note">
            You can review reps at{" "}
            {org.locations.find((item) => item.id === org.profile?.location_id)?.name ?? "your location"}{" "}
            only.
          </p>
          <ul className="org-list">
            {org.people
              .filter((person) => person.role === "rep")
              .map((person) => (
                <li key={person.id}>{person.full_name || person.email}</li>
              ))}
          </ul>
        </section>
      ) : null}

      {reviewer ? (
        <section className="summary-card no-print">
          <h2>Approval required</h2>
          <p className="empty-note">
            These are manager submissions a rep changed. Approve merges the edit into live records.
            Reject sends it back with a reason.
          </p>
          {org.pending.length === 0 ? (
            <p className="empty-note">No changed deals waiting on you.</p>
          ) : (
            <ul className="org-list">
              {org.pending.map((row) => {
                const original = originalPayload(row);
                const edited = editedPayload(row);
                const diffs = diffPayloads(original, edited);
                const person = org.people.find((item) => item.id === row.rep_id);
                return (
                  <li key={row.id} className="approval-card">
                    <div>
                      <strong>{payloadLabel(edited)}</strong>
                      <p className="empty-note">
                        {person?.full_name || person?.email || "Rep"} · original vs rep edit
                      </p>
                      {diffs.length === 0 ? (
                        <p className="empty-note">No field-level changes detected.</p>
                      ) : (
                        <table className="mini-sheet diff-table">
                          <thead>
                            <tr>
                              <th scope="col">Field</th>
                              <th scope="col">Original</th>
                              <th scope="col">Rep edit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diffs.map((diff) => (
                              <tr key={diff.label}>
                                <th scope="row">{diff.label}</th>
                                <td>{diff.before}</td>
                                <td>{diff.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div className="cloud-setup-actions">
                      <Button size="sm" disabled={busy} onClick={() => void handleApprove(row.id)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRejectingId(row.id)}
                      >
                        Reject
                      </Button>
                    </div>
                    {rejectingId === row.id ? (
                      <form
                        className="auth-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleReject(row.id);
                        }}
                      >
                        <label>
                          Reject reason
                          <Input
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            placeholder="Why this should go back to the rep"
                            required
                          />
                        </label>
                        <Button type="submit" variant="destructive" disabled={busy}>
                          Confirm reject
                        </Button>
                      </form>
                    ) : null}
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
