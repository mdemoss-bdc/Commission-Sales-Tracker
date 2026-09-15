"use client";

import { useState, type FormEvent } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retryCloudSync } from "@/lib/tracker-store";
import { dealsForView, peopleForView, useOrg, useOrgActions } from "@/lib/org-store";
import { StoreFilterBar } from "@/components/location-filter";
import { PersonIdentity } from "@/components/person-identity";
import { DeleteUserModal } from "@/components/delete-user-modal";
import { ApprovalSheetModal, type ApprovalMode } from "@/components/approval-sheet-modal";
import { displayName } from "@/lib/names";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { canEditPersonRole, canManageOrg, canReviewDeals, roleLabel, type UserProfile, type UserRole } from "@/lib/roles";
import { assignmentUpdatedMessage, resolvedAssignmentLocation } from "@/lib/assignment";
import { groupApprovalSheets, type ApprovalSheetGroup } from "@/lib/approval-sheet";
import { lastSubmittedLabel, latestRowByRep } from "@/lib/latest-submission";
import { managerSubmissionRows } from "@/lib/manager-status";
import { ManagerSubmissionsTracker } from "@/components/manager-submissions-tracker";
import { OrganizationCodeCard } from "@/components/organization-code-card";
import { OrganizationPayPlanCard } from "@/components/organization-pay-plan-card";
import { rosterBadgeLabel } from "@/lib/roster";

