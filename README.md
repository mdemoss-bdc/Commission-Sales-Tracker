# Pay Tracker

Spreadsheet-style commission tracker for auto sales. Keep a year of months on the home screen, open January–December as you go, and run up to two worksheets in each month.

## Pay plan

Pack percent is based on **counted units on that sheet** (a row counts when it has a stock number or customer name). The same rate is applied to **all** front-end gross on the sheet. Default tiers:

| Units sold | Pack |
| --- | --- |
| Fewer than 4 | 20% of gross |
| 4–7 | 25% of gross |
| 8–11 | 30% of gross |
| 12+ | 35% of gross |

Admins edit this schedule on the dashboard **Organization Pay Plan** card (min units, max units, pack %). **Save & Apply to All Sheets** calls `admin_update_pay_tiers` and stores the list on `organizations.pay_tiers`. Worksheets and the Pay plan sidebar read those tiers live, so every rep and manager sheet updates without a manual edit.

**Deal pay** = (gross × pack) + flat + F&I + service.

Sheet pay also adds vacation (hours × hourly rate) and any named bonuses on that form.

Month and year-to-date totals add the finished pay from each sheet. They do not re-average pack across sheets.

## Months and worksheets

- The first screen is a running total of every month: units, trade-ins, gross, F&I, service, flats, and total pay.
- Add a month by name (January, February, and so on) plus the year.
- Each month can hold **two** worksheets. Set each one to a date range such as **1st–15th** or **16th–end**.
- Open any month later to review or keep adding deals. Data saves in this browser and, when Supabase is connected, in the cloud.

## Cloud save (Supabase)

Copy `.env.example` to `.env.local` and add the project URL and anon key. Enable **Email** sign-in in the Supabase Auth settings.

Deal changes write to `deal_records` and a full worksheet snapshot in `pay_tracker_state` (and profile updates to `user_profiles`) first. A failed query logs to the console and shows a short toast; cloud sync keeps retrying in the background and never enters a **Cloud save paused** state.

Sign-in is required. Unauthenticated visits show a centered **Sign In / Create Account** screen (email + password) on `/` or `/signup`. Create Account has a **Join Existing Team** / **Register New Dealership** switcher.

**Join Existing Team** is the rooftop lock: enter a **Dealership Code** (placeholder: `e.g. 7K9X2B`). Codes are case-insensitive. On blur or after typing, the form calls `lookup_stores_by_org_code`. A valid code shows **✓ Connected to [Org Name]** and reveals **Select Your Location / Store** with only that group’s rooftops. An invalid code shows **✗ Invalid dealership code.** and keeps the store list hidden. Submit stays disabled until the name, a valid code, and an explicit store are all present. Account creation stores `full_name` and `location_id` in auth metadata, then calls `ensure_own_profile({ selected_location_id })` so join signups are **sales reps locked to that store**.

**Register New Dealership** is for a new store owner or GM. Fields are Dealership / Group Name, Your Full Name, email, and password. After `supabase.auth.signUp()`, the app calls `register_new_dealership_admin` with `org_name` and `admin_full_name` only. The database generates a collision-free 6-character join code. A taken name shows **This dealership name is already registered.** The new owner lands on the dashboard as **Admin** for that group.

Lists show that name in bold with the email underneath.

The header **Sales commission / Pay Tracker** title is a home link on every screen. Signed-in views also show **Home** next to Account settings and Sign Out, and worksheets include **← Home** beside the month back-link. Next to the role badge, every account (Admin, Manager, and Sales Rep) has an active **Store** picker. It loads rooftops from `get_available_org_locations` (only stores created in Locations settings), calls `set_my_location({ new_location_id })` on change, refreshes worksheet/roster data for that rooftop, and toasts **Active store changed to [Store Name].** If the signed-in profile has no `location_id`, the picker is replaced by **Join Dealership**. The dashboard shows a **Connect to Dealership** card: *You are not currently linked to a dealership group. Enter your group join code to connect your account and submit deals.* **Join Dealership** opens a modal with a 6-character code field (`lookup_stores_by_org_code` on blur/input), a rooftop dropdown, and **Connect Account**, which calls `join_organization_by_code({ input_code, target_location_id })`. Success writes `location_id` onto the local profile immediately, hides the banner and header button, toasts **Connected to dealership successfully!**, and refreshes stores plus the organization pay plan.

Click your name in the header to open **Account settings**: edit full name (saved to `user_profiles`), change email (`supabase.auth.updateUser({ email })`), or change password (`supabase.auth.updateUser({ password })`). Sign In includes **Forgot password?**, which emails a recovery link via `resetPasswordForEmail`. Opening that link shows a dedicated reset view at `/reset-password`.

