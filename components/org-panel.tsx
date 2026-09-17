"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleCard } from "@/components/collapsible-card";
import { retryCloudSync, useTrackerStore } from "@/lib/tracker-store";
import { getSessionUser } from "@/lib/auth-session";
import { dealsForView, peopleForView, useOrg, useOrgActions } from "@/lib/org-store";
import { loadProfileById, resolveSalesRepId } from "@/lib/org";
import { StoreFilterBar } from "@/components/location-filter";
import { PersonIdentity } from "@/components/person-identity";
import { DeleteUserModal } from "@/components/delete-user-modal";
import { ApprovalSheetModal, type ApprovalMode } from "@/components/approval-sheet-modal";
import { displayName } from "@/lib/names";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { canEditPersonRole, canManageOrg, canReviewDeals, BUILT_IN_ROLE_OPTIONS, canAddCustomRole, parsePersonRoleSelect, personRoleLabel, personRoleSelectValue, type UserProfile, type UserRole } from "@/lib/roles";
import { assignmentUpdatedMessage, locationUpdatedMessage, resolvedAssignmentLocation } from "@/lib/assignment";
import { groupApprovalSheets, type ApprovalSheetGroup } from "@/lib/approval-sheet";
import { lastSubmittedLabel, latestRowByRep } from "@/lib/latest-submission";
import { ManagerSubmissionsTracker } from "@/components/manager-submissions-tracker";
import { OrganizationCodeCard } from "@/components/organization-code-card";
import { EmployeeOnboardingCard } from "@/components/employee-onboarding-card";
import { OrganizationPayPlanCard } from "@/components/organization-pay-plan-card";
import { rosterBadgeLabel } from "@/lib/roster";
import { isSyntheticPayTrackerDealId } from "@/lib/pay-tracker-state";
import { isUuid } from "@/lib/vehicles";

