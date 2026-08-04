import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  Upload, Mail, Trash2, Receipt, TrendingUp, MapPin, Utensils,
  Loader2, CheckCircle2, AlertCircle, ClipboardPaste, X,
} from "lucide-react";

/* ---------- design tokens ---------- */
const C = {
  navy: "#16243D",      // ink
  navySoft: "#2B3D5C",
  paper: "#FAF9F4",     // receipt paper
  paperEdge: "#EFEDE4",
  gold: "#FFCD00",      // Triton gold
  sea: "#00629B",       // UCSD sea blue
  seaLight: "#5B8DB8",
  coral: "#C4622D",
  inkFaint: "#6B7688",
  line: "#DDD9CC",
};
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "'Archivo', -apple-system, 'Segoe UI', sans-serif";

const STORAGE_KEY = "triton-dining-receipts-v1";

/* ---------- helpers ---------- */
const fmt$ = (n) => "$" + (Number(n) || 0).toFixed(2);
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEAL_SLOTS = [
  { label: "Breakfast", from: 5, to: 11 },
  { label: "Lunch", from: 11, to: 15 },
  { label: "Afternoon", from: 15, to: 18 },
  { label: "Dinner", from: 18, to: 22 },
  { label: "Late night", from: 22, to: 29 }, // wraps past midnight
];

function receiptKey(r) {
  return r.receiptNumber
    ? "rn:" + String(r.receiptNumber).trim()
    : ["k", r.date, r.time || "", r.location || "", r.total].join("|");
}

// Loose identity for cross-source matching. A card swipe and the Triton2Go
// receipt for the SAME purchase share a date and a total, but nothing else —
// the swipe has no receipt number and a different location spelling.
function looseKey(r) {
  return `${r.date}|${Number(r.total).toFixed(2)}`;
}

// eAccounts writes locations as "<org> <venue> <code> <concept> <channel>", e.g.
// "HDH Oceanview Terrace OVT Spice Mobile Ordering" or "RRSS Goodys Marketplace
// Goodys Marketplace JWO". Match the venue by substring so those collapse to the
// same hall as app receipts. ORDER MATTERS: "North Torrey Pines" also contains
// "Pines", and "Sixth Market NTP" also contains "NTP".
const VENUE_PATTERNS = [
  [/goody'?s/i, "Goody's Marketplace"],
  [/sixth market/i, "Sixth Market"],
  [/seventh market/i, "Seventh Market"],
  // Rooftop and Wolftown are vendors inside the Sixth dining hall at North Torrey
  // Pines, not venues of their own — the hall is what belongs on the location
  // axis, and parseConcept picks the counter back out.
  [/north torrey pines|\brooftop\b|\bwolftown\b/i, "Sixth"],
  [/ocean\s?view/i, "OceanView Terrace"],
  [/64\s*-?\s*degrees|64\s*-?\s*burger/i, "64 Degrees"],
  [/canyon vista/i, "Canyon Vista"],
  [/foodworx/i, "Foodworx"],
  [/ventanas/i, "Cafe Ventanas"],
  [/club med/i, "Club Med"],
  [/bombay/i, "Bombay Coast"],
  [/tapioca/i, "Tapioca Express"],
  [/blue pepper/i, "Blue Pepper"],
  [/panda express/i, "Panda Express"],
  [/\broots\b/i, "Roots"],
  [/\bpines\b/i, "Pines"],
];

// These ride the same card accounts but aren't food — they'd inflate "total spent".
const NON_DINING = /laundry|kiosoft|bookstore|print|parking/i;

// Building codes eAccounts inserts between the venue and the counter, and the
// org/channel padding around them.
const BUILDING_CODES = ["ovt", "ntp", "ntpr", "cv", "pc", "rimac"];
const TERMINAL_NOISE = new Set(["hdh", "rrss", "ucsd", "jwo", "mobile", "order", "ordering"]);
// eAccounts abbreviates some counters down to initials — expanded per word.
const CONCEPT_ALIASES = { wt: "Wolftown" };
// Counters whose terminal name is shorter than what the venue is actually called.
// Applied to the assembled concept, keyed lowercase.
const CONCEPT_RENAMES = {
  "earls": "Earls Coffee House",
  "burger lounge": "64 Triton Grill",
};
const normWords = (s) =>
  String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// eAccounts terminal strings are "<org> <venue> <CODE> <counter> <channel>", e.g.
// "HDH Oceanview Terrace OVT Scholars Pizza Mobile". Whatever survives after the
// venue and the padding is the counter you ordered from — not line items, but the
// closest thing the portal records about WHAT you bought. Null when the string
// only restates the hall ("RRSS Goodys Marketplace Goodys Marketplace JWO").
function parseConcept(raw, hall) {
  let text = normWords(raw);
  if (!text) return null;

  // Everything after the last building code, when one is present.
  for (const code of BUILDING_CODES) {
    const re = new RegExp(`(?:^| )${code}(?= |$)`, "g");
    let end = -1, m;
    while ((m = re.exec(text))) end = m.index + m[0].length;
    if (end > -1) { text = text.slice(end); break; }
  }

  const hallWords = new Set(normWords(hall).split(" ").filter(Boolean));
  const words = text.split(" ").filter(
    (w) => w && !TERMINAL_NOISE.has(w) && !BUILDING_CODES.includes(w) && !/^\d+$/.test(w) && !hallWords.has(w)
  );
  const uniq = [...new Set(words)];
  if (!uniq.length) return null;
  const label = uniq.map((w) => CONCEPT_ALIASES[w] || w[0].toUpperCase() + w.slice(1)).join(" ");
  return CONCEPT_RENAMES[label.toLowerCase()] || label;
}

// eAccounts usually names a terminal twice ("Sunshine Market Sunshine Market JWO").
// Drop any block of words immediately repeated after itself, longest run first.
function collapseRepeats(words) {
  for (let n = Math.floor(words.length / 2); n >= 1; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      const a = words.slice(i, i + n).join(" ").toLowerCase();
      const b = words.slice(i + n, i + 2 * n).join(" ").toLowerCase();
      if (a === b) return collapseRepeats([...words.slice(0, i + n), ...words.slice(i + 2 * n)]);
    }
  }
  return words;
}

