import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPTED_NO_CHANGES_LABEL,
  ADMIN_PUSHED,
  APPROVED_FINALIZED_LABEL,
  APPROVED_FINALIZED_UPDATED_LABEL,
  AWAITING_REP_ACTION_LABEL,
  MANAGER_APPROVED,
  REP_ACCEPTED_NO_CHANGES,
  REP_MODIFIED,
  adminMasterAfterManagerApproval,
  approvalPayDelta,
  buildRepSubmission,
  formatSignedMoney,
  itemizedApprovalDiffs,
  modifiedByRepBadgeLabel,
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

test("rep accept without edits stays on the admin baseline", () => {
  const submit = buildRepSubmission({ adminBaseline: admin, repDraft: admin });
  assert.equal(submit.status, REP_ACCEPTED_NO_CHANGES);
  assert.equal(submit.payDelta, 0);
  assert.equal(shouldOverwriteAdminMaster(submit.status), false);
  const result = adminMasterAfterManagerApproval({
    status: submit.status,
    adminBaseline: admin,
    repDraft: admin,
  });
  assert.equal(result.overwritten, false);
  assert.equal(result.finalizedLabel, APPROVED_FINALIZED_LABEL);
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
  assert.equal(result.finalizedLabel, APPROVED_FINALIZED_UPDATED_LABEL);
  assert.deepEqual(result.state.months[0]?.sheets[0]?.bonuses, []);
  assert.equal(result.state.months[0]?.sheets[0]?.sales[0]?.gross, 2420.1);
});

test("itemized diffs include the requested sale and bonus wording", () => {
  const lines = itemizedApprovalDiffs(admin, modified);
  assert.ok(lines.some((line) => line.summary === "Stock #VT60611 Gross changed from $2,220.10 to $2,420.10"));
  assert.ok(lines.some((line) => line.summary.startsWith("Removed Fast Start")));
});

test("roster badges follow the 3-tier pipeline", () => {
  assert.equal(rosterToneFromChain(ADMIN_PUSHED), "awaiting");
  assert.equal(rosterApprovalLabel("awaiting"), AWAITING_REP_ACTION_LABEL);
  assert.equal(rosterToneFromChain(REP_ACCEPTED_NO_CHANGES), "accepted");
  assert.equal(rosterApprovalLabel("accepted"), ACCEPTED_NO_CHANGES_LABEL);
  assert.equal(rosterToneFromChain(REP_MODIFIED), "modified");
  assert.equal(rosterApprovalLabel("modified", 219.99), modifiedByRepBadgeLabel(219.99));
  assert.equal(formatSignedMoney(219.99), "+$219.99");
  assert.equal(formatSignedMoney(-500), "-$500.00");
  assert.equal(rosterToneFromChain(MANAGER_APPROVED), "finalized");
  assert.equal(rosterApprovalLabel("finalized"), APPROVED_FINALIZED_LABEL);
});
