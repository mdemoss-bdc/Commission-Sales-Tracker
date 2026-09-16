"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { StoreFilterBar } from "@/components/location-filter";
import { PersonIdentity } from "@/components/person-identity";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
import { entryRepsFor, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { lastSubmittedForRep, lastSubmittedLabel } from "@/lib/latest-submission";
import {
  APPROVE_PUSH_TO_ADMIN_LABEL,
  formatSignedMoney,
} from "@/lib/approval-chain";
import {
  activeRosterLocationId,
  allRepsReady,
  chainForRep,
  rosterBadgeLabel,
  rosterStatus,
} from "@/lib/roster";

function badgeClass(status: ReturnType<typeof rosterStatus>) {
  if (status === "ready" || status === "accepted" || status === "finalized") return "roster-badge roster-badge-ready";
  if (status === "modified" || status === "awaiting") return "roster-badge roster-badge-awaiting";
  return "roster-badge roster-badge-idle";
}

function rowClass(status: ReturnType<typeof rosterStatus>, selected: boolean) {
  return [
    "roster-row",
    status === "ready" || status === "accepted" || status === "finalized" ? "roster-row-ready bg-emerald-100 border-emerald-500" : "",
    status === "awaiting" || status === "modified" ? "roster-row-awaiting" : "",
    selected ? "roster-row-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function EmployeeEntryCard() {
  const org = useOrg();
  const { authorizeRepReady, pushAllToAdmin, approveAndPushToAdmin } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [diffRepId, setDiffRepId] = useState<string | null>(null);

  if (!org.profile || org.isLoadingProfile || !canReviewDeals(org.profile.role)) return null;

  const reps = entryRepsFor(org.profile, org.people, org.locationFilterId);
  const selected = reps.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile.role);
  const storeName = org.locations.find((item) => item.id === org.locationFilterId)?.name;
  const locationId = activeRosterLocationId(org.profile, org.locationFilterId);
  const storeSelected = !admin || hasStoreSelection(org.locationFilterId);
  const everyoneReady = allRepsReady(reps, org.allDeals, org.approvalChains);
  const canPushAll = everyoneReady && Boolean(locationId);
  const diffChain = diffRepId ? chainForRep(org.approvalChains, diffRepId) : null;
  const diffPerson = diffRepId ? reps.find((person) => person.id === diffRepId) : null;

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

  async function handleApprove(repId: string) {
    setBusyRepId(repId);
    setMessage("");
    const error = await approveAndPushToAdmin(repId);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    setDiffRepId(null);
    setToast("Approved and pushed to Admin. This never goes back to the sales rep.");
    window.setTimeout(() => setToast(""), 3200);
    retryCloudSync();
  }

  async function handlePushAll() {
    if (!locationId || !canPushAll) return;
    setBusy(true);
    setMessage("");
    setToast("");
    const readyIds = reps
      .filter((rep) => {
        const status = rosterStatus(rep, org.allDeals, chainForRep(org.approvalChains, rep.id));
        return status === "accepted" || status === "modified" || status === "ready";
      })
      .map((rep) => rep.id);
    for (const repId of readyIds) {
      const error = await approveAndPushToAdmin(repId);
      if (error) {
        setBusy(false);
        setMessage(error);
        return;
      }
    }
    const error = await pushAllToAdmin(locationId);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setToast("Store sheets approved and sent to Admin for payroll.");
    window.setTimeout(() => setToast(""), 3200);
    retryCloudSync();
  }

  return (
    <section className="summary-card no-print">
      <h2>Employee roster</h2>
      <p className="empty-note">
        Sales reps in A–Z order. After an Admin push, badges show Awaiting Rep Action, Accepted
        (No Changes), or Modified by Rep with the dollar delta. Approve & Push to Admin sends the
        sheet forward to payroll — it never returns to the sales rep.
      </p>
      {admin ? (
        <StoreFilterBar
          countNote={
            storeSelected
              ? storeFilterSummary(reps.length, org.locationFilterId, storeName, {
                  singular: "sales rep",
                  plural: "sales reps",
                })
              : undefined
          }
        />
      ) : null}

      <div className="roster-toolbar">
        <Button disabled={busy || !canPushAll} onClick={() => void handlePushAll()}>
          Approve & Push All to Admin
        </Button>
        {!locationId && admin ? (
          <p className="empty-note">Select a store to send ready sheets to Admin.</p>
        ) : null}
        {locationId && reps.length > 0 && !everyoneReady ? (
          <p className="empty-note">
            {reps.filter((rep) => {
              const status = rosterStatus(rep, org.allDeals, chainForRep(org.approvalChains, rep.id));
              return status === "ready" || status === "accepted" || status === "modified" || status === "finalized";
            }).length}{" "}
            of {reps.length} ready for Admin.
          </p>
        ) : null}
      </div>

      {!storeSelected ? (
        <p className="store-select-prompt">Select a dealership store above to manage users.</p>
      ) : reps.length === 0 ? (
        <p className="empty-note">
          {org.profile.role === "manager" && !org.profile.location_id
            ? "Ask the admin to assign you to a location before reviewing a store roster."
            : "No sales reps match this store filter."}
        </p>
      ) : (
        <ul className="roster-list">
          {reps.map((person) => {
            const chain = chainForRep(org.approvalChains, person.id);
            const status = rosterStatus(person, org.allDeals, chain);
            const selectedRow = person.id === entryRepId;
            const store = person.location_id
              ? org.locations.find((item) => item.id === person.location_id)?.name
              : null;
            const submittedAt = lastSubmittedForRep(org.allDeals, person.id);
            const canApprove = status === "accepted" || status === "modified" || status === "ready";
            return (
              <li key={person.id}>
                <div className={rowClass(status, selectedRow)}>
                  <button
                    type="button"
                    className="roster-open"
                    onClick={() => {
                      setMessage("");
                      if (status === "modified") {
                        setDiffRepId(person.id);
                        return;
                      }
                      setEntryRepId(person.id);
                    }}
                  >
                    <PersonIdentity person={person} />
                    {store && admin ? <span className="roster-store">{store}</span> : null}
                    {submittedAt ? <span className="empty-note">{lastSubmittedLabel(submittedAt)}</span> : null}
                  </button>
                  <button
                    type="button"
                    className={badgeClass(status)}
                    onClick={() => {
                      if (status === "modified") setDiffRepId(person.id);
                    }}
                  >
                    {rosterBadgeLabel(status, chain)}
                  </button>
                  {canApprove ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || busyRepId === person.id}
                      onClick={() => void handleApprove(person.id)}
                    >
                      {busyRepId === person.id ? "Approving…" : APPROVE_PUSH_TO_ADMIN_LABEL}
                    </Button>
                  ) : status !== "finalized" ? (
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
            Staging sheet open for {displayName(selected)}. Admin push stores the baseline snapshot.
            The manager later approves to Admin — never back down to the sales rep.
          </p>
          <div className="cloud-setup-actions">
            <Button variant="outline" disabled={busy} onClick={() => setEntryRepId(null)}>
              Back to my dashboard
            </Button>
            <PushToEmployeeButton />
          </div>
        </div>
      ) : null}

      {diffChain && diffPerson ? (
        <div className="account-modal-backdrop no-print" role="presentation" onClick={() => setDiffRepId(null)}>
          <div
            className="account-modal pushed-sheet-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rep-diff-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="account-modal-head">
              <div>
                <p className="workbook-kicker">Manager audit</p>
                <h2 id="rep-diff-title">{displayName(diffPerson)} · Modified by Rep</h2>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setDiffRepId(null)}>
                Close
              </Button>
            </div>
            <p className="empty-note">
              Total dollar delta {formatSignedMoney(diffChain.payDelta)}. Approve sends this sheet to
              Admin and overwrites the admin baseline with the rep draft.
            </p>
            {diffChain.diffs.length === 0 ? (
              <p className="empty-note">No line-item differences were logged.</p>
            ) : (
              <ul className="org-list">
                {diffChain.diffs.map((line) => (
                  <li key={line.summary}>{line.summary}</li>
                ))}
              </ul>
            )}
            <div className="cloud-setup-actions">
              <Button disabled={busyRepId === diffPerson.id} onClick={() => void handleApprove(diffPerson.id)}>
                {APPROVE_PUSH_TO_ADMIN_LABEL}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <p className="update-toast" role="status">
          {toast}
        </p>
      ) : null}
      {message ? <p className="form-error">{message}</p> : null}
    </section>
  );
}