// Canonical hall name, or null for a non-dining charge (the caller drops those).
function normalizeLocation(raw) {
  const clean = String(raw || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Unknown";
  if (NON_DINING.test(clean)) return null;
  for (const [re, name] of VENUE_PATTERNS) if (re.test(clean)) return name;
  // Unrecognized venue: drop the org prefix and the ordering-channel suffix, then
  // de-duplicate, so it charts readably instead of as the raw terminal string.
  const tidied = clean
    .replace(/^(HDH|RRSS|UCSD)\s+/i, "")
    .replace(/\s+(JWO|Mobile Ordering|Mobile Order|Mobile)$/i, "")
    .trim();
  return collapseRepeats(tidied.split(" ").filter(Boolean)).join(" ") || clean;
}

function parseDateTime(r) {
  if (!r.date) return null;
  const t = r.time && /^\d{1,2}:\d{2}/.test(r.time) ? r.time : "12:00";
  const d = new Date(`${r.date}T${t.padStart(5, "0")}:00`);
  return isNaN(d.getTime()) ? null : d;
}

function monthLabel(d) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function stripFences(text) {
  return text.replace(/```json|```/g, "").trim();
}

async function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Could not read " + file.name));
    r.readAsDataURL(file);
  });
}

/* ---------- Claude API calls ---------- */
const RECEIPT_SCHEMA_NOTE = `Respond ONLY with JSON, no markdown fences, in this exact shape:
{"receipts":[{"location":string,"date":"YYYY-MM-DD","time":"HH:MM" (24h) or null,"total":number,"receiptNumber":string or null,"paymentMethod":string or null,"items":[{"name":string,"qty":number,"price":number}]}]}
Rules: one entry per distinct receipt/order visible. "price" is the line total for that item. If a field is unreadable, use null. Normalize location names (e.g. "64 Degrees", "Pines", "Canyon Vista", "OceanView", "The Bistro", "Sixty-Four North"). If nothing looks like a receipt, return {"receipts":[]}.`;

async function parseScreenshot(file) {
  const b64 = await fileToBase64(file);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } },
          { type: "text", text: "This is a screenshot from the Transact / Triton2Go mobile ordering app showing one or more order receipts from UC San Diego dining. Extract every receipt visible.\n" + RECEIPT_SCHEMA_NOTE },
        ],
      }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const parsed = JSON.parse(stripFences(text));
  return (parsed.receipts || []).map((r) => ({ ...r, source: "app" }));
}

async function syncGmailReceipts(existingKeys) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content:
          "Search my Gmail for purchase receipts from UC San Diego campus markets — senders or subjects mentioning 'Transact', 'Triton2Go', 'Just Walk Out', 'UCSD market', or 'HDH'. Read the most recent matching receipt emails (up to 15) and extract each purchase.\n" +
          RECEIPT_SCHEMA_NOTE,
      }],
      mcp_servers: [{ type: "url", url: "https://gmailmcp.googleapis.com/mcp/v1", name: "gmail-mcp" }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "API error");
  const texts = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  // The final text block should hold the JSON
  for (let i = texts.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(stripFences(texts[i]));
      return (parsed.receipts || []).map((r) => ({ ...r, source: "market" }));
    } catch { /* keep looking */ }
  }
  throw new Error("Couldn't find structured receipt data in the Gmail response.");
}

/* ---------- eAccounts (Transact) card-swipe parser — deterministic, no API tokens ---------- */
// Returns the first non-empty value among candidate field names (portals vary).
function pickField(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
}

// Maps raw eAccounts transaction rows -> the app's Receipt shape. Card swipes
// have no line items, so `items` is always empty.
function parseTransactTransactions(rows) {
  const pad = (n) => String(n).padStart(2, "0");
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;

    // amount may be a number (-14.25) or a string ("(14.25) USD")
    const rawAmt = pickField(row, ["amount", "transactionAmount", "value"]);
    const amt =
      typeof rawAmt === "number"
        ? rawAmt
        : parseFloat(String(rawAmt).replace(/[^0-9.\-]/g, ""));
    if (!isFinite(amt)) continue;

    // Purchases leave the account, so they're negative here; positive rows are
    // deposits/credits and get skipped (this is a spending log).
    if (amt >= 0) continue;

    // datetime -> date (YYYY-MM-DD) + time (HH:MM)
    const dtRaw = pickField(row, ["datetime", "dateTime", "transactionDate", "date", "postedDate"]);
    const d = dtRaw ? new Date(dtRaw) : null;
    if (!d || isNaN(d.getTime())) continue;

    // Laundry and other non-food charges share these accounts — drop them.
    const rawWhere = pickField(row, ["location", "locationName", "activity", "merchant", "terminalName"]);
    const where = normalizeLocation(rawWhere);
    if (where === null) continue;

    out.push({
      source: "card",
      location: where,
      // Keep the terminal string so concepts can be re-derived later without a
      // fresh import if the parsing rules change.
      locationRaw: rawWhere || null,
      concept: parseConcept(rawWhere, where),
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      total: Math.abs(amt),
      receiptNumber: pickField(row, ["transactionId", "id", "referenceNumber"]),
      paymentMethod: pickField(row, ["account", "accountName", "tenderName"]),
      items: [],
    });
  }
  return out;
}

// Card swipes keep the terminal string they came from, so when the venue rules
// change the hall and counter can be re-derived on load instead of forcing a
// re-import. Receipts from other sources have no locationRaw and pass through.
function remapStored(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || !r.locationRaw) { if (r) out.push(r); continue; }
    const where = normalizeLocation(r.locationRaw);
    if (where === null) continue; // reclassified as non-dining
    const next = { ...r, location: where, concept: parseConcept(r.locationRaw, where) };
    out.push({ ...next, id: receiptKey(next) });
  }
  return out;
}

