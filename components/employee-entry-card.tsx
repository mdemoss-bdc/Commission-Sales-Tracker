"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { StoreFilterBar } from "@/components/location-filter";
import { PersonIdentity } from "@/components/person-identity";
import { entryRepsFor, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { storeFilterSummary } from "@/lib/locations";
import {
  activeRosterLocationId,
  allRepsReady,
  rosterBadgeLabel,
  rosterStatus,
} from "@/lib/roster";

export function EmployeeEntryCard() {
  const org = useOrg();
  const { pushToEmployee, authorizeRepReady, pushAllToAdmin } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");

  if (!org.profile || !canReviewDeals(org.profile.role)) return null;

  const reps = entryRepsFor(org.profile, org.people, org.locationFilterId);
  const selected = reps.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile.role);
  const storeName = org.locations.find((item) => item.id === org.locationFilterId)?.name;
  const locationId = activeRosterLocationId(org.profile, org.locationFilterId);
  const everyoneReady = allRepsReady(reps, org.allDeals);
  const canPushAll = everyoneReady && Boolean(locationId);
  const draftCount = entryRepId
    ? org.draftsForEntry.filter((row) => row.rep_id === entryRepId).length
    : 0;

  async function handlePush() {
    if (!entryRepId) return;
    setBusy(true);
    setMessage("");
    const error = await pushToEmployee(entryRepId);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("Pushed for employee review. The rep’s live tracker was not overwritten.");
    retryCloudSync();
  }

  async function handleAuthorize(repId: string) {
    setBusyRepId(repId);
    setMessage("");
    const error = await authorizeRepReady(repId);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    retryCloudSync();
  }

  async function handlePushAll() {
    if (!locationId || !canPushAll) return;
    setBusy(true);
    setMessage("");
    setToast("");
    const error = await pushAllToAdmin(locationId);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setToast("All store records submitted to Admin successfully.");
    window.setTimeout(() => {
      setToast((current) => (current === "All store records submitted to Admin successfully." ? "" : current));
    }, 2800);
    retryCloudSync();
  }

  return (
    <section className="summary-card no-print">
      <h2>Employee roster</h2>
      <p className="empty-note">
        Sales reps in A–Z order. Open a name to work their staging sheet. Green means they submitted
        or you authorized them. Amber is only used while a deal is still pending employee review.
      </p>
      {admin ? (
        <StoreFilterBar
          countNote={storeFilterSummary(reps.length, org.locationFilterId, storeName, {
            singular: "sales rep",
            plural: "sales reps",
          })}
        />
      ) : null}

      <div className="roster-toolbar">
        <Button disabled={busy || !canPushAll} onClick={() => void handlePushAll()}>
          Push All to Admin
        </Button>
        {!locationId && admin ? (
          <p className="empty-note">Select a store to submit all records to Admin.</p>
        ) : null}
        {locationId && reps.length > 0 && !everyoneReady ? (
          <p className="empty-note">
            {reps.filter((rep) => rosterStatus(rep, org.allDeals) === "ready").length} of {reps.length}{" "}
            ready. Authorize remaining reps or wait for their submissions.
          </p>
        ) : null}
      </div>

      {reps.length === 0 ? (
        <p className="empty-note">
          {org.profile.role === "manager" && !org.profile.location_id
            ? "Ask the admin to assign you to a location before reviewing a store roster."
            : org.locationFilterId
              ? "No sales reps match this store filter."
              : "No sales reps are assigned yet."}
        </p>
      ) : (
        <ul className="roster-list">
          {reps.map((person) => {
            const status = rosterStatus(person, org.allDeals);
            const selectedRow = person.id === entryRepId;
            const store = person.location_id
              ? org.locations.find((item) => item.id === person.location_id)?.name
              : null;
            return (
              <li key={person.id}>
                <div
                  className={[
                    "roster-row",
                    status === "ready" ? "roster-row-ready bg-emerald-100 border-emerald-500" : "",
                    status === "awaiting" ? "roster-row-awaiting" : "",
                    selectedRow ? "roster-row-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="roster-open"
                    onClick={() => {
                      setMessage("");
                      setEntryRepId(person.id);
                    }}
                  >
                    <PersonIdentity person={person} />
                    {store && admin ? <span className="roster-store">{store}</span> : null}
                  </button>
                  <span
                    className={
                      status === "ready"
                        ? "roster-badge roster-badge-ready"
                        : status === "awaiting"
                          ? "roster-badge roster-badge-awaiting"
                          : "roster-badge roster-badge-idle"
                    }
                  >
                    {rosterBadgeLabel(status)}
                  </span>
                  {status !== "ready" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || busyRepId === person.id}
                      onClick={() => void handleAuthorize(person.id)}
                    >
                      {busyRepId === person.id ? "Authorizing…" : "Authorize / Skip for Rep"}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="roster-selected">
          <p className="empty-note">
            Staging sheet open for {displayName(selected)}. {draftCount} unpushed staged record
            {draftCount === 1 ? "" : "s"} ready to send.
          </p>
          <div className="cloud-setup-actions">
            <Button variant="outline" disabled={busy} onClick={() => setEntryRepId(null)}>
              Back to my dashboard
            </Button>
            <Button disabled={busy || draftCount === 0} onClick={() => void handlePush()}>
              Push to employee
            </Button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <p className="update-toast" role="status">
          {toast}
        </p>
      ) : null}
      {message ? <p className={message.includes("Pushed") ? "form-success" : "form-error"}>{message}</p> : null}
    </section>
  );
}
