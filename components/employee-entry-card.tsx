"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";
import { StoreFilterBar } from "@/components/location-filter";
import { FinalizedWorksheetPreview } from "@/components/finalized-worksheet-preview";
import { PersonIdentity } from "@/components/person-identity";
import { PushToEmployeeButton } from "@/components/submit-deals-button";
import { entryRepsFor, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { adminMasterSheetTitle, isPaidAdminSheet } from "@/lib/admin-employee-sheets";
import {
  PRINT_ALL_AUTHORIZED_LABEL,
  PAID_BADGE_LABEL,
  authorizedAdminSheetsForLocation,
  previewSheetWithFallback,
  printFinalizedSheets,
  sheetForEmployee,
  shouldShowFinalizedPrintPreview,
} from "@/lib/admin-print";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { lastSubmittedForRep, lastSubmittedLabel } from "@/lib/latest-submission";
import {
  APPROVE_PUSH_TO_ADMIN_LABEL,
  DELETE_RESET_PUSH_LABEL,
  REJECT_CHANGES_LABEL,
  formatSignedMoney,
  type ApprovalRosterViewer,
} from "@/lib/approval-chain";
import {
  activeRosterLocationId,
  allRepsReady,
  chainForRep,
  hasResettablePush,
  rosterBadgeLabel,
  rosterStatus,
} from "@/lib/roster";

function badgeClass(status: ReturnType<typeof rosterStatus>) {
  if (status === "ready" || status === "accepted" || status === "finalized") return "roster-badge roster-badge-ready";
  if (status === "modified") return "roster-badge roster-badge-modified";
  if (status === "awaiting") return "roster-badge roster-badge-awaiting";
  return "roster-badge roster-badge-idle";
}

function rowClass(status: ReturnType<typeof rosterStatus>, selected: boolean) {
  return [
    "roster-row",
    status === "ready" || status === "accepted" || status === "finalized" ? "roster-row-ready bg-emerald-100 border-emerald-500" : "",
    status === "modified" ? "roster-row-modified" : "",
    status === "awaiting" ? "roster-row-awaiting" : "",
    selected ? "roster-row-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function EmployeeEntryCard() {
  const org = useOrg();
  const { authorizeRepReady, pushAllToAdmin, approveAndPushToAdmin, denyChanges, recallPush, markSheetPaid } =
    useOrgActions();
  const [trackerState] = useTrackerStore();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [diffRepId, setDiffRepId] = useState<string | null>(null);
  const [denyRepId, setDenyRepId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");

  if (!org.profile || org.isLoadingProfile || !canReviewDeals(org.profile.role)) return null;

  const reps = entryRepsFor(org.profile, org.people, org.locationFilterId);
  const selected = reps.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile.role);
  const viewer: ApprovalRosterViewer = admin ? "admin" : "manager";
  const storeName = org.locations.find((item) => item.id === org.locationFilterId)?.name;
  const locationId = activeRosterLocationId(org.profile, org.locationFilterId);
  const storeSelected = !admin || hasStoreSelection(org.locationFilterId);
  const everyoneReady = allRepsReady(reps, org.allDeals, org.approvalChains);
  const canPushAll = !admin && everyoneReady && Boolean(locationId);
  const authorizedSheets = admin
    ? authorizedAdminSheetsForLocation({
        sheets: org.adminSheets,
        people: org.people,
        locationId,
      })
    : [];
  const canPrintAll = admin && Boolean(locationId) && authorizedSheets.length > 0;
  const diffChain = diffRepId ? chainForRep(org.approvalChains, diffRepId) : null;
  const diffPerson = diffRepId ? reps.find((person) => person.id === diffRepId) : null;
  const denyPerson = denyRepId ? reps.find((person) => person.id === denyRepId) : null;

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
    const chain = chainForRep(org.approvalChains, repId);
    const statusWasModified = rosterStatus(
      reps.find((person) => person.id === repId) ?? { id: repId, email: "", full_name: null, role: "rep", location_id: null },
      org.allDeals,
      chain,
    ) === "modified";
    setBusyRepId(repId);
    setMessage("");
    const error = await approveAndPushToAdmin(repId);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    setDiffRepId(null);
    setToast(
      statusWasModified
        ? "Authorized. The Admin master sheet now matches the employee’s submitted changes and is finalized."
        : "Authorized. Admin’s sheet is unchanged and locked as approved.",
    );
    window.setTimeout(() => setToast(""), 3600);
    retryCloudSync();
  }

  async function handleDeny() {
    if (!denyRepId) return;
    setBusyRepId(denyRepId);
    setMessage("");
    const error = await denyChanges(denyRepId, denyReason);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    setDenyRepId(null);
    setDenyReason("");
    setDiffRepId(null);
    setToast("Changes rejected. The sales rep can fix the sheet and re-submit.");
    window.setTimeout(() => setToast(""), 3600);
    retryCloudSync();
  }

  async function handleReset(repId: string) {
    if (!window.confirm("Delete / Reset this push? Pending payloads, unread push notifications, and the employee sheet status will be cleared back to draft.")) {
      return;
    }
    setBusyRepId(repId);
    setMessage("");
    const error = await recallPush(repId);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    setToast("Push deleted. You can stage a new sheet and push again.");
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
        return status === "accepted" || status === "modified";
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
    setToast("Store sheets submitted to Admin for payroll.");
    window.setTimeout(() => setToast(""), 3200);
    retryCloudSync();
  }

  function handlePrintAllAuthorized() {
    if (!canPrintAll) {
      setMessage("No manager-authorized pay sheets for this store and pay period.");
      return;
    }
    setMessage("");
    printFinalizedSheets("all");
  }

  return (
    <section className={admin ? "summary-card admin-roster-print" : "summary-card no-print"}>
      <div className={admin ? "admin-roster-chrome no-print" : undefined}>
      <h2>{admin ? "Admin employee roster" : "Manager location roster"}</h2>
      <p className="empty-note">
        {admin
          ? "Open any employee to work their isolated Admin Master Sheet. Edits save to your ledger only. Push Sheet to Employee & Manager copies a snapshot for the rep to review. Delete / Reset Push cancels a bad send without wiping this master. When the manager approves, this master is overwritten and locked as approved_final for payroll. Finalized sheets show a print-ready preview underneath the green row."
          : "Huntington and every other store manager sees pushed sheets for their rooftop. Green means the sales rep authorized with no changes — Authorize & Push to Admin locks Admin’s sheet unchanged. Amber means the employee submitted a dollar difference; open the diff, then authorize (overwrites Admin) or reject with notes."}
      </p>
      {admin ? (
        <StoreFilterBar
          actions={
            <Button
              type="button"
              variant="outline"
              disabled={!canPrintAll}
              onClick={handlePrintAllAuthorized}
            >
              <Printer data-icon="inline-start" />
              {PRINT_ALL_AUTHORIZED_LABEL}
            </Button>
          }
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

      {!admin ? (
        <div className="roster-toolbar">
          <Button disabled={busy || !canPushAll} onClick={() => void handlePushAll()}>
            Submit Ready Sheets to Admin
          </Button>
          {reps.length > 0 && !everyoneReady ? (
            <p className="empty-note">
              {reps.filter((rep) => {
                const status = rosterStatus(rep, org.allDeals, chainForRep(org.approvalChains, rep.id));
                return status === "accepted" || status === "modified" || status === "finalized";
              }).length}{" "}
              of {reps.length} ready for Admin.
            </p>
          ) : null}
        </div>
      ) : null}

      {!storeSelected ? (
        <p className="store-select-prompt">Select a dealership store above to manage users.</p>
      ) : reps.length === 0 ? (
        <p className="empty-note">
          {org.profile.role === "manager" && !org.profile.location_id
            ? "Ask the admin to assign you to a location before reviewing a store roster."
            : "No sales reps match this store filter."}
        </p>
      ) : null}
      </div>

      {storeSelected && reps.length > 0 ? (
        <ul className="roster-list">
          {reps.map((person) => {
            const chain = chainForRep(org.approvalChains, person.id);
            const status = rosterStatus(person, org.allDeals, chain);
            const selectedRow = person.id === entryRepId;
            const store = person.location_id
              ? org.locations.find((item) => item.id === person.location_id)?.name
              : null;
            const submittedAt = lastSubmittedForRep(org.allDeals, person.id);
            const canAuthorizeNoChanges = !admin && status === "accepted";
            const canReviewModified = !admin && status === "modified";
            const canReset = admin && hasResettablePush(org.allDeals, chain, person.id);
            const adminSheet = previewSheetWithFallback(
              sheetForEmployee(org.adminSheets, person.id),
              person.id === entryRepId ? trackerState : null,
              {
                dealRows: org.allDeals.filter((row) => row.rep_id === person.id),
                chain,
              },
            );
            const paid = isPaidAdminSheet(adminSheet?.status, adminSheet?.isPaid);
            const showPrintPreview = shouldShowFinalizedPrintPreview({
              isAdmin: admin,
              rosterStatus: status,
              sheet: adminSheet,
              chainStatus: chain?.status,
            });
            return (
              <li key={person.id}>
                <div className={`${rowClass(status, selectedRow)} no-print`}>
                  <button
                    type="button"
                    className="roster-open"
                    onClick={() => {
                      setMessage("");
                      if (!admin && status === "modified") {
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
                  {paid ? (
                    <span className="paid-sheet-badge" aria-label={PAID_BADGE_LABEL}>
                      {PAID_BADGE_LABEL}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={badgeClass(status)}
                    onClick={() => {
                      if (!admin && status === "modified") setDiffRepId(person.id);
                    }}
                  >
                    {rosterBadgeLabel(status, chain, viewer)}
                  </button>
                  {canAuthorizeNoChanges ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || busyRepId === person.id}
                      onClick={() => void handleApprove(person.id)}
                    >
                      {busyRepId === person.id ? "Submitting…" : APPROVE_PUSH_TO_ADMIN_LABEL}
                    </Button>
                  ) : canReviewModified ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || busyRepId === person.id}
                      onClick={() => setDiffRepId(person.id)}
                    >
                      Review diff
                    </Button>
                  ) : canReset ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy || busyRepId === person.id}
                      onClick={() => void handleReset(person.id)}
                    >
                      {busyRepId === person.id ? "Resetting…" : DELETE_RESET_PUSH_LABEL}
                    </Button>
                  ) : !admin && status === "awaiting" ? (
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
                {showPrintPreview ? (
                  <FinalizedWorksheetPreview person={person} sheet={adminSheet} onMarkPaid={markSheetPaid} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="no-print">

      {selected ? (
        <div className="roster-selected">
          <p className="empty-note">
            {admin
              ? `${adminMasterSheetTitle(displayName(selected))} is open. Edits save immediately to your isolated ledger. Push Sheet to Employee & Manager copies a snapshot to the rep and manager without overwriting this master. Delete / Reset Push cancels a bad send.`
              : `Pushed sheet for ${displayName(selected)}. Review the comparison here. Authorize with no changes locks Admin’s sheet unchanged. Submitted changes require the diff modal.`}
          </p>
          <div className="cloud-setup-actions">
            <Button variant="outline" disabled={busy} onClick={() => setEntryRepId(null)}>
              Back to my dashboard
            </Button>
            {admin ? <PushToEmployeeButton /> : null}
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
                <p className="workbook-kicker">Employee submitted changes</p>
                <h2 id="rep-diff-title">{displayName(diffPerson)}</h2>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setDiffRepId(null)}>
                Close
              </Button>
            </div>
            <p className="empty-note">
              Total dollar difference {formatSignedMoney(diffChain.payDelta)} (Rep total − Admin total).
              Authorize overwrites the Admin master sheet with these employee modifications and finalizes it.
              Reject sends the sheet back to the sales rep with your notes.
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
              <Button
                type="button"
                variant="outline"
                disabled={busyRepId === diffPerson.id}
                onClick={() => {
                  setDenyRepId(diffPerson.id);
                  setDenyReason("");
                }}
              >
                {REJECT_CHANGES_LABEL}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {denyPerson ? (
        <div className="account-modal-backdrop no-print" role="presentation" onClick={() => setDenyRepId(null)}>
          <div
            className="account-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deny-changes-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="account-modal-head">
              <div>
                <p className="workbook-kicker">Reject changes</p>
                <h2 id="deny-changes-title">{displayName(denyPerson)}</h2>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setDenyRepId(null)}>
                Close
              </Button>
            </div>
            <p className="empty-note">
              The sales rep will see these notes on their worksheet, fix the issues, and re-submit to you.
            </p>
            <label className="field-label" htmlFor="deny-reason">
              Rejection reason
            </label>
            <textarea
              id="deny-reason"
              className="text-input"
              rows={4}
              value={denyReason}
              onChange={(event) => setDenyReason(event.target.value)}
              placeholder="Explain what needs to be corrected"
            />
            <div className="cloud-setup-actions">
              <Button disabled={busyRepId === denyPerson.id || !denyReason.trim()} onClick={() => void handleDeny()}>
                {busyRepId === denyPerson.id ? "Rejecting…" : REJECT_CHANGES_LABEL}
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
      </div>
    </section>
  );
}
