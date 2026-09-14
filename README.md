# Pay Tracker

Spreadsheet-style commission tracker for auto sales. Keep a year of months on the home screen, open January–December as you go, and run up to two worksheets in each month.

## Pay plan

Pack percent is based on **counted units on that sheet** (a row counts when it has a stock number or customer name). The same rate is applied to **all** front-end gross on the sheet:

| Units sold | Pack |
| --- | --- |
| Fewer than 4 | 20% of gross |
| 4–7 | 25% of gross |
| 8–11 | 30% of gross |
| 12+ | 35% of gross |

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

Sign-in is required. Unauthenticated visits show a centered **Sign In / Create Account** screen (email + password). Create Account requires a **Full Name** and a **Store Location** dropdown of active dealerships from `locations` (placeholder: “Select your dealership store...”). Both are stored in auth `user_metadata` and inserted into `user_profiles` (`full_name`, `location_id`, default role **rep**). Lists show that name in bold with the email underneath.

The header **Sales commission / Pay Tracker** title is a home link on every screen. Signed-in views also show **Home** next to Account settings and Sign Out, and worksheets include **← Home** beside the month back-link.

Click your name in the header to open **Account settings**: edit full name (saved to `user_profiles`), change email (`supabase.auth.updateUser({ email })`), or change password (`supabase.auth.updateUser({ password })`). Sign In includes **Forgot password?**, which emails a recovery link via `resetPasswordForEmail`. Opening that link shows a dedicated reset view at `/reset-password`.

Each signed-in user gets a `user_profiles` row (`id` = `auth.uid()`). New accounts default to **rep**. If no admin exists yet, the first signup is stored as **admin** so the org is not locked out of People / Locations. Any admin can promote any user to admin without being demoted, and can delete another account from the People table (confirmation modal, then `delete_user_by_admin`). Admins create **locations** (chips with a remove button), change roles, and assign stores. They can filter People and Employee entry by **All Stores**, **Unassigned**, or a specific dealership. Managers only see users, staged deals, and pending approvals tied to their own `location_id`. The header shows your name, a role badge (`[Admin]`, `[Manager]`, or `[Sales Rep]`), and **Sign Out**.

After changing this schema, re-run the full `supabase/schema.sql` in the SQL editor (safe to re-run). That adds `previous_data`, `pending_admin_approval`, `rep_submit_to_manager`, and the rest of the review RPCs. Add `https://your-domain/reset-password` to the Supabase Auth redirect URLs.

Deal rows live in `deal_records`:

- `live_data` — the rep’s official tracker (updated only on admin final sign-off)
- `staged_data` — a staging buffer (admin/manager entry, or the values the rep confirmed)
- `previous_data` — the prior values used for red cell diffs (falls back to `proposed_data` until the column exists)

**Employee roster:** Admin and Manager screens list sales reps A–Z by full name (managers see only their store; admins honor the store filter). Open a name to enter that rep’s staging sheet. Green (**Ready / Submitted**) means the sheet is `pending_manager_approval` (or every deal is already submitted / you used **Authorize / Skip for Rep**). Amber (**Awaiting Employee**) is only `pending_rep_review`. **Push All to Admin** stays disabled until every visible rep is green, then calls `manager_push_all_to_admin` for the active store.

The manager roster refreshes live (poll + realtime + `router.refresh` after the rep submits) so the badge does not stay stuck on Awaiting Employee.

**Review chain:** Admin/Manager **Push to employee** → Rep confirmation → Manager approval with visual diff → Admin final sign-off.

1. **Push to employee** never overwrites live data. Pushed rows are flagged `pending_rep_review`.
2. The rep sees **Manager Updates Waiting for Review**: accept or decline brand-new deals, and for matching stock numbers pick **Keep Mine** or **Use Manager’s**. **Confirm & Submit** calls `rep_submit_to_manager` and sets `status = pending_manager_approval` (never `pending_rep_review`). It stores the manager’s original push in `previous_data`. Live records stay frozen.
3. The manager **Approval required** queue opens the **entire sheet** for that rep and month. Cells the employee changed or added have a coral background and red outline. Hover shows **Changed from: [previous]** or **Added by Rep**. Actions: **Approve & Forward to Admin** (`pending_admin_approval`) or **Reject with Reason**.
4. The admin **Pending final approval** queue shows the same red diffs. **Final Approve & Lock into Live Records** merges `staged_data` into `live_data` with `status: active`. **Return to Manager** sends the sheet back to `pending_manager_approval`.

## Sheet features

- Add as many sales as you need with **Add New Sale**
- Stock number, customer, a **Deal type** (New, Used, or Lease Buyout; default New), and a vehicle type you choose
- **Vehicle types** are yours to set (Toyota, Ford, Used, New, or anything else). They are not limited to Honda or Volkswagen. Manage them on the home screen or the sheet sidebar.
- Trade-in checkbox, with a running trade count on the sheet, month, and home screen
- Gross, optional flat dollar amount, F&I, and service on the same recap grid
- Named bonuses (what the bonus is for + amount) and vacation hours × hourly rate on each sheet
- **Print sheet** prints a landscape recap that fits one page: the deal grid, other pay, and totals — not the pay plan or on-screen scrollbars

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4527](http://127.0.0.1:4527).

```bash
npm run build
npm start
```

## Stack

Next.js, TypeScript, Tailwind CSS, and shadcn/ui.