export function OrgPanel() {
  const org = useOrg();
  const {
    addLocation,
    removeLocation,
    assignPerson,
    deletePerson,
    forwardSheet,
    rejectSheet,
    authorizeRepReady,
  } = useOrgActions();
  const [locationName, setLocationName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedPersonId, setSavedPersonId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [pendingDelete, setPendingDelete] = useState<UserProfile | null>(null);
  const [openSheet, setOpenSheet] = useState<{ group: ApprovalSheetGroup; mode: ApprovalMode } | null>(null);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);

  if (!org.ready || !org.profile) return null;

  const selfId = org.profile.id;
  const admin = canManageOrg(org.profile.role);
  const reviewer = canReviewDeals(org.profile.role);
  const people = peopleForView(org);
  const pending = dealsForView(org, org.pending);
  const allDeals = dealsForView(org, org.allDeals);
  const managerSheets = groupApprovalSheets(pending, allDeals);
  const managerStores = managerSubmissionRows(org.locations, org.people, org.allDeals);
  const stores = [...org.locations].sort((a, b) => a.name.localeCompare(b.name));
  const storeSelected = hasStoreSelection(org.locationFilterId);
  const openPerson = openSheet ? org.people.find((item) => item.id === openSheet.group.repId) : null;

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

  async function handleRemoveLocation(id: string, name: string) {
    if (!window.confirm(`Remove ${name}? People at that store become Unassigned.`)) return;
    setBusy(true);
    setError("");
    const message = await removeLocation(id);
    setBusy(false);
    if (message) setError(message);
  }

  function showSaved(userId: string, note: string) {
    setSavedPersonId(userId);
    setToast(note);
    window.setTimeout(() => {
      setSavedPersonId((current) => (current === userId ? null : current));
      setToast((current) => (current === note ? "" : current));
    }, 2200);
  }

  async function handleDeleteAccount() {
    if (!pendingDelete) return;
    setBusy(true);
    setError("");
    const message = await deletePerson(pendingDelete.id);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setPendingDelete(null);
    setToast("User deleted successfully");
    window.setTimeout(() => {
      setToast((current) => (current === "User deleted successfully" ? "" : current));
    }, 2200);
  }

  async function handleAssignment(
    person: UserProfile,
    patch: { role?: UserRole; location_id?: string | null },
    select?: HTMLSelectElement,
  ) {
    const nextRole = patch.role ?? person.role;
    if (patch.role && patch.role === person.role) return true;
    if (patch.location_id !== undefined && patch.location_id === person.location_id) return true;
    const resolved = resolvedAssignmentLocation({
      currentLocationId: person.location_id,
      nextLocationId: patch.location_id,
      storeFilterId: org.locationFilterId,
      nextRole,
    });
    if (resolved.error) {
      if (select && patch.role) select.value = person.role;
      setError(resolved.error);
      return false;
    }
    setBusy(true);
    setError("");
    const message = await assignPerson(person.id, {
      role: nextRole,
      location_id: resolved.locationId,
    });
    setBusy(false);
    if (message) {
      if (select && patch.role) select.value = person.role;
      setError(message);
      return false;
    }
    showSaved(person.id, assignmentUpdatedMessage(displayName(person)));
    return true;
  }

  async function handleForward(group: ApprovalSheetGroup) {
    setBusy(true);
    setError("");
    const message = await forwardSheet(group.recordIds);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpenSheet(null);
    retryCloudSync();
  }

  async function handleAuthorizeRep(repId: string) {
    setBusyRepId(repId);
    setError("");
    const message = await authorizeRepReady(repId);
    setBusyRepId(null);
    if (message) {
      setError(message);
      return;
    }
    retryCloudSync();
  }

  async function handleRejectSheet(group: ApprovalSheetGroup, reason: string) {
    setBusy(true);
    setError("");
    const message = await rejectSheet(group.recordIds, reason);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpenSheet(null);
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
              : ". Ask an admin to assign your store."}
          . Any admin can promote another person to admin without losing their own admin role. Managers only see
          people, staged deals, and pending approvals at their assigned store. Manager approval is final: Push All
          locks that store’s sheets into live records.
        </p>
      </section>

      {admin ? <OrganizationCodeCard /> : null}
      {admin ? <OrganizationPayPlanCard /> : null}

      {admin ? (
        <section className="summary-card no-print">
          <h2>Locations</h2>
          <p className="empty-note">Stores that managers and reps can be assigned to.</p>
          {stores.length === 0 ? (
            <p className="empty-note">No locations yet. Add Morgantown, Nissan, Supercenter, or any store below.</p>
          ) : (
            <ul className="location-chips">
              {stores.map((location) => (
                <li key={location.id} className="location-chip">
                  <span>{location.name}</span>
                  <button
                    type="button"
                    className="location-chip-remove"
                    aria-label={`Remove ${location.name}`}
                    disabled={busy}
                    onClick={() => void handleRemoveLocation(location.id, location.name)}
                  >
                    <X />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="auth-form" onSubmit={(event) => void handleAddLocation(event)}>
            <label>
              New location
              <Input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="Morgantown"
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
            Any admin can change another person’s role, assign a location, or delete an account. Role and Location
            save together, including when you promote someone to Manager. Your own role dropdown stays locked so you
            cannot demote yourself.
          </p>
          <StoreFilterBar
            countNote={
              storeSelected
                ? storeFilterSummary(
                    people.length,
                    org.locationFilterId,
                    stores.find((store) => store.id === org.locationFilterId)?.name,
                  )
                : undefined
            }
          />
          {!storeSelected ? (
            <p className="store-select-prompt">Select a dealership store above to manage users.</p>
          ) : people.length === 0 ? (
            <p className="empty-note">
              {org.people.length === 0
                ? "No profiles yet."
                : "No people match this store filter."}
            </p>
          ) : (
            <table className="mini-sheet org-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Location</th>
                  <th scope="col" className="person-actions-col">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id}>
                    <th scope="row">
                      <PersonIdentity person={person} />
                    </th>
                    <td>
                      <select
                        value={person.role}
                        disabled={busy || !canEditPersonRole(org.profile, person)}
                        aria-label={`Role for ${displayName(person)}`}
                        onChange={(event) => {
                          const role = event.target.value as UserRole;
                          void handleAssignment(person, { role }, event.currentTarget);
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="rep">Sales Rep</option>
                      </select>
                    </td>
                    <td>
                      <div className="location-assign">
                        <select
                          value={person.location_id ?? ""}
                          disabled={busy}
                          aria-label={`Location for ${displayName(person)}`}
                          onChange={(event) => {
                            const previous = person.location_id ?? "";
                            const select = event.currentTarget;
                            void handleAssignment(person, {
                              location_id: select.value || null,
                            }).then((ok) => {
                              if (!ok) select.value = previous;
                            });
                          }}
                        >
                          <option value="">Unassigned</option>
                          {stores.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </select>
                        {savedPersonId === person.id ? (
                          <Check className="location-saved" aria-label="Assignment updated" />
                        ) : null}
                      </div>
                    </td>
                    <td className="person-actions-col">
                      {person.id === selfId ? null : (
                        <button
                          type="button"
                          className="person-delete-btn"
                          aria-label={`Delete ${displayName(person)}`}
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setPendingDelete(person);
                          }}
                        >
                          <Trash2 />
                        </button>
                      )}
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
            You can review people and deals at{" "}
            {org.locations.find((item) => item.id === org.profile?.location_id)?.name ?? "your location"}{" "}
            only. Other stores stay hidden.
          </p>
          {org.people.length === 0 ? (
            <p className="empty-note">
              {org.profile.location_id
                ? "No one else is assigned to this store yet."
                : "Ask an admin to assign you to a store so you can see that store’s people and deals."}
            </p>
          ) : (
            <ul className="org-list">
              {org.people.map((person) => (
                <li key={person.id}>
                  <PersonIdentity person={person} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {reviewer && !admin ? (
        <section className="summary-card no-print">
          <h2>Waiting on employee review</h2>
          <p className="empty-note">
            Admin and manager pushes show here as Awaiting Employee Review until the sales rep confirms the stacked
            worksheet. Track progress, or use Authorize / Skip for Rep if they cannot complete review.
          </p>
          {dealsForView(org, org.waitingOnRep).length === 0 ? (
            <p className="empty-note">No pushed sheets are waiting on a sales rep.</p>
          ) : (
            <ul className="org-list">
              {latestRowByRep(dealsForView(org, org.waitingOnRep)).map((row) => {
                const person = org.people.find((item) => item.id === row.rep_id);
                return (
                  <li key={row.rep_id} className="approval-card">
                    <div>
                      {person ? <PersonIdentity person={person} /> : <strong>Rep</strong>}
                      <p className="empty-note">{lastSubmittedLabel(row.updated_at || row.created_at)}</p>
                    </div>
                    <div className="cloud-setup-actions">
                      <span className="roster-badge roster-badge-awaiting">{rosterBadgeLabel("awaiting")}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || busyRepId === row.rep_id}
                        onClick={() => void handleAuthorizeRep(row.rep_id)}
                      >
                        {busyRepId === row.rep_id ? "Authorizing…" : "Authorize / Skip for Rep"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {reviewer && !admin ? (
        <section className="summary-card no-print">
          <h2>Approval required</h2>
          <p className="empty-note">
            Open a submission to see that rep’s full sheet. Cells the employee changed or added are highlighted in red.
            Approve locks the sheet into live records. Reject sends it back with a reason. Push All on the roster
            finalizes every ready sheet at this store.
          </p>
          {managerSheets.length === 0 ? (
            <p className="empty-note">No sheets waiting on manager approval.</p>
          ) : (
            <ul className="org-list">
              {managerSheets.map((group) => {
                const person = org.people.find((item) => item.id === group.repId);
                return (
                  <li key={group.key} className="approval-card">
                    <div>
                      {person ? <PersonIdentity person={person} /> : <strong>Rep</strong>}
                      <p className="empty-note">{lastSubmittedLabel(group.lastSubmittedAt)}</p>
                      <p className="empty-note">
                        {group.title}
                        {group.changedCount > 0 ? ` · ${group.changedCount} changed cell${group.changedCount === 1 ? "" : "s"}` : " · no cell-level changes"}
                      </p>
                    </div>
                    <div className="cloud-setup-actions">
                      <Button size="sm" disabled={busy} onClick={() => setOpenSheet({ group, mode: "manager" })}>
                        Open sheet
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {admin ? <ManagerSubmissionsTracker rows={managerStores} /> : null}

      {error ? <p className="form-error">{error}</p> : null}
      {toast ? (
        <p className="update-toast" role="status">
          {toast}
        </p>
      ) : null}
      <DeleteUserModal
        person={pendingDelete}
        busy={busy && pendingDelete !== null}
        error={pendingDelete ? error : ""}
        onCancel={() => {
          if (!busy) setPendingDelete(null);
        }}
        onConfirm={() => void handleDeleteAccount()}
      />
      {openSheet ? (
        <ApprovalSheetModal
          group={openSheet.group}
          mode={openSheet.mode}
          repName={openPerson ? displayName(openPerson) : "Rep"}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) setOpenSheet(null);
          }}
          onApprove={() => void handleForward(openSheet.group)}
          onReject={(reason) => void handleRejectSheet(openSheet.group, reason)}
        />
      ) : null}
    </>
  );
}