export function OrgPanel() {
  const org = useOrg();
  const {
    addLocation,
    removeLocation,
    assignPerson,
    assignPersonLocation,
    addCustomRole,
    deletePerson,
    forwardSheet,
    rejectSheet,
    authorizeRepReady,
    approveAndPushToAdmin,
    denyChanges,
  } = useOrgActions();
  const [state] = useTrackerStore();
  const [locationName, setLocationName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyPersonId, setBusyPersonId] = useState<string | null>(null);
  const [savedPersonId, setSavedPersonId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [pendingDelete, setPendingDelete] = useState<UserProfile | null>(null);
  const [openSheet, setOpenSheet] = useState<{ group: ApprovalSheetGroup; mode: ApprovalMode } | null>(null);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);
  const [fetchedRep, setFetchedRep] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!openSheet) {
      setFetchedRep(null);
      return;
    }
    const known = org.people.find((item) => item.id === openSheet.group.repId);
    if (known) {
      setFetchedRep(null);
      return;
    }
    let cancelled = false;
    void loadProfileById(openSheet.group.repId).then((person) => {
      if (!cancelled) setFetchedRep(person);
    });
    return () => {
      cancelled = true;
    };
  }, [openSheet, org.people]);

  if (!org.ready || org.isLoadingProfile || !org.profile) return null;

  const selfId = getSessionUser()?.id ?? org.profile.id;
  const admin = canManageOrg(org.profile.role);
  const reviewer = canReviewDeals(org.profile.role);
  const people = peopleForView(org);
  const pending = dealsForView(org, org.pending);
  const allDeals = dealsForView(org, org.allDeals);
  const extraVehicleTypes = [
    ...(state.vehicleTypes ?? []),
    ...org.approvalChains.flatMap((chain) => [
      ...(chain.adminBaseline?.vehicleTypes ?? []),
      ...(chain.repDraft?.vehicleTypes ?? []),
    ]),
  ];
  const managerSheets = groupApprovalSheets(pending, allDeals, extraVehicleTypes);
  const stores = [...org.locations].sort((a, b) => a.name.localeCompare(b.name));
  const storeSelected = hasStoreSelection(org.locationFilterId);
  const localPerson = openSheet ? org.people.find((item) => item.id === openSheet.group.repId) : null;
  const openPerson = localPerson ?? fetchedRep;

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

  async function handleAddCustomRole(event: FormEvent) {
    event.preventDefault();
    const message = canAddCustomRole(newRoleName, org.customRoles);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError("");
    const result = await addCustomRole(newRoleName);
    setBusy(false);
    if (result) {
      setError(result);
      return;
    }
    setNewRoleName("");
    setToast("Role added.");
    window.setTimeout(() => {
      setToast((current) => (current === "Role added." ? "" : current));
    }, 2200);
  }

  async function handleAssignment(
    person: UserProfile,
    patch: { role?: UserRole; location_id?: string | null; custom_role_id?: string | null; custom_role_name?: string | null },
    select?: HTMLSelectElement,
  ) {
    const nextRole = patch.role ?? person.role;
    const nextCustomId = patch.custom_role_id !== undefined ? patch.custom_role_id : person.custom_role_id ?? null;
    const sameRole = patch.role === undefined || patch.role === person.role;
    const sameCustom = patch.custom_role_id === undefined || nextCustomId === (person.custom_role_id ?? null);
    const sameLocation = patch.location_id === undefined || patch.location_id === person.location_id;
    if (sameRole && sameCustom && sameLocation) return true;
    const resolved = resolvedAssignmentLocation({
      currentLocationId: person.location_id,
      nextLocationId: patch.location_id,
      storeFilterId: org.locationFilterId,
      nextRole,
    });
    if (resolved.error) {
      if (select) select.value = personRoleSelectValue(person);
      setError(resolved.error);
      return false;
    }
    setBusyPersonId(person.id);
    setError("");
    const message = await assignPerson(person.id, {
      role: nextRole,
      location_id: resolved.locationId,
      custom_role_id: nextCustomId,
      custom_role_name: patch.custom_role_name !== undefined ? patch.custom_role_name : person.custom_role_name ?? null,
    });
    setBusyPersonId(null);
    if (message) {
      if (select) select.value = personRoleSelectValue(person);
      setError(message);
      return false;
    }
    showSaved(person.id, assignmentUpdatedMessage(displayName(person)));
    return true;
  }

  async function handleLocationChange(
    person: UserProfile,
    nextLocationId: string | null,
    select: HTMLSelectElement,
  ) {
    if (nextLocationId === (person.location_id ?? null)) return true;
    const resolved = resolvedAssignmentLocation({
      currentLocationId: person.location_id,
      nextLocationId,
      nextRole: person.role,
    });
    if (resolved.error) {
      select.value = person.location_id ?? "";
      setError(resolved.error);
      return false;
    }
    setBusyPersonId(person.id);
    setError("");
    const message = await assignPersonLocation(person.id, resolved.locationId);
    setBusyPersonId(null);
    if (message) {
      select.value = person.location_id ?? "";
      setError(message);
      return false;
    }
    showSaved(person.id, locationUpdatedMessage(displayName(person)));
    return true;
  }

  async function handleForward(group: ApprovalSheetGroup) {
    setBusy(true);
    setError("");
    const resolvedId = await resolveSalesRepId(openPerson?.id || group.repId);
    const repId = resolvedId || openPerson?.id || group.repId;
    if (!repId) {
      setBusy(false);
      setError("Sales rep not found");
      return;
    }
    const dealIds = group.recordIds.filter((id) => isUuid(id) && !isSyntheticPayTrackerDealId(id));
    const message = dealIds.length > 0 ? await forwardSheet(dealIds) : await approveAndPushToAdmin(repId);
    if (!message && dealIds.length > 0) {
      const chainError = await approveAndPushToAdmin(repId);
      if (chainError && chainError !== "No pushed worksheet found for that sales rep.") {
        setBusy(false);
        setError(chainError);
        return;
      }
    }
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
    const resolvedId = await resolveSalesRepId(openPerson?.id || group.repId);
    const repId = resolvedId || openPerson?.id || group.repId;
    if (!repId) {
      setBusy(false);
      setError("Sales rep not found");
      return;
    }
    const dealIds = group.recordIds.filter((id) => isUuid(id) && !isSyntheticPayTrackerDealId(id));
    const message = dealIds.length > 0 ? await rejectSheet(dealIds, reason) : await denyChanges(repId, reason);
    if (!message && dealIds.length > 0) {
      const chainError = await denyChanges(repId, reason);
      if (chainError && chainError !== "Reject is only available when the employee submitted changes.") {
        setBusy(false);
        setError(chainError);
        return;
      }
    }
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
      {admin ? <OrganizationCodeCard /> : null}
      {admin ? <EmployeeOnboardingCard /> : null}
      {!admin ? (
        <CollapsibleCard title="Your role">
          <p className="empty-note">
            Signed in as {personRoleLabel(org.profile)}
            {org.profile.location_id
              ? ` at ${org.locations.find((item) => item.id === org.profile?.location_id)?.name ?? "an assigned store"}`
              : ". Ask an admin to assign your store."}
            . Managers only see people, staged deals, and pending approvals at their assigned store. Manager approval
            is final: Push All locks that store’s sheets into live records.
          </p>
        </CollapsibleCard>
      ) : null}

      {admin ? <OrganizationPayPlanCard /> : null}

      {admin ? (
        <CollapsibleCard title="Locations">
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
        </CollapsibleCard>
      ) : null}

      {admin ? (
        <CollapsibleCard title="People">
          <p className="empty-note">
            Any admin can promote or demote another person to Admin, Manager, or Sales Rep, assign a location, or delete an account. Role and Location
            save together, including when you promote someone to Manager. Custom roles also appear in this dropdown. Your own role dropdown stays locked so you
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
                        value={personRoleSelectValue(person)}
                        disabled={
                          busyPersonId === person.id ||
                          !canEditPersonRole(org.profile, person, selfId)
                        }
                        title={
                          person.id === selfId ? "You cannot change your own role." : undefined
                        }
                        aria-label={`Role for ${displayName(person)}`}
                        onChange={(event) => {
                          const parsed = parsePersonRoleSelect(event.target.value);
                          const custom = parsed.customRoleId
                            ? org.customRoles.find((item) => item.id === parsed.customRoleId)
                            : null;
                          void handleAssignment(
                            person,
                            {
                              role: parsed.role,
                              custom_role_id: parsed.customRoleId,
                              custom_role_name: custom?.name ?? null,
                            },
                            event.currentTarget,
                          );
                        }}
                      >
                        {BUILT_IN_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        {org.customRoles.map((role) => (
                          <option key={role.id} value={`custom:${role.id}`}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="location-assign">
                        <select
                          value={person.location_id ?? ""}
                          disabled={busyPersonId === person.id}
                          aria-label={`Location for ${displayName(person)}`}
                          onChange={(event) => {
                            const previous = person.location_id ?? "";
                            const select = event.currentTarget;
                            void handleLocationChange(person, select.value || null, select).then((ok) => {
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
        </CollapsibleCard>
      ) : null}

      {admin ? (
        <CollapsibleCard title="Roles Management">
          <p className="empty-note">
            Built-in roles control permissions. Custom roles (BDC Rep, Finance Manager, Desk Manager) categorize
            people in the People table dropdown without changing Admin or Manager access.
          </p>
          <ul className="location-chips role-chips">
            {BUILT_IN_ROLE_OPTIONS.map((role) => (
              <li key={role.value} className="location-chip">
                <span>{role.label}</span>
                <span className="role-chip-note">Built-in</span>
              </li>
            ))}
            {org.customRoles.map((role) => (
              <li key={role.id} className="location-chip">
                <span>{role.name}</span>
              </li>
            ))}
          </ul>
          {org.customRoles.length === 0 ? (
            <p className="empty-note">No custom roles yet. Add BDC Rep, Finance Manager, or Desk Manager below.</p>
          ) : null}
          <form className="auth-form" onSubmit={(event) => void handleAddCustomRole(event)}>
            <label>
              New Role Name
              <Input
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
                placeholder="e.g. BDC Rep, Finance Manager, Desk Manager"
              />
            </label>
            <Button type="submit" disabled={busy}>
              Add Role
            </Button>
          </form>
        </CollapsibleCard>
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
            Admin pushes show here as Pending Employee Acceptance until the sales rep confirms.
            You cannot approve yet. Track progress, or use Authorize / Skip for Rep if they cannot complete review.
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
                      <span className="roster-badge roster-badge-awaiting">{rosterBadgeLabel("awaiting", null, "manager")}</span>
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
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setOpenSheet({ group, mode: "manager" });
                        }}
                      >
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

      {admin ? <ManagerSubmissionsTracker /> : null}

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
          repName={openPerson ? displayName(openPerson) : "Sales rep"}
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
