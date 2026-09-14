# Pay Tracker

Spreadsheet-style commission tracker for auto sales. Keep a year of months on the home screen, open January–December as you go, and run up to two sales sheets in each month.

## Pay plan

Pack percent is based on **counted units on that sheet** (a row counts when it has a stock number or customer name). The same rate is applied to **all** front-end gross on the sheet:

| Units sold | Pack |
| --- | --- |
| Fewer than 4 | 20% of gross |
| 4–7 | 25% of gross |
| 8–11 | 30% of gross |
| 12+ | 35% of gross |

**Deal pay** = (gross × pack) + flat + F&I + service + Drive 360 + CarCare + GAP.

Sheet pay also adds vacation pay and any named bonuses on that form.

Month and year-to-date totals add the finished pay from each sheet. They do not re-average pack across sheets.

## Months and sheets

- The first screen is a running total of every month: units, trade-ins, gross, F&I, service, flats, and total pay.
- Add a month by name (January, February, and so on) plus the year.
- Each month can hold **two** sales sheets. Name them however you split the month.
- Open any month later to review or keep adding deals. Everything saves in this browser.

## Sheet features

- Add as many sales as you need with **Add New Sale**
- Stock number, customer, vehicle type (Honda, Volkswagen, or Used)
- Stock numbers that end in a letter auto-select **Used**. Starting with **H** and ending in a number selects Honda; starting with **V** and ending in a number selects Volkswagen.
- Trade-in checkbox, with a running trade count on the sheet, month, and home screen
- Gross, optional flat dollar amount, F&I, and service
- Drive 360, CarCare, and GAP columns
- Named bonuses (what the bonus is for + amount) and optional vacation pay on each sheet
- **F&I & Service** tab for backend-only entry
- **Print sheet** prints that individual recap

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