Each signed-in user gets a `user_profiles` row (`id` = `auth.uid()`). Join-code signups are always **Sales Rep** — never the first store user as Admin. Registering a new dealership always creates an **Admin** for that organization. `matthewdemoss@gmail.com` is a sales rep; `matthewdemoss@mosescars.com` stays locked as Admin. Any admin can promote any other user to Admin, Manager, or Sales Rep without being demoted, and can delete another account from the People table (confirmation modal, then `delete_user_by_admin`). Admins create **locations** (chips with a remove button), change roles, and assign stores. The People table Role dropdown calls `admin_set_user_assignment` with the selected role and rooftop; promoting someone to Manager requires a store (toast: **Updated assignment for [User Name].**). The Location dropdown is always available to Admins, lists those same admin-created stores, and calls `admin_set_user_location({ target_user_id, target_location_id })` (toast: **Updated location for [User Name].**). **Roles Management** lists built-in roles plus custom roles stored in `public.custom_roles`; **Add Role** inserts a name such as BDC Rep, and those names appear in the People Role dropdown. The Admin screen opens with a **Dealership Share Code** card: large monospaced **DEALERSHIP JOIN CODE: [code]**, a **Copy Code** button (toast: **Dealership code copied! Share this with your managers and salespeople.**), and helper text that employees enter this code at signup. The **Organization Pay Plan** card edits unit tiers for the whole group. The People list stays empty until an admin picks a store (**Select a store to view team...**) or **Unassigned Users**. There is no All Stores option. Managers only see users, staged deals, pending pushes, and alerts tied to their own `location_id` — never employees at another rooftop. An admin push to an employee stamps that employee’s store so only that rooftop’s managers get the review prompt. The header shows your name, a role badge (`[Admin]`, `[Manager]`, or `[Sales Rep]`), and **Sign Out**.