/* ---------- small components ---------- */
function ZigzagEdge({ color = C.paper }) {
  return (
    <div
      aria-hidden
      style={{
        height: 10,
        backgroundImage: `linear-gradient(-45deg, transparent 7px, ${color} 7px), linear-gradient(45deg, transparent 7px, ${color} 7px)`,
        backgroundSize: "14px 14px",
        backgroundPosition: "left bottom",
        backgroundRepeat: "repeat-x",
        transform: "rotate(180deg)",
      }}
    />
  );
}

function StatStub({ label, value, sub }) {
  return (
    <div className="flex-1 min-w-0" style={{ minWidth: 150 }}>
      <div style={{ background: C.paper, boxShadow: "0 2px 10px rgba(22,36,61,0.12)" }}>
        <div className="px-4 pt-4 pb-3">
          <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.14em", color: C.inkFaint, textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 28, color: C.navy, lineHeight: 1.2, marginTop: 2 }} className="truncate">
            {value}
          </div>
          {sub && (
            <div style={{ fontFamily: MONO, fontSize: 13, color: C.inkFaint, marginTop: 2 }} className="truncate">
              {sub}
            </div>
          )}
        </div>
      </div>
      <ZigzagEdge />
    </div>
  );
}

function Panel({ title, children, right }) {
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${C.line}`, borderRadius: 4 }} className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: C.navySoft, fontWeight: 600 }}>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function ChartTip({ active, payload, label, money }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: C.navy, color: C.paper, fontFamily: MONO, fontSize: 13, padding: "6px 10px", borderRadius: 3 }}>
      <div style={{ opacity: 0.7 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i}>{p.name}: {money ? fmt$(p.value) : p.value}</div>
      ))}
    </div>
  );
}

// X-axis tick for the monthly timeline. Now that empty months are filled in, a
// full history is ~2 years of bars and a label under every one would collide.
// Instead: label quarters only once the axis gets long, and print the year on a
// second line at January (and at the first tick) so the year is never repeated
// across twelve labels. No rotated text — angled labels are slower to read.
function MonthTick({ x, y, payload, months, quarterly }) {
  const m = months.find((mo) => mo.label === payload.value);
  if (!m) return null;
  const monthNum = Number(m.key.slice(5));
  const isFirst = months[0] === m;
  if (quarterly && !isFirst && monthNum % 3 !== 1) return null;

  const style = { fontFamily: MONO, fontSize: 12, fill: C.inkFaint, textAnchor: "middle" };
  return (
    <g transform={`translate(${x},${y})`}>
      <text {...style} dy={12}>{m.label.slice(0, 3)}</text>
      {(monthNum === 1 || isFirst) && (
        <text {...style} dy={26} opacity={0.75}>{"’" + m.key.slice(2, 4)}</text>
      )}
    </g>
  );
}

/* ---------- main app ---------- */
export default function TritonDiningDashboard() {
  const [receipts, setReceipts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [range, setRange] = useState("all"); // all | 90 | 30
  const [busy, setBusy] = useState(null); // status message while importing
  const [log, setLog] = useState([]); // import results log
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);
  const exportRef = useRef(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [eaOpen, setEaOpen] = useState(false);
  const [eaText, setEaText] = useState("");
  // Selection is by position in `receipts`, so it must not outlive a change to
  // that list — stale indexes would delete the wrong rows.
  const [selected, setSelected] = useState(() => new Set());

  // Mirror of `receipts` that updates synchronously. Importers need to read the
  // current list without passing a function to setReceipts — React invokes those
  // updaters twice under StrictMode, which would double every side effect inside
  // them. It also lets back-to-back imports (handleFiles loops over screenshots)
  // see each other's results before React has re-rendered.
  const receiptsRef = useRef(receipts);
  useEffect(() => { receiptsRef.current = receipts; }, [receipts]);

  // Any import or delete reshuffles positions, so drop the selection with it.
  useEffect(() => { setSelected(new Set()); }, [receipts]);

  /* load persisted data */
  useEffect(() => {
    // localStorage is synchronous, so no async/await needed here.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = remapStored(JSON.parse(raw));
        receiptsRef.current = stored;
        setReceipts(stored);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }
    } catch { /* first run — nothing stored yet */ }
    setLoaded(true);
  }, []);

  const persist = useCallback(async (next) => {
    receiptsRef.current = next;
    setReceipts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "Saved in this session only — storage write failed." }, ...l]);
    }
  }, []);

  const addReceipts = useCallback((incoming) => {
    {
      const current = receiptsRef.current;
      const keys = new Set(current.map(receiptKey));
      // Loose matching runs ACROSS sources only. Two card swipes that share a day
      // and a total are usually two real purchases (the same $9.80 lunch twice),
      // and receiptKey already separates them by time — so only itemized receipts
      // go in here, and only card swipes get tested against it.
      const richLoose = new Set(current.filter((r) => r.source !== "card").map(looseKey));
      const cardAt = new Map();
      current.forEach((r, i) => { if (r.source === "card") cardAt.set(looseKey(r), i); });

      const superseded = new Set(); // indexes of card swipes replaced this round
      const fresh = [];
      // Every incoming row lands in exactly one of these, so they sum to
      // incoming.length alongside the added count. `replaced` is separate: it
      // counts existing swipes removed, not incoming rows rejected.
      let already = 0;  // identical receipt already stored
      let covered = 0;  // card swipe for a purchase an itemized receipt already has
      let unusable = 0; // no date or no total — nothing we can chart

      for (const r of incoming) {
        if (!r || !r.date || r.total == null) { unusable++; continue; }
        const k = receiptKey(r);
        if (keys.has(k)) { already++; continue; }
        const lk = looseKey(r);

        if (r.source === "card") {
          // An itemized receipt for this purchase already exists — the swipe would
          // double-count it, and it carries no line items anyway.
          if (richLoose.has(lk)) { covered++; continue; }
        } else {
          // Richer receipt for a purchase we only had as a bare swipe: drop the swipe.
          richLoose.add(lk);
          const i = cardAt.get(lk);
          if (i !== undefined) { superseded.add(i); cardAt.delete(lk); }
        }

        keys.add(k);
        fresh.push({ ...r, id: k, items: Array.isArray(r.items) ? r.items : [] });
      }

      // Same collision, but within this one batch (a swipe added just above, then
      // an app receipt for it): the itemized receipt wins.
      const batchRich = new Set(fresh.filter((r) => r.source !== "card").map(looseKey));
      const keptFresh = fresh.filter((r) => !(r.source === "card" && batchRich.has(looseKey(r))));
      covered += fresh.length - keptFresh.length;

      const kept = current.filter((_, i) => !superseded.has(i));
      const next = [...kept, ...keptFresh].sort((a, b) => (a.date < b.date ? 1 : -1));

      // Side effects live out here, run exactly once per import.
      receiptsRef.current = next;
      setReceipts(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

      // Name only what actually happened — a run with nothing to report just says
      // how many were added.
      const added = keptFresh.length;
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const notes = [];
      if (already) notes.push(`${already} already imported`);
      if (covered) notes.push(`${plural(covered, "card swipe")} already covered by a full receipt`);
      if (superseded.size) notes.push(
        superseded.size === 1
          ? "1 card swipe upgraded to a full receipt"
          : `${superseded.size} card swipes upgraded to full receipts`
      );
      if (unusable) notes.push(`${plural(unusable, "row")} skipped (no date or total)`);
      setLog((l) => [{
        ok: true,
        msg: `Added ${plural(added, "receipt")}` + (notes.length ? ` — ${notes.join(", ")}.` : "."),
      }, ...l]);
    }
  }, []);

  /* import handlers */
  async function handleFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (let i = 0; i < list.length; i++) {
      setBusy(`Reading screenshot ${i + 1} of ${list.length}…`);
      try {
        const found = await parseScreenshot(list[i]);
        if (found.length) addReceipts(found);
        else setLog((l) => [{ ok: false, msg: `${list[i].name}: no receipt found in image.` }, ...l]);
      } catch (e) {
        setLog((l) => [{ ok: false, msg: `${list[i].name}: ${e.message}` }, ...l]);
      }
    }
    setBusy(null);
  }

  async function handleGmail() {
    setBusy("Searching Gmail for market receipts…");
    try {
      const found = await syncGmailReceipts();
      if (found.length) addReceipts(found);
      else setLog((l) => [{ ok: false, msg: "No market receipts found in Gmail." }, ...l]);
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "Gmail sync: " + e.message }, ...l]);
    }
    setBusy(null);
  }

  function handlePaste() {
    try {
      const parsed = JSON.parse(stripFences(pasteText));
      const arr = Array.isArray(parsed) ? parsed : parsed.receipts;
      if (!Array.isArray(arr)) throw new Error("Expected a JSON array or {receipts:[...]}");
      addReceipts(arr.map((r) => ({ ...r, source: r.source || "manual" })));
      setPasteText("");
      setPasteOpen(false);
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "Paste: " + e.message }, ...l]);
    }
  }

  // Deterministic eAccounts import (no API tokens). Accepts a raw JSON array of
  // transactions (or {transactions|data|rows|receipts:[...]}).
  function importEaccounts(rawText) {
    try {
      const parsed = JSON.parse(stripFences(rawText));
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed.transactions || parsed.data || parsed.rows || parsed.receipts;
      if (!Array.isArray(rows)) throw new Error("Expected a JSON array of transactions");
      const found = parseTransactTransactions(rows);
      if (!found.length) throw new Error("No purchases found (deposits/credits are skipped).");
      addReceipts(found);
      setEaText("");
      setEaOpen(false);
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "eAccounts: " + e.message }, ...l]);
    }
  }

  async function importEaccountsFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) throw new Error("Clipboard is empty.");
      importEaccounts(text);
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "eAccounts clipboard: " + e.message }, ...l]);
    }
  }

  // Delete by position, not by id. Older saved receipts can be missing an `id`
  // or share one, and filtering on it would drop every match — or, when the id is
  // undefined, every receipt that also lacks one — instead of the card clicked.
  async function removeReceipt(index) {
    const r = receipts[index];
    const what = r ? `${r.location || "Unknown"} · ${r.date} · ${fmt$(r.total)}` : "this receipt";
    if (!window.confirm(`Delete this receipt?\n\n${what}\n\nThis can't be undone.`)) return;
    await persist(receipts.filter((_, i) => i !== index));
  }

  /* ---- bulk selection ---- */
  const toggleSelect = (i) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const allSelected = receipts.length > 0 && selected.size === receipts.length;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(receipts.map((_, i) => i)));

  // Quick-select every receipt from one source — the fast way to clear out card
  // swipes for a re-import without touching itemized screenshot receipts.
  const selectBySource = (src) =>
    setSelected(new Set(receipts.reduce((acc, r, i) => (r.source === src ? [...acc, i] : acc), [])));

  async function deleteSelected() {
    if (!selected.size) return;
    const n = selected.size;
    if (!window.confirm(`Delete ${n} receipt${n === 1 ? "" : "s"}?\n\nThis can't be undone.`)) return;
    await persist(receipts.filter((_, i) => !selected.has(i)));
  }

  async function clearAll() {
    await persist([]);
    setLog([]);
  }

  /* ---- export helpers ---- */
  function receiptsToCsv(data) {
    const header = ["date", "time", "location", "items", "cost"];
    const rows = data.map((r) =>
      [
        r.date,
        r.time,
        r.location,
        (r.items || []).map((it) => it.name).join(";"),
        r.total,
      ].join(",")
    );
    return [header.join(","), ...rows].join("\n");
  }

  // Build an <a> in code and click it to trigger a browser download.
  function downloadFile(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = filename;
    el.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    downloadFile("receipts.csv", receiptsToCsv(filtered), "text/csv");
    setExportOpen(false);
  }

  function exportJson() {
    downloadFile("receipts.json", JSON.stringify(filtered, null, 2), "application/json");
    setExportOpen(false);
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filtered, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "Copy failed: " + e.message }, ...l]);
    }
    setExportOpen(false);
  }

  /* close the export menu when clicking anywhere outside it */
  useEffect(() => {
    if (!exportOpen) return;
    function onDocClick(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [exportOpen]);

  /* filtered view */
  const filtered = useMemo(() => {
    if (range === "all") return receipts;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(range));
    return receipts.filter((r) => {
      const d = parseDateTime(r);
      return d && d >= cutoff;
    });
  }, [receipts, range]);

  /* analytics */
  const stats = useMemo(() => {
    const total = filtered.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const count = filtered.length;

    const byLocation = {};
    const byMonth = {};
    const byConcept = {};
    const heat = {}; // day-slot -> count
    let biggest = null;

    for (const r of filtered) {
      const loc = r.location || "Unknown";
      byLocation[loc] = byLocation[loc] || { location: loc, visits: 0, spend: 0 };
      byLocation[loc].visits += 1;
      byLocation[loc].spend += Number(r.total) || 0;

      // Counter within a hall ("Scholars Pizza" at OceanView). Only card swipes
      // carry one, and only where the hall has separate counters at all.
      if (r.concept) {
        const c = `${r.concept} · ${loc}`;
        byConcept[c] = byConcept[c] || { name: r.concept, location: loc, visits: 0, spend: 0 };
        byConcept[c].visits += 1;
        byConcept[c].spend += Number(r.total) || 0;
      }

      const d = parseDateTime(r);
      if (d) {
        const mk = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        byMonth[mk] = byMonth[mk] || { key: mk, label: monthLabel(d), spend: 0, orders: 0 };
        byMonth[mk].spend += Number(r.total) || 0;
        byMonth[mk].orders += 1;

        if (r.time) {
          const hour = Number(r.time.split(":")[0]);
          const day = (d.getDay() + 6) % 7; // Mon=0
          const slot = MEAL_SLOTS.findIndex((s) => {
            const h = hour < 5 ? hour + 24 : hour;
            return h >= s.from && h < s.to;
          });
          if (slot >= 0) heat[day + "-" + slot] = (heat[day + "-" + slot] || 0) + 1;
        }
      }

      if (!biggest || (Number(r.total) || 0) > (Number(biggest.total) || 0)) biggest = r;
    }

    const locations = Object.values(byLocation).sort((a, b) => b.visits - a.visits);
    const concepts = Object.values(byConcept).sort((a, b) => b.visits - a.visits).slice(0, 8);

    // Walk every month from the first to the last, inserting empty ones. Without
    // this, a summer with no orders vanishes from the axis and the chart implies
    // steady spending across a gap you were never on campus for.
    const monthKeys = Object.keys(byMonth).sort();
    const months = [];
    if (monthKeys.length) {
      const first = monthKeys[0].split("-").map(Number);
      const last = monthKeys[monthKeys.length - 1].split("-").map(Number);
      let y = first[0], m = first[1];
      while (y < last[0] || (y === last[0] && m <= last[1])) {
        const mk = y + "-" + String(m).padStart(2, "0");
        months.push(byMonth[mk] || { key: mk, label: monthLabel(new Date(y, m - 1, 1)), spend: 0, orders: 0 });
        if (m === 12) { m = 1; y++; } else { m++; }
      }
    }
    const maxHeat = Math.max(1, ...Object.values(heat));

    return { total, count, avg: count ? total / count : 0, locations, concepts, months, heat, maxHeat, biggest };
  }, [filtered]);

  const topLoc = stats.locations[0];

  /* ---------- render ---------- */
  return (
    <div style={{ minHeight: "100vh", background: C.paperEdge, fontFamily: SANS, color: C.navy }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap');
        input[type=file] { display: none; }
        button:focus-visible, [role=tab]:focus-visible { outline: 2px solid ${C.sea}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* header */}
      <header style={{ background: C.navy, color: C.paper }}>
        <div className="w-4/5 mx-auto py-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.2em", color: C.gold }}>
              ★ TRITON2GO · PERSONAL LEDGER ★
            </div>
            <h1 style={{ fontFamily: SANS, fontWeight: 800, fontSize: 30, letterSpacing: "-0.01em" }}>
              Dining Habits
            </h1>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 13, opacity: 0.75 }}>
            {loaded ? `${receipts.length} receipts on file` : "loading…"}
          </div>
        </div>
        {/* tabs */}
        <div className="w-4/5 mx-auto flex gap-1" role="tablist">
          {[["dashboard", "Dashboard"], ["import", "Import"], ["receipts", "Receipts"]].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="px-4 py-2"
              style={{
                fontFamily: MONO, fontSize: 14, letterSpacing: "0.08em",
                background: tab === id ? C.paperEdge : "transparent",
                color: tab === id ? C.navy : C.paper,
                border: "none", cursor: "pointer",
                borderRadius: "4px 4px 0 0",
                fontWeight: tab === id ? 600 : 400,
              }}
            >
              {label.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="w-4/5 mx-auto py-6">
        {busy && (
          <div className="flex items-center gap-2 mb-4 p-3" style={{ background: C.navy, color: C.paper, borderRadius: 4, fontFamily: MONO, fontSize: 14 }}>
            <Loader2 size={14} className="animate-spin" /> {busy}
          </div>
        )}

        {/* ------- DASHBOARD ------- */}
        {tab === "dashboard" && (
          receipts.length === 0 ? (
            <div className="text-center py-16">
              <Receipt size={36} style={{ color: C.inkFaint, margin: "0 auto 12px" }} />
              <p style={{ fontFamily: SANS, fontWeight: 700, fontSize: 20 }}>No receipts yet</p>
              <p style={{ color: C.inkFaint, fontSize: 16, marginTop: 4 }}>
                Head to the Import tab — upload receipt screenshots from the Triton2Go app to get started.
              </p>
              <button
                onClick={() => setTab("import")}
                className="mt-4 px-5 py-2"
                style={{ background: C.gold, color: C.navy, fontFamily: MONO, fontSize: 14, fontWeight: 600, border: "none", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em" }}
              >
                IMPORT RECEIPTS
              </button>
            </div>
          ) : (
            <>
              {/* range filter */}
              <div className="flex justify-end mb-4">
                <div className="flex gap-1">
                  {[["all", "All time"], ["90", "90 days"], ["30", "30 days"], ["7", "7 days"]].map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setRange(v)}
                      className="px-3 py-1"
                      style={{
                        fontFamily: MONO, fontSize: 13, cursor: "pointer", borderRadius: 3,
                        border: `1px solid ${range === v ? C.navy : C.line}`,
                        background: range === v ? C.navy : "#FFF",
                        color: range === v ? C.paper : C.navySoft,
                      }}
                    >
                      {l}
                    </button>
                  ))}
                  <div ref={exportRef} style={{ position: "relative" }}>
                    <button
                      onClick={() => setExportOpen((o) => !o)}
                      className="px-3 py-1"
                      style={{
                        fontFamily: MONO, fontSize: 13, cursor: "pointer", borderRadius: 3,
                        border: "none",
                        background: C.gold,
                        color: C.navy,
                      }}
                    >
                      {copied ? "✓ Copied" : "Export ▾"}
                    </button>
                    {exportOpen && (
                      <div
                        style={{
                          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20,
                          background: "#FFF", border: `1px solid ${C.line}`, borderRadius: 3,
                          boxShadow: "0 4px 14px rgba(22,36,61,0.15)", minWidth: 150, overflow: "hidden",
                        }}
                      >
                        {[
                          ["Download CSV", exportCsv],
                          ["Download JSON", exportJson],
                          ["Copy JSON", copyJson],
                        ].map(([label, action], i) => (
                          <button
                            key={label}
                            onClick={action}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              fontFamily: MONO, fontSize: 13, cursor: "pointer",
                              padding: "8px 12px",
                              background: "#FFF", color: C.navy,
                              border: "none",
                              borderTop: i === 0 ? "none" : `1px solid ${C.line}`,
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16">
                  <Receipt size={32} style={{ color: C.inkFaint, margin: "0 auto 10px" }} />
                  <p style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18 }}>No orders in this time range</p>
                  <p style={{ color: C.inkFaint, fontSize: 15, marginTop: 4 }}>
                    Nothing here for the selected window — pick a wider range above, or switch back to All time.
                  </p>
                </div>
              ) : (
                <>
              {/* stat stubs */}
              <div className="flex gap-3 flex-wrap mb-6">
                <StatStub label="Total spent" value={fmt$(stats.total)} sub={`${stats.count} orders`} />
                <StatStub label="Avg order" value={fmt$(stats.avg)} />
                <StatStub
                  label="Home base"
                  value={topLoc ? topLoc.location : "—"}
                  sub={topLoc ? `${topLoc.visits} visits · ${fmt$(topLoc.spend)}` : ""}
                />
                <StatStub
                  label="Biggest order"
                  value={stats.biggest ? fmt$(stats.biggest.total) : "—"}
                  sub={stats.biggest ? `${stats.biggest.location || ""} · ${stats.biggest.date || ""}` : ""}
                />
              </div>

              <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                {/* spend over time */}
                <Panel title="Spend by month">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={stats.months} margin={{ top: 4, right: 4, left: -18, bottom: 14 }} barCategoryGap={2}>
                      <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
                      <XAxis
                        dataKey="label"
                        interval={0}
                        height={38}
                        axisLine={false}
                        tickLine={false}
                        tick={<MonthTick months={stats.months} quarterly={stats.months.length > 8} />}
                      />
                      <YAxis tick={{ fontFamily: MONO, fontSize: 12, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: C.navy, fillOpacity: 0.05 }} content={<ChartTip money />} />
                      <Bar dataKey="spend" name="Spend" fill={C.sea} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>

                {/* by location */}
                <Panel title="Where the money goes">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={stats.locations.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="location" width={110} tick={{ fontFamily: MONO, fontSize: 12, fill: C.navySoft }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTip money />} />
                      <Bar dataKey="spend" name="Spend" radius={[0, 3, 3, 0]}>
                        {stats.locations.slice(0, 6).map((_, i) => (
                          <Cell key={i} fill={i === 0 ? C.gold : C.sea} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>


                {/* counters within halls — the closest thing card swipes have to items */}
                {stats.concepts.length > 0 && (
                  <Panel title="Where you order">
                    <div style={{ background: C.paper, padding: "12px 14px" }}>
                      {stats.concepts.map((c, i) => (
                        <div
                          key={c.name + c.location}
                          className="flex justify-between gap-2 py-1"
                          style={{ fontFamily: MONO, fontSize: 14, borderBottom: i < stats.concepts.length - 1 ? `1px dashed ${C.line}` : "none" }}
                        >
                          <span className="truncate">
                            {c.name}
                            <span style={{ color: C.inkFaint, fontSize: 12 }}> · {c.location}</span>
                          </span>
                          <span style={{ whiteSpace: "nowrap", color: C.navySoft }}>×{c.visits} · {fmt$(c.spend)}</span>
                        </div>
                      ))}
                      <ZigzagEdge color={C.paper} />
                    </div>
                  </Panel>
                )}

                {/* heatmap — spans the full second row */}
                <div style={{ gridColumn: "1 / -1" }}>
                <Panel title="When you eat">
                  <div className="overflow-x-auto">
                    <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${MEAL_SLOTS.length}, 1fr)`, gap: 3, minWidth: 320 }}>
                      <div />
                      {MEAL_SLOTS.map((s) => (
                        <div key={s.label} style={{ fontFamily: MONO, fontSize: 11, color: C.inkFaint, textAlign: "center" }}>{s.label}</div>
                      ))}
                      {DAY_NAMES.map((day, di) => (
                        <React.Fragment key={day}>
                          <div style={{ fontFamily: MONO, fontSize: 12, color: C.navySoft, alignSelf: "center" }}>{day}</div>
                          {MEAL_SLOTS.map((_, si) => {
                            const v = stats.heat[di + "-" + si] || 0;
                            return (
                              <div
                                key={si}
                                title={`${day} ${MEAL_SLOTS[si].label}: ${v} order${v === 1 ? "" : "s"}`}
                                style={{
                                  height: 40, borderRadius: 3,
                                  background: v === 0 ? "#F1EFE7" : C.sea,
                                  opacity: v === 0 ? 1 : 0.25 + 0.75 * (v / stats.maxHeat),
                                }}
                              />
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  <p style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint, marginTop: 8 }}>
                    Darker = more orders in that slot. Needs receipts with a time stamp.
                  </p>
                </Panel>
                </div>
              </div>
                </>
              )}
            </>
          )
        )}

        {/* ------- IMPORT ------- */}
        {tab === "import" && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <Panel title="App receipt screenshots">
              <p style={{ fontSize: 15, color: C.navySoft, marginBottom: 12 }}>
                In Triton2Go, open each receipt and screenshot it. Upload the images here — Claude reads out the items, prices, location and date automatically. Duplicates are skipped by receipt number.
              </p>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} />
              <button
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={!!busy}
                className="w-full py-3 flex items-center justify-center gap-2"
                style={{ background: C.gold, color: C.navy, fontFamily: MONO, fontSize: 14, fontWeight: 600, border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer", letterSpacing: "0.08em", opacity: busy ? 0.6 : 1 }}
              >
                <Upload size={14} /> UPLOAD SCREENSHOTS
              </button>
            </Panel>

            <Panel title="Market receipts from Gmail">
              <p style={{ fontSize: 15, color: C.navySoft, marginBottom: 12 }}>
                Walkout-market purchases send email receipts. This searches your connected Gmail for Transact / Just Walk Out receipts and pulls them in.
              </p>
              <button
                onClick={handleGmail}
                disabled={!!busy}
                className="w-full py-3 flex items-center justify-center gap-2"
                style={{ background: C.navy, color: C.paper, fontFamily: MONO, fontSize: 14, fontWeight: 600, border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer", letterSpacing: "0.08em", opacity: busy ? 0.6 : 1 }}
              >
                <Mail size={14} /> SYNC FROM GMAIL
              </button>
            </Panel>

            <Panel
              title="Paste JSON"
              right={
                <button onClick={() => setPasteOpen(!pasteOpen)} style={{ background: "none", border: "none", cursor: "pointer", color: C.sea }}>
                  {pasteOpen ? <X size={14} /> : <ClipboardPaste size={14} />}
                </button>
              }
            >
              <p style={{ fontSize: 15, color: C.navySoft, marginBottom: 12 }}>
                Already have data from a scraper or export? Paste an array of receipts:{" "}
                <code style={{ fontFamily: MONO, fontSize: 13 }}>{"[{location,date,time,total,receiptNumber,items:[{name,qty,price}]}]"}</code>
              </p>
              {pasteOpen && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={6}
                    className="w-full p-2 mb-2"
                    style={{ fontFamily: MONO, fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 3, resize: "vertical" }}
                    placeholder='[{"location":"64 Degrees","date":"2026-07-01","time":"18:42","total":12.5,"items":[{"name":"Poke Bowl","qty":1,"price":12.5}]}]'
                  />
                  <button
                    onClick={handlePaste}
                    className="px-4 py-2"
                    style={{ background: C.sea, color: "#FFF", fontFamily: MONO, fontSize: 14, border: "none", borderRadius: 3, cursor: "pointer" }}
                  >
                    Add receipts
                  </button>
                </>
              )}
            </Panel>

            <Panel
              title="Card swipes (eAccounts)"
              right={
                <button onClick={() => setEaOpen(!eaOpen)} style={{ background: "none", border: "none", cursor: "pointer", color: C.sea }}>
                  {eaOpen ? <X size={14} /> : <ClipboardPaste size={14} />}
                </button>
              }
            >
              <p style={{ fontSize: 15, color: C.navySoft, marginBottom: 12 }}>
                Import card-swipe history from Transact eAccounts — no API tokens, no line items. Run the “Grab eAccounts” bookmarklet (setup in <code style={{ fontFamily: MONO, fontSize: 13 }}>scripts/eaccounts-bookmarklet.js</code>) on your Account Transactions page, then:
              </p>
              <button
                onClick={importEaccountsFromClipboard}
                disabled={!!busy}
                className="w-full py-3 flex items-center justify-center gap-2 mb-2"
                style={{ background: C.navy, color: C.paper, fontFamily: MONO, fontSize: 14, fontWeight: 600, border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer", letterSpacing: "0.08em", opacity: busy ? 0.6 : 1 }}
              >
                <ClipboardPaste size={14} /> IMPORT FROM CLIPBOARD
              </button>
              {eaOpen && (
                <>
                  <textarea
                    value={eaText}
                    onChange={(e) => setEaText(e.target.value)}
                    rows={6}
                    className="w-full p-2 mb-2"
                    style={{ fontFamily: MONO, fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 3, resize: "vertical" }}
                    placeholder='[{"datetime":"3/16/2026 9:15 PM","location":"HDH 64 Degrees 64-Burger Lounge","amount":-10.75}]'
                  />
                  <button
                    onClick={() => importEaccounts(eaText)}
                    className="px-4 py-2"
                    style={{ background: C.sea, color: "#FFF", fontFamily: MONO, fontSize: 14, border: "none", borderRadius: 3, cursor: "pointer" }}
                  >
                    Import transactions
                  </button>
                </>
              )}
            </Panel>

            {log.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <Panel title="Import log" right={
                  <button onClick={() => setLog([])} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, fontFamily: MONO, fontSize: 13 }}>clear</button>
                }>
                  <div className="space-y-1">
                    {log.slice(0, 8).map((e, i) => (
                      <div key={i} className="flex items-start gap-2" style={{ fontFamily: MONO, fontSize: 13, color: e.ok ? C.navySoft : C.coral }}>
                        {e.ok ? <CheckCircle2 size={12} style={{ marginTop: 1, flexShrink: 0 }} /> : <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />}
                        {e.msg}
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}
          </div>
        )}

        {/* ------- RECEIPTS ------- */}
        {tab === "receipts" && (
          receipts.length === 0 ? (
            <p style={{ fontFamily: MONO, fontSize: 14, color: C.inkFaint, textAlign: "center", padding: "48px 0" }}>
              Nothing on file yet.
            </p>
          ) : (
            <>
              <div className="flex justify-between items-center gap-3 flex-wrap mb-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2" style={{ fontFamily: MONO, fontSize: 13, color: C.navySoft, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      style={{ accentColor: C.sea, width: 15, height: 15, cursor: "pointer" }}
                    />
                    {selected.size ? `${selected.size} selected` : `${receipts.length} receipts · newest first`}
                  </label>
                  {/* quick-select by source, so a re-import only clears what it needs to */}
                  {[...new Set(receipts.map((r) => r.source).filter(Boolean))].map((src) => (
                    <button
                      key={src}
                      onClick={() => selectBySource(src)}
                      style={{ background: "none", border: `1px solid ${C.line}`, color: C.navySoft, fontFamily: MONO, fontSize: 12, padding: "3px 8px", borderRadius: 3, cursor: "pointer" }}
                    >
                      select {src}
                    </button>
                  ))}
                  {selected.size > 0 && (
                    <button
                      onClick={() => setSelected(new Set())}
                      style={{ background: "none", border: "none", color: C.inkFaint, fontFamily: MONO, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                    >
                      clear selection
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selected.size > 0 && (
                    <button
                      onClick={deleteSelected}
                      style={{ background: C.coral, border: "none", color: "#FFF", fontFamily: MONO, fontSize: 13, padding: "5px 11px", borderRadius: 3, cursor: "pointer" }}
                    >
                      Delete {selected.size} selected
                    </button>
                  )}
                  <button
                    onClick={() => { if (window.confirm(`Delete all ${receipts.length} stored receipts?\n\nThis can't be undone.`)) clearAll(); }}
                    style={{ background: "none", border: `1px solid ${C.coral}`, color: C.coral, fontFamily: MONO, fontSize: 13, padding: "4px 10px", borderRadius: 3, cursor: "pointer" }}
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
                {receipts.map((r, i) => (
                  // Position is part of the key: duplicate keys make React reuse the
                  // wrong DOM nodes, so a deleted card can appear to stay on screen.
                  <div key={(r.id || "r") + "@" + i}>
                    <div style={{
                      background: C.paper,
                      boxShadow: selected.has(i) ? `0 0 0 2px ${C.sea}` : "0 2px 8px rgba(22,36,61,0.10)",
                      padding: "14px 14px 8px",
                    }}>
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            onChange={() => toggleSelect(i)}
                            aria-label={`Select receipt from ${r.location || "Unknown"} on ${r.date}`}
                            style={{ accentColor: C.sea, width: 15, height: 15, marginTop: 3, cursor: "pointer", flexShrink: 0 }}
                          />
                          <div className="min-w-0">
                            <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 16 }} className="flex items-center gap-1">
                              <MapPin size={12} style={{ color: C.sea, flexShrink: 0 }} />
                              <span className="truncate">{r.location || "Unknown"}</span>
                            </div>
                            {/* the counter within the hall, where a receipt would name the vendor */}
                            {r.concept && (
                              <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13, color: C.sea }} className="truncate">
                                {r.concept}
                              </div>
                            )}
                            <div style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint }}>
                              {r.date}{r.time ? " · " + r.time : ""}{r.source ? " · " + r.source : ""}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => removeReceipt(i)} aria-label="Delete receipt" style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, flexShrink: 0 }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div style={{ borderTop: `1px dashed ${C.line}`, margin: "8px 0" }} />
                      {(r.items || []).slice(0, 5).map((it, i) => (
                        <div key={i} className="flex justify-between" style={{ fontFamily: MONO, fontSize: 13, color: C.navySoft }}>
                          <span className="truncate">{(it.qty > 1 ? it.qty + "× " : "") + it.name}</span>
                          <span>{fmt$(it.price)}</span>
                        </div>
                      ))}
                      {(r.items || []).length > 5 && (
                        <div style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint }}>+{r.items.length - 5} more</div>
                      )}
                      <div className="flex justify-between mt-2" style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600 }}>
                        <span>TOTAL</span><span>{fmt$(r.total)}</span>
                      </div>
                      {r.receiptNumber && (
                        <div style={{ fontFamily: MONO, fontSize: 11, color: C.inkFaint, marginTop: 4 }}>#{r.receiptNumber}</div>
                      )}
                    </div>
                    <ZigzagEdge />
                  </div>
                ))}
              </div>
            </>
          )
        )}
      </main>

      <footer className="w-4/5 mx-auto pb-6">
        <p style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint, textAlign: "center" }}>
          Data stays in this browser's local storage — nothing is uploaded. AI parsing can misread a receipt; spot-check totals against the app.
        </p>
      </footer>
    </div>
  );
}
