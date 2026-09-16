import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PUSHED,
  EMPLOYEE_ACCEPTED_NO_CHANGES_LABEL,
  MANAGER_APPROVED,
  MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL,
  PENDING_EMPLOYEE_ACCEPTANCE_LABEL,
  PENDING_EMPLOYEE_AND_MANAGER_APPROVAL_LABEL,
  REP_ACCEPTED_NO_CHANGES,
  REP_MODIFIED,
  SUBMITTED_TO_PAYROLL_ADMIN_LABEL,
  adminMasterAfterManagerApproval,
  approvalPayDelta,
  buildForcedRepModification,
  buildRepSubmission,
  chainFromPayTrackerRow,
  employeeSubmittedChangesLabel,
  formatSignedMoney,
  isResettablePushStatus,
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

test("rep accept without edits still overwrites admin master on manager approval", () => {
  const submit = buildRepSubmission({ adminBaseline: admin, repDraft: admin });
  assert.equal(submit.status, REP_ACCEPTED_NO_CHANGES);
  assert.equal(submit.payDelta, 0);
  assert.equal(shouldOverwriteAdminMaster(submit.status), true);
  const result = adminMasterAfterManagerApproval({
    status: submit.status,
    adminBaseline: admin,
    repDraft: admin,
  });
  assert.equal(result.overwritten, true);
  assert.equal(result.finalizedLabel, MANAGER_APPROVED_READY_FOR_PAYROLL_LABEL);
  assert.equal(result.state.months[0]?.sheets[0]?.bonuses[0]?.label, "Fast Start");
});

test("rep edits write a dollar delta and itemized diffs, then overwrite admin on manager approval", () => {
  const submit = buildRepSubmission({ adminBaseline: admin, repDraft: modified });
  assert.equal(submit.status, REP_MODIFIED);
  assert.ok(submit.payDelta !== 0);
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
  assert.equal(rosterApprovalLabel("accepted", 0, null, "manager"), EMPLOYEE_ACCEPTED_NO_CHANGES_LABEL);
  assert.equal(rosterToneFromChain(REP_MODIFIED), "modified");
  assert.equal(rosterApprovalLabel("modified", 219.99, null, "manager"), employeeSubmittedChangesLabel(219.99));
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
  assert.equal(isResettablePushStatus(REP_MODIFIED), true);
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
