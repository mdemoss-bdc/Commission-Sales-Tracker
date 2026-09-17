"use client";

import { useMemo, useState } from "react";
import { Loader2, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";
import { StoreFilterBar } from "@/components/location-filter";
import { AdminMasterSheetModal } from "@/components/admin-master-sheet-modal";
import { AdminRosterPeriodControls } from "@/components/admin-roster-period-controls";
import { FinalizedWorksheetPreview, AuthorizedSheetsPrintBatch } from "@/components/finalized-worksheet-preview";
import { ManagerApprovalModal } from "@/components/manager-approval-modal";
import { PersonIdentity } from "@/components/person-identity";
import { entryRepsFor, setAdminRosterPeriod, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals } from "@/lib/roles";
import { isPaidAdminSheet } from "@/lib/admin-employee-sheets";
import {
  PRINT_ALL_AUTHORIZED_LABEL,
  authorizedAdminSheetsForLocation,
  previewSheetWithFallback,
  printFinalizedSheets,
  sheetForEmployee,
  shouldShowFinalizedPrintPreview,
} from "@/lib/admin-print";
import {
  adminPeriodRosterBadgeClass,
  adminPeriodRosterBadgeLabel,
  adminPeriodRosterStatus,
  adminPeriodRowClass,
  composeAdminRosterPeriod,
  normalizeAdminRosterSplit,
  PUSH_ALL_PAY_SHEETS_LABEL,
  shouldOpenPrintForPeriodStatus,
  sheetMatchesRosterPeriod,
} from "@/lib/admin-roster";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { activePayPeriod } from "@/lib/pay-period";
import { lastSubmittedForRep, lastSubmittedLabel } from "@/lib/latest-submission";
import type { TrackerState } from "@/lib/types";
import {
  APPROVE_PUSH_TO_ADMIN_LABEL,
  DELETE_RESET_PUSH_LABEL,
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

function badgeClass(status: ReturnType<typeof rosterStatus>, paid = false) {
  if (paid) return "roster-badge roster-badge-ready";
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
  const {
    authorizeRepReady,
    pushAllToAdmin,
    approveAndPushToAdmin,
    denyChanges,
    recallPush,
    markSheetPaid,
    pushAllPaySheetsToEmployees,
  } = useOrgActions();
  const [trackerState] = useTrackerStore();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [busyRepId, setBusyRepId] = useState<string | null>(null);
  const [pushAllBusy, setPushAllBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [diffRepId, setDiffRepId] = useState<string | null>(null);
  const [printRepId, setPrintRepId] = useState<string | null>(null);

  const rawRosterPeriod = org.adminRosterPeriod ?? activePayPeriod();
  const rosterPeriod = useMemo(() => {
    const year = rawRosterPeriod.year ?? new Date().getFullYear();
    const month = rawRosterPeriod.month ?? new Date().getMonth() + 1;
    const split = normalizeAdminRosterSplit(rawRosterPeriod.split);
    return composeAdminRosterPeriod({ year, month, split });
  }, [rawRosterPeriod.key, rawRosterPeriod.year, rawRosterPeriod.month, rawRosterPeriod.split]);

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
        period: rosterPeriod,
      })
    : [];
  const canPrintAll = admin && Boolean(locationId) && authorizedSheets.length > 0;
  const pushAllEligibleIds = admin
    ? reps
        .filter((person) => {
          const sheet = sheetForEmployee(org.adminSheets, person.id, rosterPeriod);
          const status = adminPeriodRosterStatus({
            sheet,
            chain: chainForRep(org.approvalChains, person.id),
            period: rosterPeriod,
          });
          return status === "unpushed" || status === "awaiting" || status === "finalized";
        })
        .map((person) => person.id)
    : [];
  const canPushAllPaySheets = admin && Boolean(locationId) && pushAllEligibleIds.length > 0;
  const diffChain = diffRepId ? chainForRep(org.approvalChains, diffRepId) : null;
  const diffPerson = diffRepId ? reps.find((person) => person.id === diffRepId) : null;
  const printPerson = printRepId ? reps.find((person) => person.id === printRepId) : null;
  const printChain = printRepId ? chainForRep(org.approvalChains, printRepId) : null;
  const printSheet = printPerson
    ? sheetForEmployee(org.adminSheets, printPerson.id, rosterPeriod)
    : null;
  const printStoreName = printPerson?.location_id
    ? org.locations.find((item) => item.id === printPerson.location_id)?.name
    : storeName;

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

  async function handleApprove(repId: string, displayedState?: TrackerState | null) {
    const chain = chainForRep(org.approvalChains, repId);
    const statusWasModified =
      rosterStatus(
        reps.find((person) => person.id === repId) ?? {
          id: repId,
          email: "",
          full_name: null,
          role: "rep",
          location_id: null,
        },
        org.allDeals,
        chain,
      ) === "modified";
    setBusyRepId(repId);
    setMessage("");
    const error = await approveAndPushToAdmin(repId, displayedState);
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

  async function handleDeny(repId: string, reason: string) {
    setBusyRepId(repId);
    setMessage("");
    const error = await denyChanges(repId, reason);
    setBusyRepId(null);
    if (error) {
      setMessage(error);
      return;
    }
    setDiffRepId(null);
    setToast("Changes rejected. The sales rep can fix the sheet and re-submit.");
    window.setTimeout(() => setToast(""), 3600);
    retryCloudSync();
  }

  async function handleReset(repId: string) {
    if (
      !window.confirm(
        "Delete / Reset this push? Pending payloads, unread push notifications, and the employee sheet status will be cleared back to draft.",
      )
    ) {
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

  async function handlePushAllPaySheets() {
    if (!locationId || !canPushAllPaySheets) return;
    setPushAllBusy(true);
    setMessage("");
    setToast("");
    const result = await pushAllPaySheetsToEmployees({
      locationId,
      period: rosterPeriod,
      employeeIds: pushAllEligibleIds,
    });
    setPushAllBusy(false);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setToast(
      result.pushed === 1
        ? "Pushed 1 pay sheet to the employee and manager."
        : `Pushed ${result.pushed} pay sheets to employees and managers.`,
    );
    window.setTimeout(() => setToast(""), 4200);
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

  function handleRosterPeriodChange(next: typeof rosterPeriod) {
    setAdminRosterPeriod(next);
    setPrintRepId(null);
    if (entryRepId) setEntryRepId(entryRepId, true);
  }

  return (
    <section className={admin ? "summary-card admin-roster-print" : "summary-card no-print"}>
      <div className={admin ? "admin-roster-chrome no-print" : undefined}>
        <h2>{admin ? "Commission Pay Sheet Entry & Roster" : "Manager location roster"}</h2>
        <p className="empty-note">
          {admin
            ? "Select a store and pay period, then click any salesperson row to open and edit their Master Pay Sheet. Enter deals, trade counts, gross, and bonuses, then Save Draft or Push to rep."
            : "Huntington and every other store manager sees pushed sheets for their rooftop. Green means the sales rep authorized with no changes — Authorize & Push to Admin locks Admin’s sheet unchanged. Amber means the employee submitted a dollar difference; open the print-ready sheet, then authorize (overwrites Admin) or reject with notes."}
        </p>
        {admin ? (
          <StoreFilterBar
            actions={
              <>
                <AdminRosterPeriodControls period={rosterPeriod} onPeriodChange={handleRosterPeriodChange} />
                <div className="admin-roster-toolbar-actions">
                  <Button type="button" variant="outline" disabled={!canPrintAll} onClick={handlePrintAllAuthorized}>
                    <Printer data-icon="inline-start" />
                    {PRINT_ALL_AUTHORIZED_LABEL}
                  </Button>
                  <Button
                    type="button"
                    disabled={!canPushAllPaySheets || pushAllBusy}
                    onClick={() => void handlePushAllPaySheets()}
                  >
                    {pushAllBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
                    {pushAllBusy ? "Pushing…" : PUSH_ALL_PAY_SHEETS_LABEL}
                  </Button>
                </div>
              </>
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
                {
                  reps.filter((rep) => {
                    const status = rosterStatus(rep, org.allDeals, chainForRep(org.approvalChains, rep.id));
                    return status === "accepted" || status === "modified" || status === "finalized";
                  }).length
                }{" "}
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
            const selectedRow = person.id === entryRepId;
            if (admin) {
              const periodSheet = sheetForEmployee(org.adminSheets, person.id, rosterPeriod);
              const periodStatus = adminPeriodRosterStatus({
                sheet: periodSheet,
                chain: sheetMatchesRosterPeriod(periodSheet, rosterPeriod) ? chain : null,
                period: rosterPeriod,
              });
              const showPrintModal = shouldOpenPrintForPeriodStatus(periodStatus);
              const canReset =
                hasResettablePush(org.allDeals, chain, person.id) &&
                Boolean(periodSheet) &&
                sheetMatchesRosterPeriod(periodSheet, rosterPeriod);

              return (
                <li key={person.id}>
                  <div
                    className={`${adminPeriodRowClass(periodStatus, selectedRow)} no-print roster-row-interactive roster-row-compact ${
                      showPrintModal ? "roster-row-printable" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="roster-open"
                      title={
                        showPrintModal
                          ? "Click row to open print sheet"
                          : "Click row to edit pay sheet"
                      }
                      onClick={() => {
                        setMessage("");
                        setAdminRosterPeriod(rosterPeriod);
                        if (showPrintModal) {
                          setPrintRepId(person.id);
                          return;
                        }
                        setEntryRepId(person.id, true);
                      }}
                    >
                      <PersonIdentity person={person} showEmail={false} />
                      <span className="roster-edit-hint" aria-hidden="true">
                        {showPrintModal ? "Click to open print sheet" : "Click row to edit pay sheet"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={adminPeriodRosterBadgeClass(periodStatus)}
                      onClick={() => {
                        setAdminRosterPeriod(rosterPeriod);
                        if (showPrintModal) setPrintRepId(person.id);
                        else setEntryRepId(person.id, true);
                      }}
                    >
                      {adminPeriodRosterBadgeLabel(periodStatus)}
                    </button>
                    {canReset ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy || busyRepId === person.id}
                        onClick={() => void handleReset(person.id)}
                      >
                        {busyRepId === person.id ? "Resetting…" : DELETE_RESET_PUSH_LABEL}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            }

            const submittedAt = lastSubmittedForRep(org.allDeals, person.id);
            const status = rosterStatus(person, org.allDeals, chain);
            const canAuthorizeNoChanges = status === "accepted";
            const canReviewModified = status === "modified";
            const adminSheet = previewSheetWithFallback(
              sheetForEmployee(org.adminSheets, person.id),
              person.id === entryRepId ? trackerState : null,
              {
                dealRows: org.allDeals.filter((row) => row.rep_id === person.id),
                chain,
              },
            );
            const paid = isPaidAdminSheet(adminSheet?.status, adminSheet?.isPaid);
            const showPrintModal = shouldShowFinalizedPrintPreview({
              isAdmin: false,
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
                      if (status === "modified") {
                        setDiffRepId(person.id);
                        return;
                      }
                      if (showPrintModal) {
                        setPrintRepId(person.id);
                        return;
                      }
                      setEntryRepId(person.id);
                    }}
                  >
                    <PersonIdentity person={person} />
                    {submittedAt ? <span className="empty-note">{lastSubmittedLabel(submittedAt)}</span> : null}
                  </button>
                  <button
                    type="button"
                    className={badgeClass(status, paid)}
                    onClick={() => {
                      if (status === "modified") {
                        setDiffRepId(person.id);
                        return;
                      }
                      if (showPrintModal) setPrintRepId(person.id);
                    }}
                  >
                    {paid ? "PAID" : rosterBadgeLabel(status, chain, viewer)}
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
                      Review sheet
                    </Button>
                  ) : status === "awaiting" ? (
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
      ) : null}

      <div className="no-print">
        {!admin && selected ? (
          <div className="roster-selected">
            <p className="empty-note">
              {`Pushed sheet for ${displayName(selected)}. Review the print-ready worksheet here. Authorize with no changes locks Admin’s sheet unchanged. Submitted changes open the full sheet with highlighted edits.`}
            </p>
            <div className="cloud-setup-actions">
              <Button variant="outline" disabled={busy} onClick={() => setEntryRepId(null)}>
                Back to my dashboard
              </Button>
            </div>
          </div>
        ) : null}

        {admin && selected && !printRepId ? (
          <AdminMasterSheetModal
            person={selected}
            period={rosterPeriod}
            onClose={() => {
              setEntryRepId(null);
              setMessage("");
            }}
          />
        ) : null}

        {diffChain && diffPerson ? (
          <ManagerApprovalModal
            person={diffPerson}
            chain={diffChain}
            dealRows={org.allDeals.filter((row) => row.rep_id === diffPerson.id)}
            busy={busyRepId === diffPerson.id}
            error={message}
            onClose={() => setDiffRepId(null)}
            onAuthorize={(draft) => void handleApprove(diffPerson.id, draft)}
            onReject={(reason) => void handleDeny(diffPerson.id, reason)}
          />
        ) : null}

        {toast ? (
          <p className="update-toast" role="status">
            {toast}
          </p>
        ) : null}
        {message ? <p className="form-error">{message}</p> : null}
      </div>

      {printPerson ? (
        <FinalizedWorksheetPreview
          person={printPerson}
          sheet={printSheet}
          period={rosterPeriod}
          storeName={printStoreName}
          dealRows={org.allDeals}
          chain={printChain}
          onClose={() => setPrintRepId(null)}
          onMarkPaid={markSheetPaid}
        />
      ) : null}

      {admin ? (
        <AuthorizedSheetsPrintBatch
          sheets={authorizedSheets}
          people={reps}
          dealRows={org.allDeals}
          chains={org.approvalChains}
          period={rosterPeriod}
        />
      ) : null}
    </section>
  );
}
