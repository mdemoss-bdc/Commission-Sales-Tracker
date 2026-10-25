# AutoLaunch Pay — Rebuild Notes

Working copy of Commission-Sales-Tracker for the AutoLaunch Pay rebuild.
Live app/repo stay untouched except verified fixes pushed with Matthew's
standing rebuild authorization (2026-10-25).

## Product flow (Matthew, authoritative)

1. Rep enters their own sales/commissions as a personal log.
2. The corporate OFFICE (Admin) builds the official pay sheet per rep.
3. Office pushes the sheet — it lands with the rep AND the manager.
4. Rep compares the pushed sheet against their own log, edits where the
   office got it wrong, and submits to the manager (changed or not).
5. Manager sees exactly what changed + the $ discrepancy, approves/adjusts.
6. Manager's authorization returns the sheet to the office, finalized.
7. **Manager override is intentional**: the manager may authorize the office
   version without waiting for the rep (in case the rep can't act).
8. Deals are ALWAYS hand-entered. Never auto-import sold cars from
   AutoLaunch into pay sheets.

## Verified live (2026-10-25, Luna Test Motors test org)

Full loop works end-to-end; math matched hand-checks at every stage
(office $4,400 → rep corrected $5,050 → manager delta +$650 → finalized
$5,050; pack 20% at 3 units).

## Fixes made in this rebuild

1. **Build failure (was blocking Vercel)**: `app/favicon.ico` embedded a
   non-RGBA PNG; Next 16 Turbopack's ICO decoder rejects it
   ("The PNG is not in RGBA format"). Regenerated the ICO from the RGBA
   master. Pushed as commit `ef6f191`; local `npm run build` green.
2. **Admin Master Sheet draft never reloaded + phantom UNPUSHED flip**
   (one root cause): the master-sheet modal (and the manager edit modal)
   seeded an empty workbook on open through the store's normal `setState`,
   which marks a user edit and autosaves — the empty seed was upserted over
   the saved draft in `admin_employee_sheets` before the cloud load could
   restore it, and merely opening a sheet created a draft row
   (NOT STARTED → UNPUSHED). DB proof: an empty `draft` row for
   2026-10-part2 timestamped at the moment of a read-only open.
   Fix: `seedTrackerState()` in `lib/tracker-store.ts` applies a state
   without marking an edit, persisting locally, or queueing a cloud save;
   both modals seed through it. Explicit edits/saves persist as before.
3. **Onboarding guide URL**: pointed at the git-main preview deployment;
   now the production URL (`lib/employee-onboarding.ts` + tests).
4. **Manager Submissions empty state**: the card rendered literally
   nothing; it now shows an honest empty-state line.
5. **Sheet-not-found contrast**: `.summary-card a` forced dark-green text
   onto the primary "Back to all months" button (dark on dark). Button-
   styled links in summary cards now keep `--primary-foreground`.

## Rep-side comparison — restored (design + first wiring)

Finding: the comparison machinery was fully built but orphaned by the
clearinghouse redesign — `DualSheetReview` (side-by-side), `PushReviewBanner`,
`useRepPendingPush` (detection), and `sheet-compare`/`rep-review` (diffs)
all exist, but nothing mounted the banner or the review, and nothing
listened for the bell's open event. The rep got a bell count and a dead
click. Matthew's flow (step 4 above) requires the rep to compare, so the
rebuild restores it without touching the manager clearinghouse:

- `components/rep-push-review-dock.tsx` (new): rep-only dock used by
  `MonthPushReviewDock` on month and sheet pages. Docking decision reuses
  `shouldDockMonthPushBanner`. Renders `PushReviewBanner`; "Review Pushed
  Numbers" opens `DualSheetReview` in an overlay for the target sheet
  (office numbers vs the rep's live log, per-field diffs); Accept calls
  the existing `acceptPushedSheet`; Dismiss uses the existing session
  dismissal. The bell's open event now has a listener: it scrolls to the
  banner and opens the review.
- Follow-ups: home-page dock (`shouldDockHomePushBanner` exists; its
  clearinghouse-era tail restricts home docking to rejected sheets —
  revisit), and a live re-run of the 2026-10-25 flow script against this
  build to confirm the rep sees the planted $400 F&I diff before editing.

## Known remaining issues (from the live walkthroughs)

- New/Used deal type cannot be recorded (no field on the admin sheet;
  rep dropdown unconfigured) — all deals count as New. Pay math unaffected.
- Some ledger writes land with `period_key = NULL` (a `sent_to_manager`
  row from the rep submit step) — period-key resolution differs across
  write paths; audit `resolveAdminLedgerPeriodKey` callers.
- Roster filters didn't persist across loads — fixed in this rebuild:
  admin roster period + store filter now persist per device
  (localStorage in `lib/org-store.ts`) and restore on load.
- "Push to Manager" label understates the push (employee + manager) —
  the button already uses `PUSH_SHEET_TO_EMPLOYEE_AND_MANAGER_LABEL` in
  the master-sheet modal; check remaining surfaces.
- Manager queue labels: "APPROVAL REQUIRED 0" stays 0 while a sheet waits
  in the Clearinghouse; "YOUR STORE n" counts people, not sheets.

## Round 2 — live verification (2026-10-25 ~01:35–02:00 EDT; commits 1d6c981, 44534a4)

The test browser cannot reach this machine (its loopback is a different
host), so verification ran against the live Vercel deployment.

- Test A (phantom draft): PASS — open/close a master sheet untouched,
  roster stays NOT STARTED.
- Test B (draft reload): PASS — D7777 saved, roster UNPUSHED, reopen shows
  the deal with its numbers.
- Test C (push): PASS — toast + roster PENDING EMPLOYEE & MANAGER APPROVAL.
- Test D (rep review): FAILED on 1d6c981 — no banner anywhere. Root causes
  fixed in 44534a4:
  1. `isAdminLedgerActivelyPushed` did not count `sent_to_manager` as
     active — but that is the status the push itself writes, so every real
     push instantly read as inactive on the rep side, suppressing the
     pending state, the banner dock, and the review hook. (The banner
     therefore never fired in the original app either; in the 01:05 flow
     test the rep saw the pushed sheet only because the packet fallback
     materialized it when they had no live rows. A rep with any finalized
     period would never see a later push.)
  2. `pushDraftsToEmployee` called `markAdminEmployeeSheetPushed(repId)`
     with no period — the update rewrote every ledger row for the
     employee (a part2 push regressed the finalized part1 row back to
     sent_to_manager). Now passes the packet's period key.
  3. The rep dock now targets the pushed baseline (chain admin snapshot)
     and resolves the rep's live sheet by pay period, since sheet ids
     differ between the office workbook and the rep's log.
- Test D retest on 44534a4: PASS — the rep sees "Admin Pay Sheet Pushed",
  and Review opens the side-by-side: admin worksheet D7777 ($2,000 gross /
  $500 F&I / $900 pay) vs the rep's empty working sheet, net difference
  -$900, with Accept / Submit Reconciled actions. All four rebuild checks
  now pass live.
