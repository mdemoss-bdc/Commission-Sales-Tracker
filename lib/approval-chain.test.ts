import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PUSHED,
  ADMIN_FINAL_APPROVED,
  AUTHORIZE_AND_PUSH_TO_ADMIN_LABEL,
  LEGACY_MANAGER_APPROVED,
  LEGACY_REP_ACCEPTED_NO_CHANGES,
  MANAGER_APPROVED,
  MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL,
  PENDING_EMPLOYEE_ACCEPTANCE_LABEL,
  PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL,
  REJECTED_BY_MANAGER,
  REJECT_CHANGES_LABEL,
  REP_AUTHORIZED_NO_CHANGES,
  REP_ACCEPTED_NO_CHANGES,
  REP_MODIFIED,
  SALES_REP_AUTHORIZED_NO_CHANGES_LABEL,
  SUBMITTED_TO_PAYROLL_ADMIN_LABEL,
  adminMasterAfterManagerApproval,
  approvalPayDelta,
  buildForcedRepModification,
  buildRepSubmission,
  chainFromPayTrackerRow,
  employeeSubmittedChangesLabel,
  formatSignedMoney,
  isResettablePushStatus,
  managerActionItemCount,
  reviewDeltaDisplay,
  itemizedApprovalDiffs,
  normalizeApprovalStatus,
  rosterApprovalLabel,
  rosterToneFromChain,
  shouldOverwriteAdminMaster,
} from "./approval-chain.ts";
import type { TrackerState } from "./types.ts";

function sheet(patch: Partial<TrackerState["months"][number]["sheets"][number]> & { bonuses?: TrackerState["months"][number]["sheets"][number]["bonuses"]; sales?: TrackerState["months"][number]["sheets"][number]["sales"] }): TrackerState {
  return {
    vehicleTypes: [],
    months: [
      {
        id: "m1",
        year: 2026,
        month: 9,
        sheets: [
          {
            id: "s1",
            startDay: 1,
            endDay: 15,
            vacationHours: 0,
            vacationRate: 0,
            vacationPay: 0,
            bonuses: patch.bonuses ?? [],
            sales: patch.sales ?? [],
          },
        ],
      },
    ],
  };
}

const admin = sheet({
  bonuses: [{ id: "b1", label: "Fast Start", amount: 500 }],
  sales: [
    {
      id: "d1",
      stockNumber: "VT60611",
      customerName: "Pat",
      vehicleType: "",
      dealType: "new",
      tradeIn: false,
      gross: 2220.1,
      flat: 0,
      fi: 0,
      service: 0,
    },
  ],
});

const modified = sheet({
  bonuses: [],
  sales: [
    {
      id: "d1",
      stockNumber: "VT60611",
      customerName: "Pat",
      vehicleType: "",
      dealType: "new",
      tradeIn: false,
      gross: 2420.1,
      flat: 0,
      fi: 0,
      service: 0,
    },
  ],
});

test("legacy push statuses normalize to admin_pushed", () => {
  assert.equal(normalizeApprovalStatus("awaiting_review"), ADMIN_PUSHED);
  assert.equal(normalizeApprovalStatus("pending_rep_review"), ADMIN_PUSHED);
  assert.equal(normalizeApprovalStatus("pushed"), ADMIN_PUSHED);
  assert.equal(normalizeApprovalStatus(ADMIN_PUSHED), ADMIN_PUSHED);
});

test("rep authorize without edits does not overwrite the admin master", () => {
  const submit = buildRepSubmission({ adminBaseline: admin, repDraft: admin });
  assert.equal(submit.status, REP_AUTHORIZED_NO_CHANGES);
  assert.equal(submit.status, REP_ACCEPTED_NO_CHANGES);
  assert.equal(submit.payDelta, 0);
  assert.equal(shouldOverwriteAdminMaster(submit.status), false);
  const result = adminMasterAfterManagerApproval({
    status: submit.status,
    adminBaseline: admin,
    repDraft: admin,
  });
  assert.equal(result.overwritten, false);
  assert.equal(result.finalizedLabel, MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL);
  assert.equal(result.state.months[0]?.sheets[0]?.bonuses[0]?.label, "Fast Start");
});

test("rep edits write a dollar delta and itemized diffs, then overwrite admin on manager authorization", () => {
  const submit = buildRepSubmission({ adminBaseline: admin, repDraft: modified });
  assert.equal(submit.status, REP_MODIFIED);
  assert.ok(submit.payDelta !== 0);
  assert.equal(shouldOverwriteAdminMaster(submit.status), true);
  assert.equal(approvalPayDelta(500, 400), -100);
  assert.ok(submit.diffs.some((line) => line.summary.includes("VT60611") && line.summary.includes("$2,220.10") && line.summary.includes("$2,420.10")));
  assert.ok(submit.diffs.some((line) => line.summary.includes("Removed Fast Start")));
  const result = adminMasterAfterManagerApproval({
    status: submit.status,
    adminBaseline: admin,
    repDraft: modified,
  });
  assert.equal(result.overwritten, true);
  assert.equal(result.finalizedLabel, MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL);
  assert.deepEqual(result.state.months[0]?.sheets[0]?.bonuses, []);
  assert.equal(result.state.months[0]?.sheets[0]?.sales[0]?.gross, 2420.1);
});

