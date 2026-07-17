# Triton Dining Dashboard

Personal analytics dashboard for UCSD dining habits (Triton2Go / Transact Mobile Ordering).
Owner: Michael, UCSD CS student. Started as a claude.ai artifact; now migrating to a real app.

## What it does
- Ingests dining receipts from three sources:
  1. **Screenshots** of receipts from the Triton2Go app, parsed into structured JSON by the Claude API (vision)
  2. **Gmail** receipts for walkout-market (Amazon Just Walk Out) purchases — the only purchases that email receipts
  3. **Manual JSON paste** (fallback for scraped data, e.g. from Transact eAccounts)
- Dedupes by receipt number (fallback key: date+time+location+total)
- Persists receipts and renders analytics:
  - KPI stubs: total spent, avg order, most-visited hall ("home base"), biggest order
  - Spend by month (area chart), spend by location (bar), top items (receipt-style list)
  - Day-of-week × meal-slot heatmap of when orders happen
  - Time range filter: all / 90 days / 30 days

## Data model
```ts
Receipt = {
  id: string,            // dedupe key
  source: 'app' | 'market' | 'manual',
  location: string,      // e.g. "64 Degrees", "Pines", "Canyon Vista", "OceanView"
  date: 'YYYY-MM-DD',
  time: 'HH:MM' | null,  // 24h
  total: number,
  receiptNumber: string | null,
  paymentMethod: string | null,
  items: [{ name: string, qty: number, price: number }]  // price = line total
}
```

## Current file
`triton-dining-dashboard.jsx` — single-file React component built for the claude.ai artifact runtime.
Design system: receipt-paper aesthetic. Navy #16243D ink, paper #FAF9F4, Triton gold #FFCD00,
UCSD sea blue #00629B. Fonts: Archivo (display) + IBM Plex Mono (data/receipt text).
Signature element: zigzag-perforated receipt stubs for stats and receipt cards.
Libraries: recharts, lucide-react, Tailwind utility classes + inline styles for custom colors.

## MIGRATION TODOS (claude.ai runtime → local app)
The artifact uses three claude.ai-only features that MUST be replaced:

1. `window.storage` (artifact key-value persistence)
   → Replace with localStorage for a quick start, or better: SQLite/JSON file behind a small API.
   Storage key used: `triton-dining-receipts-v1`, value = JSON array of Receipt.

2. `fetch("https://api.anthropic.com/v1/messages")` with NO API key
   → claude.ai injected auth. Locally: create a minimal backend route (Express/Hono/Next API route)
   that holds ANTHROPIC_API_KEY in env and forwards { model, messages }. Never put the key in
   client code. Model in use: claude-sonnet-4-6, max_tokens 1000.
   Receipt-parsing prompt lives in RECEIPT_SCHEMA_NOTE in the jsx — keep the strict-JSON contract.

3. `mcp_servers` Gmail connector in the API call
   → Not available outside claude.ai. Options: (a) drop Gmail sync for now, (b) implement Gmail API
   OAuth (readonly scope) server-side and feed email bodies to the same Claude parsing prompt.

## Suggested local setup
- Vite + React (or Next.js if adding the API-key proxy route feels natural)
- `npm i recharts lucide-react` ; Tailwind optional (only core utility classes are used;
  inline styles carry the custom palette, so it renders fine without Tailwind too)
- Keep the strict JSON response contract when calling Claude; parse with the fence-stripping helper.

## Ideas backlog
- eAccounts scraper for card-swipe transactions (no line items, but covers non-app purchases)
- Nutrition estimates per item via Claude
- Weekly budget pacing vs. Dining Dollars balance / projected run-out date
- Streaks & fun stats (longest daily streak, most-repeated exact order)
- Export to CSV
