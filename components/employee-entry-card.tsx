"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId, useTrackerStore } from "@/lib/tracker-store";
import { CollapsibleCard } from "@/components/collapsible-card";
import { StoreFilterBar } from "@/components/location-filter";
import { AdminMasterSheetModal } from "@/components/admin-master-sheet-modal";
import { AdminRosterPeriodControls } from "@/components/admin-roster-period-controls";
import { FinalizedWorksheetPreview, AuthorizedSheetsPrintBatch } from "@/components/finalized-worksheet-preview";
import { ManagerApprovalModal } from "@/components/manager-approval-modal";
import { ManagerEditSheetModal } from "@/components/manager-edit-sheet-modal";
import { PersonIdentity } from "@/components/person-identity";
import { entryRepsFor, refreshAdminRosterSheets, setAdminRosterPeriod, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName } from "@/lib/names";
import { canManageOrg, canReviewDeals, type UserProfile } from "@/lib/roles";
import { isPaidAdminSheet } from "@/lib/admin-employee-sheets";
import { friendlyManagerSheetError } from "@/lib/org";
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
  buildAdminRosterPeriodKey,
  composeAdminRosterPeriod,
  getPeriodKey,
  normalizeAdminRosterSplit,
  PUSH_ALL_PAY_SHEETS_LABEL,
  shouldOpenPrintForPeriodStatus,
  sheetMatchesRosterPeriod,
  type AdminRosterSplitChoice,
} from "@/lib/admin-roster";
import { storeFilterSummary, hasStoreSelection } from "@/lib/locations";
import { activePayPeriod, type PayPeriodIdentity } from "@/lib/pay-period";
import { lastSubmittedForRep, lastSubmittedLabel } from "@/lib/latest-submission";
import { MONTH_NAMES, type TrackerState } from "@/lib/types";
import {
  DELETE_RESET_PUSH_LABEL,
  REVIEW_EDIT_SHEET_LABEL,
} from "@/lib/approval-chain";
import {
  AUTHORIZE_ADMIN_SKIP_REP_LABEL,
  AUTHORIZE_SEND_TO_ADMIN_LABEL,
  clearinghouseBadgeLabel,
  clearinghouseTone,
  resolveClearinghouseRow,
} from "@/lib/manager-clearinghouse";
import {
  activeRosterLocationId,
  chainForRep,
  hasResettablePush,
} from "@/lib/roster";

function badgeClass(status: ReturnType<typeof clearinghouseTone> | "ready", paid = false) {
  if (paid) return "roster-badge roster-badge-ready";
  if (status === "ready" || status === "accepted" || status === "finalized") return "roster-badge roster-badge-ready";
  if (status === "modified") return "roster-badge roster-badge-modified";
  if (status === "awaiting") return "roster-badge roster-badge-awaiting";
  return "roster-badge roster-badge-idle";
}

