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

Sheet pay also adds vacation pay and any named bonuses on that form.

Month and year-to-date totals add the finished pay from each sheet. They do not re-average pack across sheets.

## Months and worksheets

- The first screen is a running total of every month: units, trade-ins, gross, F&I, service, flats, and total pay.
- Add a month by name (January, February, and so on) plus the year.
- Each month can hold **two** worksheets. Set each one to a date range such as **1st–15th** or **16th–end**.
- Open any month later to review or keep adding deals. Data saves in this browser and, when Supabase is connected, in the cloud.

## Cloud save (Supabase)

Copy `.env.example` to `.env.local` and add the project URL and anon key. Enable **Email** sign-in in the Supabase Auth settings.

Each signed-in user gets a `user_profiles` row (`id` = `auth.uid()`). The first account becomes the only **admin**; later accounts are **reps**. Only that admin can create **locations**, promote **managers**, or assign people to a store. Managers only see and approve reps at their own location.

Deal rows live in `deal_records`:

- `live_data` — the rep’s official tracker
- `staged_data` — a staging buffer (admin/manager entry, or a rep’s edit of a push)
- `proposed_data` — the original manager/admin push, used for diffs

**Employee entry mode:** admin or manager picks a rep, enters deals, then **Push to employee**. That does not overwrite live data. The rep gets a **Review manager submissions** banner and can **Accept as-is** (commits to live) or **Modify & submit** (status becomes `pending_manager_approval`). The manager/admin queue shows original vs rep edit, then **Approve** or **Reject** with a reason.

Run `supabase/schema.sql` in the SQL editor (safe to re-run). Without signing in, the tracker still works from local browser storage.

## Sheet features

- Add as many sales as you need with **Add New Sale**
- Stock number, customer, and a vehicle type you choose
- **Vehicle types** are yours to set (Toyota, Ford, Used, New, or anything else). They are not limited to Honda or Volkswagen. Manage them on the home screen or the sheet sidebar.
- Trade-in checkbox, with a running trade count on the sheet, month, and home screen
- Gross, optional flat dollar amount, F&I, and service on the same recap grid
- Named bonuses (what the bonus is for + amount) and optional vacation pay on each sheet
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
