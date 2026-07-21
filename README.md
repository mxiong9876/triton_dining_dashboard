# Triton Dining Dashboard

A personal analytics dashboard for UCSD dining habits (Triton2Go / Transact mobile
ordering). Import your dining receipts and see where your money goes: total spend,
favorite halls, most-ordered items, and when during the week you actually eat.

---

## Getting started

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/** or whichever port is chosen.

### Loading data

There are three import paths (see [Status](#status--roadmap) for which work locally):

- **Paste JSON** — works out of the box, no API keys needed. Use this to try the app.
- **App screenshots** — parses Triton2Go receipt screenshots with the Claude API. *Not
  wired up locally yet* (needs the backend proxy).
- **Gmail sync** — pulls walkout-market email receipts. *Not available locally yet*.

To load sample data now: open the **Import** tab → **Paste JSON** panel → paste this, then
**Add receipts**:

format like below 

```json
[
  {"location":"64 Degrees","date":"2026-07-18","time":"18:42","total":14.25,"items":[{"name":"Poke Bowl","qty":1,"price":12.00},{"name":"Iced Tea","qty":1,"price":2.25}]},
  {"location":"Pines","date":"2026-07-15","time":"12:10","total":8.50,"items":[{"name":"Breakfast Burrito","qty":1,"price":8.50}]},
  {"location":"Canyon Vista","date":"2026-07-12","time":"21:05","total":6.75,"items":[{"name":"Ramen","qty":1,"price":5.00},{"name":"Egg","qty":1,"price":1.75}]}
]
```

Data persists in the browser's `localStorage` — refresh and it's still there.

---

## Features

- **Dashboard** — KPI stubs (total spent, average order, most-visited hall, biggest order),
  spend-by-month area chart, spend-by-location bar chart, most-ordered items, and a
  day-of-week × meal-slot heatmap. Time-range filter: all / 90 / 30 / 7 days.
- **Receipts** — full list of stored receipts, newest first, with per-receipt delete and
  clear-all.
- **Export** — an **Export ▾** menu on the dashboard with:
  - Download CSV (`receipts.csv`)
  - Download JSON (`receipts.json`) — re-importable via Paste JSON
  - Copy JSON (to clipboard)
  - All three respect the active time-range filter.
- **Persistence** — receipts are saved to `localStorage` under the key
  `triton-dining-receipts-v1`.

---

## Data model

```ts
Receipt = {
  id: string,            // dedupe key (receipt number, or date+time+location+total)
  source: 'app' | 'market' | 'manual',
  location: string,      // e.g. "64 Degrees", "Pines", "Canyon Vista"
  date: 'YYYY-MM-DD',
  time: 'HH:MM' | null,  // 24h
  total: number,
  receiptNumber: string | null,
  paymentMethod: string | null,
  items: [{ name: string, qty: number, price: number }]  // price = line total
}
```

Receipts are de-duplicated by receipt number (fallback: date + time + location + total).

---

## Project structure

```
index.html                     Page shell; loads Tailwind (CDN) + main.jsx
main.jsx                       Boots React, renders the dashboard into #root
vite.config.js                 Vite + @vitejs/plugin-react
package.json                   Dependencies and scripts
triton-dining-dashboard.jsx    The whole app (one React component)
recipt-screenshots/            Sample receipt screenshots
components/                     Older copy of the component (not used by the app)
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

## Status / roadmap

Migrating from the claude.ai artifact runtime to a standalone app:

- [x] Vite + React scaffold, runs locally
- [x] `localStorage` persistence (replaces the artifact's `window.storage`) — TODO #1
- [x] CSV / JSON / Copy-JSON export
- [ ] **Backend API proxy** so screenshot parsing works locally without exposing an API
  key — TODO #2
- [ ] **Gmail sync** for walkout-market receipts (readonly OAuth + server-side parse) — TODO #3

### Backlog ideas

- eAccounts scraper for card-swipe transactions
- Nutrition estimates per item
- Weekly budget pacing vs. Dining Dollars balance
- Streaks & fun stats (longest daily streak, most-repeated order)

---

## Notes

- **Privacy** — all data stays in your browser's `localStorage`. Nothing is uploaded, and
  it's scoped to one browser + `http://localhost:5173`. Clearing site data wipes it.
- **AI parsing** — once screenshot import is wired up, Claude can misread a receipt;
  spot-check totals against the app.
```