function rowClass(status: ReturnType<typeof clearinghouseTone> | "ready", selected: boolean) {
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
  const [editWaitingRep, setEditWaitingRep] = useState<{
    person: UserProfile;
    period: PayPeriodIdentity;
  } | null>(null);

  // Local controlled period filters — drive badges + modal independently of stale store defaults.
  const seedPeriod = org.adminRosterPeriod?.key ? org.adminRosterPeriod : activePayPeriod();
  const [selectedYear, setSelectedYear] = useState(() => seedPeriod.year ?? new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(() => seedPeriod.month ?? new Date().getMonth() + 1);
  const [selectedPeriod, setSelectedPeriod] = useState<AdminRosterSplitChoice>(() =>
    normalizeAdminRosterSplit(seedPeriod.split),
  );

  const targetPeriodKey = useMemo(
    () =>
      getPeriodKey(
        selectedYear,
        MONTH_NAMES[selectedMonth - 1] ?? selectedMonth,
        selectedPeriod === "part2" ? "16th-end" : "1st-15th",
      ),
    [selectedYear, selectedMonth, selectedPeriod],
  );

  const rosterPeriodWithKey = useMemo(
    () => composeAdminRosterPeriod({ year: selectedYear, month: selectedMonth, split: selectedPeriod }),
    [selectedYear, selectedMonth, selectedPeriod],
  );

  const adminViewer = Boolean(org.profile && canManageOrg(org.profile.role));

  useEffect(() => {
    if (!adminViewer || !targetPeriodKey) return;
    const label = selectedPeriod === "part2" ? "16th–end" : "1st–15th";
    console.log(`[Roster] Selected period changed to: ${label}. Fetching period_key: ${targetPeriodKey}`);
    setAdminRosterPeriod(rosterPeriodWithKey);
    void refreshAdminRosterSheets(rosterPeriodWithKey);
  }, [adminViewer, selectedYear, selectedMonth, selectedPeriod, targetPeriodKey, rosterPeriodWithKey]);

  useEffect(() => {
    setMessage("");
  }, [entryRepId, diffRepId, printRepId, editWaitingRep?.person.id]);

  if (!org.profile || org.isLoadingProfile || !canReviewDeals(org.profile.role)) return null;

  const reps = entryRepsFor(org.profile, org.people, org.locationFilterId);
  const selected = reps.find((person) => person.id === entryRepId);
  const admin = canManageOrg(org.profile.role);
  const storeName = org.locations.find((item) => item.id === org.locationFilterId)?.name;
  const locationId = activeRosterLocationId(org.profile, org.locationFilterId);
  const storeSelected = !admin || hasStoreSelection(org.locationFilterId);
  const everyoneReadyCount = reps.filter((rep) => {
    const clearing = resolveClearinghouseRow({
      employeeId: rep.id,
      chain: chainForRep(org.approvalChains, rep.id),
      adminSheet: sheetForEmployee(org.adminSheets, rep.id, rosterPeriodWithKey),
    });
    return clearing.state === "match" || clearing.state === "discrepancies" || clearing.state === "authorized";
  }).length;
  const canAuthorizeCount = reps.filter((rep) => {
    const clearing = resolveClearinghouseRow({
      employeeId: rep.id,
      chain: chainForRep(org.approvalChains, rep.id),
      adminSheet: sheetForEmployee(org.adminSheets, rep.id, rosterPeriodWithKey),
    });
    return clearing.state === "match" || clearing.state === "discrepancies";
  }).length;
  const canPushAll = !admin && canAuthorizeCount > 0 && Boolean(locationId);
  const authorizedSheets = admin
    ? authorizedAdminSheetsForLocation({
        sheets: org.adminSheets,
        people: org.people,
        locationId,
        period: rosterPeriodWithKey,
      })
    : [];
  const canPrintAll = admin && Boolean(locationId) && authorizedSheets.length > 0;
  const pushAllEligibleIds = admin
    ? reps
        .filter((person) => {
          const sheet = sheetForEmployee(org.adminSheets, person.id, rosterPeriodWithKey);
          const status = adminPeriodRosterStatus({
            sheet,
            chain: chainForRep(org.approvalChains, person.id),
            period: rosterPeriodWithKey,
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
    ? sheetForEmployee(org.adminSheets, printPerson.id, rosterPeriodWithKey)
    : null;
  const printStoreName = printPerson?.location_id
    ? org.locations.find((item) => item.id === printPerson.location_id)?.name
    : storeName;

  async function handleAuthorize(repId: string) {
    const chain = chainForRep(org.approvalChains, repId);
    const adminSheet = sheetForEmployee(org.adminSheets, repId, rosterPeriodWithKey);
    const clearing = resolveClearinghouseRow({ employeeId: repId, chain, adminSheet });
    setBusyRepId(repId);
    setMessage("");
    const error = await approveAndPushToAdmin(repId, clearing.adminBaseline);
    setBusyRepId(null);
    if (error) {
      setMessage(friendlyManagerSheetError(error));
      return;
    }
    setToast("Authorized with Admin numbers. Sheet sent to Admin payroll.");
    window.setTimeout(() => setToast(""), 3600);
    retryCloudSync();
  }

  async function handleApprove(repId: string, displayedState?: TrackerState | null) {
    const chain = chainForRep(org.approvalChains, repId);
    const adminSheet = sheetForEmployee(org.adminSheets, repId, rosterPeriodWithKey);
    const clearing = resolveClearinghouseRow({ employeeId: repId, chain, adminSheet });
    const statusWasModified = clearing.state === "discrepancies";
    setBusyRepId(repId);
    setMessage("");
    const error = await approveAndPushToAdmin(repId, displayedState);
    setBusyRepId(null);
    if (error) {
      setMessage(friendlyManagerSheetError(error));
      return;
    }
    setDiffRepId(null);
    setToast(
      statusWasModified && displayedState === chain?.repDraft
        ? "Authorized. The Admin master sheet now matches the employee’s submitted changes and is finalized."
        : "Authorized. Admin’s sheet is locked and sent to payroll.",
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
      setMessage(friendlyManagerSheetError(error));
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
      setMessage(friendlyManagerSheetError(error));
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
        const clearing = resolveClearinghouseRow({
          employeeId: rep.id,
          chain: chainForRep(org.approvalChains, rep.id),
          adminSheet: sheetForEmployee(org.adminSheets, rep.id, rosterPeriodWithKey),
        });
        return clearing.state === "match" || clearing.state === "discrepancies";
      })
      .map((rep) => rep.id);
    for (const repId of readyIds) {
      const chain = chainForRep(org.approvalChains, repId);
      const clearing = resolveClearinghouseRow({
        employeeId: repId,
        chain,
        adminSheet: sheetForEmployee(org.adminSheets, repId, rosterPeriodWithKey),
      });
      const preferred =
        clearing.state === "discrepancies" ? clearing.repDraft : clearing.adminBaseline;
      const error = await approveAndPushToAdmin(repId, preferred);
      if (error) {
        setBusy(false);
        setMessage(friendlyManagerSheetError(error));
        return;
      }
    }
    const error = await pushAllToAdmin(locationId);
    setBusy(false);
    if (error) {
      setMessage(friendlyManagerSheetError(error));
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
      period: rosterPeriodWithKey,
      employeeIds: pushAllEligibleIds,
    });
    setPushAllBusy(false);
    if (result.error) {
      setMessage(friendlyManagerSheetError(result.error));
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

  function handleRosterPeriodChange(next: typeof rosterPeriodWithKey) {
    const year = next.year ?? selectedYear;
    const month = next.month ?? selectedMonth;
    const split = normalizeAdminRosterSplit(next.split);
    const periodKey = buildAdminRosterPeriodKey(year, month, split);
    console.log("Active Period Selection:", split);
    console.log(
      `[Roster] Selected period changed to: ${split === "part2" ? "16th–end" : "1st–15th"}. Fetching period_key: ${periodKey}`,
    );
    setSelectedYear(year);
    setSelectedMonth(month);
    setSelectedPeriod(split);
    setPrintRepId(null);
  }

  function openEmployeeSheet(personId: string, mode: "edit" | "print") {
    console.log(`[Modal] Opening sheet for employee: ${personId} with period_key: ${targetPeriodKey}`);
    setMessage("");
    setAdminRosterPeriod(rosterPeriodWithKey);
    if (mode === "print") {
      setPrintRepId(personId);
      return;
    }
    setPrintRepId(null);
    setEntryRepId(personId, true);
  }

  return (
    <>
      {admin ? (
        <section className="summary-card admin-roster-print">
          <div className="admin-roster-chrome no-print">
            <h2>Commission Pay Sheet Entry & Roster</h2>
            <p className="empty-note">
              Select a store and pay period, then click any salesperson row to open and edit their Master Pay Sheet. Enter
              deals, trade counts, gross, and bonuses, then Save Draft or Push to Manager.
            </p>
            <StoreFilterBar
              actions={
                <>
                  <AdminRosterPeriodControls period={rosterPeriodWithKey} onPeriodChange={handleRosterPeriodChange} />
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
                      {pushAllBusy ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Send data-icon="inline-start" />
                      )}
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
            {!storeSelected ? (
              <p className="store-select-prompt">Select a dealership store above to manage users.</p>
            ) : reps.length === 0 ? (
              <p className="empty-note">No sales reps match this store filter.</p>
            ) : null}
          </div>

          {storeSelected && reps.length > 0 ? (
            <ul className="roster-list">
              {reps.map((person) => {
                const chain = chainForRep(org.approvalChains, person.id);
                const selectedRow = person.id === entryRepId;
                const periodSheet = sheetForEmployee(org.adminSheets, person.id, rosterPeriodWithKey);
                console.log("[Badge Eval]", {
                  name: displayName(person),
                  period_key: rosterPeriodWithKey.key ?? null,
                  is_paid: periodSheet?.isPaid ?? null,
                });
                const periodStatus = adminPeriodRosterStatus({
                  sheet: periodSheet,
                  chain: sheetMatchesRosterPeriod(periodSheet, rosterPeriodWithKey) ? chain : null,
                  period: rosterPeriodWithKey,
                });
                const showPrintModal = shouldOpenPrintForPeriodStatus(periodStatus);
                const canReset =
                  hasResettablePush(org.allDeals, chain, person.id) &&
                  Boolean(periodSheet) &&
                  sheetMatchesRosterPeriod(periodSheet, rosterPeriodWithKey);

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
                          showPrintModal ? "Click row to open print sheet" : "Click row to edit pay sheet"
                        }
                        onClick={() => {
                          openEmployeeSheet(person.id, showPrintModal ? "print" : "edit");
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
                          openEmployeeSheet(person.id, showPrintModal ? "print" : "edit");
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
              })}
            </ul>
          ) : null}

          <div className="no-print">
            {selected && !printRepId ? (
              <AdminMasterSheetModal
                person={selected}
                period={rosterPeriodWithKey}
                periodKey={targetPeriodKey}
                onClose={() => {
                  setEntryRepId(null);
                  setMessage("");
                }}
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
              period={rosterPeriodWithKey}
              storeName={printStoreName}
              dealRows={org.allDeals}
              chain={printChain}
              onClose={() => setPrintRepId(null)}
              onMarkPaid={markSheetPaid}
            />
          ) : null}

          <AuthorizedSheetsPrintBatch
            sheets={authorizedSheets}
            people={reps}
            dealRows={org.allDeals}
            chains={org.approvalChains}
            period={rosterPeriodWithKey}
          />
        </section>
      ) : (
        <>
          <CollapsibleCard
            title="Manager clearinghouse"
            summary={String(reps.length)}
            className="manager-roster-card"
          >
            <p className="empty-note">
              Review Admin baselines and sales-rep submissions for your store. Green means 0 discrepancies —
              authorize in one click. Amber opens a side-by-side comparison. Awaiting Sales Rep lets you authorize
              the Admin version without waiting.
            </p>
            <div className="roster-toolbar">
              <Button disabled={busy || !canPushAll} onClick={() => void handlePushAll()}>
                Submit Ready Sheets to Admin
              </Button>
              {reps.length > 0 && everyoneReadyCount < reps.length ? (
                <p className="empty-note">
                  {everyoneReadyCount} of {reps.length} ready for Admin.
                </p>
              ) : null}
            </div>

            {reps.length === 0 ? (
              <p className="empty-note">
                {org.profile.role === "manager" && !org.profile.location_id
                  ? "Ask the admin to assign you to a location before reviewing a store roster."
                  : "No sales reps match this store filter."}
              </p>
            ) : (
              <ul className="roster-list">
                {reps.map((person) => {
                  const chain = chainForRep(org.approvalChains, person.id);
                  const selectedRow = person.id === entryRepId;
                  const submittedAt = lastSubmittedForRep(org.allDeals, person.id);
                  const adminSheet = previewSheetWithFallback(
                    sheetForEmployee(org.adminSheets, person.id),
                    person.id === entryRepId ? trackerState : null,
                    {
                      dealRows: org.allDeals.filter((row) => row.rep_id === person.id),
                      chain,
                    },
                  );
                  const clearing = resolveClearinghouseRow({
                    employeeId: person.id,
                    chain,
                    adminSheet,
                  });
                  const tone = clearinghouseTone(clearing);
                  const paid = isPaidAdminSheet(adminSheet?.status, adminSheet?.isPaid);
                  const showPrintModal = shouldShowFinalizedPrintPreview({
                    isAdmin: false,
                    rosterStatus: tone === "finalized" ? "finalized" : tone,
                    sheet: adminSheet,
                    chainStatus: chain?.status,
                  });

                  return (
                    <li key={person.id}>
                      <div className={`${rowClass(tone, selectedRow)} no-print`}>
                        <button
                          type="button"
                          className="roster-open"
                          onClick={() => {
                            setMessage("");
                            if (clearing.state === "discrepancies") {
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
                          <PersonIdentity person={person} showEmail={false} showTitle />
                          {submittedAt ? <span className="empty-note">{lastSubmittedLabel(submittedAt)}</span> : null}
                        </button>
                        <button
                          type="button"
                          className={badgeClass(tone, paid)}
                          onClick={() => {
                            if (clearing.state === "discrepancies") {
                              setDiffRepId(person.id);
                              return;
                            }
                            if (showPrintModal) setPrintRepId(person.id);
                          }}
                        >
                          {paid ? "PAID" : clearinghouseBadgeLabel(clearing)}
                        </button>
                        {clearing.state === "match" ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy || busyRepId === person.id}
                            onClick={() => void handleApprove(person.id)}
                          >
                            {busyRepId === person.id ? "Authorizing…" : AUTHORIZE_SEND_TO_ADMIN_LABEL}
                          </Button>
                        ) : clearing.state === "discrepancies" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || busyRepId === person.id}
                            onClick={() => setDiffRepId(person.id)}
                          >
                            Review discrepancies
                          </Button>
                        ) : clearing.state === "awaiting_rep" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy || busyRepId === person.id}
                              onClick={() => {
                                setMessage("");
                                setEditWaitingRep({
                                  person,
                                  period: chain?.monthId
                                    ? {
                                        ...rosterPeriodWithKey,
                                        key: chain.monthId,
                                        raw: chain.monthId,
                                      }
                                    : rosterPeriodWithKey,
                                });
                              }}
                            >
                              {REVIEW_EDIT_SHEET_LABEL}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy || busyRepId === person.id}
                              onClick={() => void handleAuthorize(person.id)}
                            >
                              {busyRepId === person.id ? "Authorizing…" : AUTHORIZE_ADMIN_SKIP_REP_LABEL}
                            </Button>
                          </>
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
                  {`Clearinghouse row for ${displayName(selected)}. Authorize matches, skip awaiting reps with Admin numbers, or open discrepancies to compare Admin vs Rep.`}
                </p>
                <div className="cloud-setup-actions">
                  <Button variant="outline" disabled={busy} onClick={() => setEntryRepId(null)}>
                    Back to my dashboard
                  </Button>
                </div>
              </div>
            ) : null}

            {toast ? (
              <p className="update-toast" role="status">
                {toast}
              </p>
            ) : null}
            {message ? <p className="form-error">{message}</p> : null}
          </CollapsibleCard>

          {diffChain && diffPerson ? (
            <ManagerApprovalModal
              person={diffPerson}
              chain={diffChain}
              dealRows={org.allDeals.filter((row) => row.rep_id === diffPerson.id)}
              busy={busyRepId === diffPerson.id}
              error={message}
              onClose={() => setDiffRepId(null)}
              onAcceptRep={(draft) => void handleApprove(diffPerson.id, draft)}
              onKeepAdmin={(baseline) => void handleApprove(diffPerson.id, baseline)}
              onEditAuthorize={() => {
                setDiffRepId(null);
                setEditWaitingRep({
                  person: diffPerson,
                  period: diffChain.monthId
                    ? {
                        ...rosterPeriodWithKey,
                        key: diffChain.monthId,
                        raw: diffChain.monthId,
                      }
                    : rosterPeriodWithKey,
                });
              }}
              onReject={(reason) => void handleDeny(diffPerson.id, reason)}
            />
          ) : null}

          {editWaitingRep ? (
            <ManagerEditSheetModal
              person={editWaitingRep.person}
              period={editWaitingRep.period}
              onClose={() => {
                setEditWaitingRep(null);
                retryCloudSync();
              }}
            />
          ) : null}

          {printPerson ? (
            <FinalizedWorksheetPreview
              person={printPerson}
              sheet={printSheet}
              period={rosterPeriodWithKey}
              storeName={printStoreName}
              dealRows={org.allDeals}
              chain={printChain}
              onClose={() => setPrintRepId(null)}
              onMarkPaid={markSheetPaid}
            />
          ) : null}
        </>
      )}
    </>
  );
}
