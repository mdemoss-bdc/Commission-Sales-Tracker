# Pay Tracker

Spreadsheet-style commission tracker for auto sales. Log every deal, apply the pack schedule, and total front-end gross with flats, F&I, service, and other backend products.

## Pay plan

Pack percent is based on **counted units** (a row counts when it has a stock number or customer name). The same rate is applied to **all** front-end gross:

| Units sold | Pack |
| --- | --- |
| Fewer than 4 | 20% of gross |
| 4–7 | 25% of gross |
| 8–11 | 30% of gross |
| 12+ | 30% of gross |

**Deal pay** = (gross × pack) + flat + F&I + service + Drive 360 + CarCare + GAP.

## Features

- Add as many sales as you need with **Add New Sale**
- Stock number, customer, and vehicle type (New Honda, Volkswagen, or Used)
- Gross, optional flat dollar amount, F&I, and service
- Drive 360, CarCare, and GAP columns to match a typical deal recap
- **F&I & Service** tab for backend-only entry
- Column totals, product totals, and vehicle mix
- Saved in this browser via localStorage

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