After changing this schema, re-run it in the SQL editor (safe to re-run). Copy from GitHub **Raw**, not from a chat dump — a paste that cuts inside a `$$` function body fails with `unterminated dollar-quoted string`. Use either the full [`supabase/schema.sql`](https://github.com/mdemoss-bdc/Commission-Sales-Tracker/blob/main/supabase/schema.sql) or these two complete files in order:

1. [`supabase/sql-editor/01-core.sql`](https://github.com/mdemoss-bdc/Commission-Sales-Tracker/blob/main/supabase/sql-editor/01-core.sql) (or [Raw](https://raw.githubusercontent.com/mdemoss-bdc/Commission-Sales-Tracker/main/supabase/sql-editor/01-core.sql))
2. [`supabase/sql-editor/02-remainder.sql`](https://github.com/mdemoss-bdc/Commission-Sales-Tracker/blob/main/supabase/sql-editor/02-remainder.sql) (or [Raw](https://raw.githubusercontent.com/mdemoss-bdc/Commission-Sales-Tracker/main/supabase/sql-editor/02-remainder.sql))

Discard a failed query. Open a **new** SQL query (do not re-run the old editor tab). The first line of a good paste is `-- FOUND_ROW_SCHEMA`. If you instead see a comment about `rec public.user_profiles`, that is the old file and it will fail with `relation "rec" does not exist`. Scroll to the bottom and delete any auto-appended `ALTER TABLE` line before running. Composite variables are named `found_row`. `CREATE OR REPLACE` cannot change a function’s return type; the schema drops existing functions first so a re-run is not blocked by `42P13`.

That adds `admin_employee_sheets`, `upsert_admin_employee_sheet`, `mark_admin_employee_sheet_pushed`, `apply_manager_approval_to_admin_sheet`, `pay_tracker_state`, `upsert_pay_tracker_state`, `user_notifications`, `notify_rep_on_sheet_push`, `notify_reps_on_pay_push`, `notify_location_managers`, `mark_notification_read`, `awaiting_review`, `join_organization_by_code`, `get_available_org_locations`, `set_my_location`, `admin_set_user_location`, `custom_roles`, `user_profiles.custom_role_id`, join-code signups as sales reps only, `generate_dealership_join_code`, the two-argument `register_new_dealership_admin(org_name, admin_full_name)`, `admin_set_user_assignment`, rooftop-scoped manager deal visibility (`manager_covers_deal`), `organizations.pay_tiers`, `user_profiles.org_id`, `admin_update_pay_tiers`, `lookup_stores_by_org_code`, `set_organization_code`, the `ensure_own_profile(selected_location_id)` argument, `proposed_data`, `commit_proposed_to_live`, `previous_data`, `pending_admin_approval`, `rep_submit_to_manager`, and the rest of the review RPCs. Add `https://your-domain/reset-password` to the Supabase Auth redirect URLs.

Deal rows live in `deal_records`:

- `live_data` — the rep’s official tracker (updated when a manager approves, hits Push All, or the rep clicks **Accept & Lock**)
- `staged_data` — a staging buffer (admin/manager entry, or the values the rep confirmed)
- `proposed_data` — the manager push waiting on the rep (nullable jsonb). Null is treated as empty. **Push to employee** copies the staging payload here; **Accept & Lock** writes it into `live_data` and clears it.
- `previous_data` — the prior values used for red cell diffs (falls back to `proposed_data` until the column exists)

**Employee roster:** Admin and Manager screens list sales reps A–Z by full name (managers see only their store; admins must pick a store first). Selecting an employee on the Admin dashboard opens **Admin Master Sheet: [Employee Name]** — an isolated workbench with the standard deals table, bonus controls, and vacation pay. Admin edits write only to `admin_employee_sheets.sheet_data`. Reps never read that table; they only see `deal_records` / `pay_tracker_state`. **Push Sheet to Employee & Manager** marks the admin row `status = 'pushed'`, copies a snapshot into staging (`admin_pushed_snapshot` / `proposed_data`), and notifies the rep. The admin master stays intact. When the manager approves, `admin_employee_sheets.sheet_data` is overwritten with the approved numbers, `status = 'approved_final'`, and the sheet is locked for payroll export. After you push, the admin roster shows **Pending Employee & Manager Approval**. The store manager (for example Huntington) sees the same pushed sheet with **Pending Employee Acceptance** and cannot approve yet. When the employee accepts with no edits, the manager badge is **Employee Accepted (No Changes)**. When they edit, it is **Employee Submitted Changes (+$XX.XX / -$XX.XX difference)**; clicking that badge opens an itemized diff of added, deleted, or edited deals, spiffs, and bonuses. Managers then **Approve Changes & Submit to Admin** (overwrites the admin master and locks the sheet as **Submitted to Payroll/Admin**) or **Deny Changes** with a reason so the employee can revise. Admin never sees **Approve & Push to Admin**. **Delete / Reset Push** wipes `proposed_data`, pending payloads, unread push notifications, and resets the employee sheet to draft without clearing the admin master `sheet_data`. When a manager approves, the admin roster shows **Manager Approved — Ready for Payroll**.

The manager roster refreshes live (poll + realtime + `router.refresh` after the rep submits) so the badge does not stay stuck on Pending Employee Acceptance.

**Review chain:** Admin push → Employee & Manager → Employee action → Manager audit → Admin master overwrite.

1. **Push Sheet to Employee & Manager** never overwrites live data or the admin master `sheet_data`. The click packages the full current Admin Master Sheet (`deals`, `gross`, `units`, `trades`, F&I, `bonuses`, vacation, `month_id`, `employee_id`), upserts that snapshot into `pay_tracker_state` via `upsert_pay_tracker_state` (and `push_drafts_to_employee`) as `admin_pushed`, and sets `admin_employee_sheets.status = 'pushed'`. A notification is inserted for that rep only. The sales-rep dashboard and month view fetch `pay_tracker_state` (and `deal_records`) for `auth.uid()` from Supabase and override stale localStorage when a pushed sheet is waiting. **Check for Updates** next to **Add sales sheet** force-refetches if realtime is delayed. **Delete / Reset Push** (`recall_pending_push`) clears `proposed_data`, the approval-chain snapshot/draft/diffs, unread `pay_push` / `pay_sheet` notifications, sets the employee back to draft, and returns the admin master status to `draft` without wiping `sheet_data`.
2. The rep’s month view (`/m/[monthId]`) docks a persistent amber banner when there is an unread `pay_push` / `pay_sheet` notification or the sheet status is `admin_pushed` / `awaiting_review` / `pushed`. **Accept** records no-change acceptance for the store manager. **Edit Sheet / Make Corrections** lets the rep add missing deals, delete invalid ones, or fix dollar amounts. The only submit path is **Submit Changes to Manager** — never straight to Admin. If the manager denied a prior submit, the banner shows that reason and the last submitted draft stays on the sheet for revision.
3. The manager **Approval required** queue shows **one card per salesperson** — the latest pay period only, using the most recent `updated_at`. Re-pushing or re-submitting overwrites that pending record (older same-period rows are archived as superseded) so managers never see a stacked log of past versions. Each review card reads **Last submitted: [timestamp] (Latest Version)**.
4. The admin **Manager Submissions ([X] Complete, [Y] Pending)** tracker is a collapsible list of stores. It starts open when any store is still pending. **Pending Submissions** (red) means reps still have unsubmitted sheets or the manager has not approved them (`2 of 5 reps pending submission`). **Complete / Submitted** (green) means every rep at that store is locked live. Admins audit worksheets by selecting that store. They do not authorize deals.

Sign-in and sign-up always open the home dashboard (`/`), including when the browser still has an old worksheet URL from a previous session.

## Sheet features

- Add as many sales as you need with **Add New Sale**, or press **Tab** from the last Service cell of a filled row to append a blank lead and jump to its **Stock #**. **Shift+Tab** still moves backward.
- Stock number, customer, and a **Deal Type** you choose from your dealership categories (New, Used, Honda, Volkswagen, Lease Buyout, or anything else you add)
- **Deal Type** options are yours to set on the home screen or the sheet sidebar. They are not limited to Honda or Volkswagen.
- Trade-in checkbox, with a running trade count on the sheet, month, and home screen
- Gross, optional flat dollar amount, F&I, and service on the same recap grid
- Named bonuses (what the bonus is for + amount) and vacation hours × hourly rate on each sheet
- **Print sheet** prints a landscape recap at **75% scale** so deals, totals, and the recap sidebar fit on one page. The **By vehicle** mix (heading, table, and wrapper) is excluded from every print/PDF view, along with navigation and editors.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4539](http://127.0.0.1:4539).

```bash
npm run build
npm start
```

## Stack

Next.js, TypeScript, Tailwind CSS, and shadcn/ui.