test("itemized diffs include the requested sale and bonus wording", () => {
  const lines = itemizedApprovalDiffs(admin, modified);
  assert.ok(lines.some((line) => line.summary === "Stock #VT60611 Gross changed from $2,220.10 to $2,420.10"));
  assert.ok(lines.some((line) => line.summary.startsWith("Removed Fast Start")));
});

test("roster badges follow the 3-tier pipeline with admin vs manager copy", () => {
  assert.equal(rosterToneFromChain(ADMIN_PUSHED), "awaiting");
  assert.equal(rosterApprovalLabel("awaiting", 0, null, "manager"), PENDING_EMPLOYEE_ACCEPTANCE_LABEL);
  assert.equal(rosterApprovalLabel("awaiting", 0, null, "admin"), PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL);
  assert.equal(rosterToneFromChain(REP_ACCEPTED_NO_CHANGES), "accepted");
  assert.equal(rosterToneFromChain(LEGACY_REP_ACCEPTED_NO_CHANGES), "accepted");
  assert.equal(rosterApprovalLabel("accepted", 0, null, "manager"), SALES_REP_AUTHORIZED_NO_CHANGES_LABEL);
  assert.equal(AUTHORIZE_AND_PUSH_TO_ADMIN_LABEL, "Authorize & Push to Admin");
  assert.equal(REJECT_CHANGES_LABEL, "Reject Changes");
  assert.equal(rosterToneFromChain(REP_MODIFIED), "modified");
  assert.equal(rosterApprovalLabel("modified", 219.99, null, "manager"), employeeSubmittedChangesLabel(219.99));
  assert.equal(employeeSubmittedChangesLabel(219.99), "Employee Submitted Changes (+$219.99 diff)");
  assert.equal(formatSignedMoney(219.99), "+$219.99");
  assert.equal(formatSignedMoney(-500), "-$500.00");
  assert.deepEqual(reviewDeltaDisplay(1000, 1219.99), {
    adminPay: 1000,
    workingPay: 1219.99,
    delta: 219.99,
    label: "+$219.99",
    tone: "positive",
  });
  assert.equal(reviewDeltaDisplay(800, 300).tone, "negative");
  assert.equal(reviewDeltaDisplay(800, 300).label, "-$500.00");
  assert.equal(reviewDeltaDisplay(500, 500).tone, "neutral");
  assert.equal(reviewDeltaDisplay(500, 500).label, "$0.00");
  assert.equal(rosterToneFromChain(MANAGER_APPROVED), "finalized");
  assert.equal(rosterToneFromChain(ADMIN_FINAL_APPROVED), "finalized");
  assert.equal(rosterToneFromChain(LEGACY_MANAGER_APPROVED), "finalized");
  assert.equal(rosterToneFromChain(REJECTED_BY_MANAGER), "awaiting");
  assert.equal(rosterApprovalLabel("finalized", 0, null, "admin"), MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL);
  assert.equal(rosterApprovalLabel("finalized", 0, null, "manager"), SUBMITTED_TO_PAYROLL_ADMIN_LABEL);
});

test("submit-changes still writes rep_modified when the admin baseline is missing", () => {
  const forced = buildForcedRepModification({ adminBaseline: null, repDraft: modified });
  assert.equal(forced.status, REP_MODIFIED);
  assert.ok(forced.diffs.length > 0);
  assert.ok(forced.payDelta !== 0);
});

test("delete/reset covers every in-flight push status", () => {
  assert.equal(isResettablePushStatus(ADMIN_PUSHED), true);
  assert.equal(isResettablePushStatus(REP_ACCEPTED_NO_CHANGES), true);
  assert.equal(isResettablePushStatus(LEGACY_REP_ACCEPTED_NO_CHANGES), true);
  assert.equal(isResettablePushStatus(REP_MODIFIED), true);
  assert.equal(isResettablePushStatus(REJECTED_BY_MANAGER), true);
  assert.equal(isResettablePushStatus(MANAGER_APPROVED), true);
  assert.equal(isResettablePushStatus("draft"), false);
});

test("chainFromPayTrackerRow keeps a manager deny reason", () => {
  const chain = chainFromPayTrackerRow({
    id: "rep-1",
    employee_id: "rep-1",
    status: ADMIN_PUSHED,
    deny_reason: "  Missing stock 60611  ",
  });
  assert.equal(chain.denyReason, "Missing stock 60611");
});

test("managerActionItemCount counts approval-required and waiting only", () => {
  assert.equal(
    managerActionItemCount({
      chains: [
        { employeeId: "a", status: REP_MODIFIED },
        { employeeId: "b", status: ADMIN_FINAL_APPROVED },
        { employeeId: "c", status: "submitted_to_payroll" },
        { employeeId: "d", status: "paid" },
        { employeeId: "e", status: REP_AUTHORIZED_NO_CHANGES },
      ],
      waitingOnRepIds: ["f", "b"],
      includeWaitingOnEmployee: true,
    }),
    2,
  );
  assert.equal(
    managerActionItemCount({
      chains: [
        { employeeId: "a", status: ADMIN_PUSHED },
        { employeeId: "b", status: ADMIN_FINAL_APPROVED },
      ],
      waitingOnRepIds: ["a"],
      includeWaitingOnEmployee: true,
    }),
    1,
  );
  assert.equal(
    managerActionItemCount({
      chains: [{ employeeId: "a", status: "submitted_to_payroll" }],
      waitingOnRepIds: [],
    }),
    0,
  );
});
