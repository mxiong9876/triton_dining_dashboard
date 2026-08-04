# Triton Dining Dashboard

A personal analytics dashboard for UCSD dining habits (Triton2Go / Transact mobile
ordering). Import your dining receipts and see where your money goes: total spend,
favorite halls and vendors, and when during the week you actually eat.

---

## Getting started

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/** or whichever port is chosen.

---

## Loading data

### eAccounts card swipes — the main path

Transact eAccounts has no export feature, so a bookmarklet reads the transactions table
straight off the page you're already logged into. No API keys, no OAuth, no stored
credentials — it only reads the DOM the browser has already rendered.

**Install (once):** open Chrome's Bookmark Manager (`⌘⌥B`) command + option + B → ⋮ click 3 dots in top right of page → Add new bookmark.
Name it `Grab eAccounts` and paste the whole `javascript:…` line from
[`scripts/eaccounts-bookmarklet.js`](scripts/eaccounts-bookmarklet.js) as the URL. Save it
to the Bookmarks Bar. Chrome sometimes strips the `javascript:` prefix on paste — reopen
the bookmark and check.

**Use:**

1. eAccounts → **Account Transactions** → set a date range → **Search**.
2. Click **Grab eAccounts**. It copies the rows to your clipboard.
3. The report paginates at 15 rows. Click through each page and run it again — it
   accumulates in `sessionStorage`, so every click copies *everything* collected so far.
4. Dashboard → **Import** → **Card swipes (eAccounts)** → **Import from clipboard**. Once,
   at the end.

Closing the eAccounts tab clears the collection. Re-importing overlapping date ranges is
safe; duplicates are dropped.

> The report has a maximum date range and will bounce you to the account summary if you
> exceed it. Pull a couple of months at a time.

To regenerate the one-liner after editing
[`scripts/eaccounts-bookmarklet.src.js`](scripts/eaccounts-bookmarklet.src.js):

```bash
npm run build:bookmarklet
```

### Paste JSON

Works out of the box. Import tab → **Paste JSON**:

```json
[
  {"location":"64 Degrees","date":"2026-07-18","time":"18:42","total":14.25,"items":[{"name":"Poke Bowl","qty":1,"price":12.00},{"name":"Iced Tea","qty":1,"price":2.25}]},
  {"location":"Pines","date":"2026-07-15","time":"12:10","total":8.50,"items":[{"name":"Breakfast Burrito","qty":1,"price":8.50}]}
]
```
---

## Features

- **Dashboard** — KPI stubs (total spent, average order, most-visited hall, biggest order),
  spend-by-month bar chart, spend-by-location bar chart, a "Where you order" vendor
  breakdown, and a day-of-week × meal-slot heatmap. Time range: all / 90 / 30 / 7 days.
- **Receipts** — stored receipts newest first, with checkbox multi-select, select-all,
  quick-select by source, and bulk delete. Every delete confirms first.
- **Export** — CSV, JSON download, or copy JSON to clipboard. All respect the active time
  range; the JSON is re-importable via Paste JSON.
- **Persistence** — `localStorage`, under the key `triton-dining-receipts-v1`.

### Spend by month

Months with no orders are filled in as zero rather than skipped, so a summer off campus
reads as a gap instead of the chart interpolating across it. Once the axis passes eight
months it labels quarters only, with the year on a second line at each January.

---

## Data model

```ts
Receipt = {
  id: string,            // dedupe key
  source: 'card' | 'app' | 'market' | 'manual',
  location: string,      // canonical hall, e.g. "Sixth", "64 Degrees"
  concept: string | null,   // vendor within the hall, e.g. "Rooftop"  (card only)
  locationRaw: string | null, // original terminal string              (card only)
  date: 'YYYY-MM-DD',
  time: 'HH:MM' | null,  // 24h
  total: number,
  receiptNumber: string | null,
  paymentMethod: string | null,  // "Dining Dollars", "Triton Cash Meal Plan"
  items: [{ name: string, qty: number, price: number }]  // price = line total; empty for card swipes
}
```

---

## Project structure

```
index.html                            Page shell; loads Tailwind (CDN) + main.jsx
main.jsx                              Boots React, renders the dashboard into #root
triton-dining-dashboard.jsx           The whole app (one React component)
scripts/eaccounts-bookmarklet.js      Pasteable bookmarklet + install instructions
scripts/eaccounts-bookmarklet.src.js  Readable source for the above
scripts/build-bookmarklet.mjs         Minifies src → the one-liner
vite.config.js                        Vite + @vitejs/plugin-react
recipt-screenshots/                   Sample receipt screenshots
```

---

## Tech stack

- **Vite** + **React 18**
- **recharts** — charts
- **lucide-react** — icons
- **Tailwind** via CDN (utility classes); custom palette lives in inline styles
- **Design system** — receipt-paper aesthetic: navy `#16243D` ink, paper `#FAF9F4`,
  Triton gold `#FFCD00`, UCSD sea blue `#00629B`; Archivo (display) + IBM Plex Mono (data).

---

## Backlog

- Auto-paging the bookmarklet so one click walks the whole report
- Backend proxy for the Claude API, re-enabling screenshot parsing
- Gmail receipts for walkout markets (bookmarklet on the open email, or Gmail API readonly)
- Nutrition estimates per item
- Weekly budget pacing vs. Dining Dollars balance
- Streaks & fun stats (longest daily streak, most-repeated order)

---

## Notes

- **Privacy** — all data stays in your browser's `localStorage`. Nothing is uploaded, and
  it's scoped to one browser + `http://localhost:5173`. Clearing site data wipes it.
  Statement PDFs and CSV exports are gitignored; don't commit them.
- **AI parsing** — once screenshot import is wired up, Claude can misread a receipt;
  spot-check totals against the app.
- **eAccounts abroad** — the portal can reject requests from non-US IPs, bouncing every
  search back to the account summary. Connect to UCSD's VPN, then sign out and back in so
  the session starts from the campus IP.
