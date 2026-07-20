import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
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
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: C.inkFaint, textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 26, color: C.navy, lineHeight: 1.2, marginTop: 2 }} className="truncate">
            {value}
          </div>
          {sub && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.inkFaint, marginTop: 2 }} className="truncate">
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
        <h3 style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.navySoft, fontWeight: 600 }}>
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
    <div style={{ background: C.navy, color: C.paper, fontFamily: MONO, fontSize: 11, padding: "6px 10px", borderRadius: 3 }}>
      <div style={{ opacity: 0.7 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i}>{p.name}: {money ? fmt$(p.value) : p.value}</div>
      ))}
    </div>
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

  /* load persisted data */
  useEffect(() => {
    // localStorage is synchronous, so no async/await needed here.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setReceipts(JSON.parse(raw));
    } catch { /* first run — nothing stored yet */ }
    setLoaded(true);
  }, []);

  const persist = useCallback(async (next) => {
    setReceipts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      setLog((l) => [{ ok: false, msg: "Saved in this session only — storage write failed." }, ...l]);
    }
  }, []);

  const addReceipts = useCallback((incoming) => {
    setReceipts((current) => {
      const keys = new Set(current.map(receiptKey));
      const fresh = [];
      for (const r of incoming) {
        if (!r || !r.date || r.total == null) continue;
        const k = receiptKey(r);
        if (keys.has(k)) continue;
        keys.add(k);
        fresh.push({ ...r, id: k, items: Array.isArray(r.items) ? r.items : [] });
      }
      const next = [...current, ...fresh].sort((a, b) => (a.date < b.date ? 1 : -1));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setLog((l) => [{ ok: true, msg: `Added ${fresh.length} new receipt${fresh.length === 1 ? "" : "s"} (${incoming.length - fresh.length} duplicate/skipped).` }, ...l]);
      return next;
    });
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

  async function removeReceipt(id) {
    const next = receipts.filter((r) => r.id !== id);
    await persist(next);
  }

  async function clearAll() {
    await persist([]);
    setLog([]);
  }

  function exportCsv() {
    const data = filtered
    const header = ["date", "time", "location", "items", "cost"]
    const csv = [header.join(","),...data.map((r) => [r.date, r.time, r.location, r.items.map((it) => it.name).join(";"), r.total])];
    const text = csv.join("\n")
    const blob = new Blob([text], {type: "text/csv"})
    const url = URL.createObjectURL(blob)
    const el = document.createElement("a")
    el.href = url;
    el.download = "receipts.csv";
    el.click();
    URL.revokeObjectURL(url)
  }

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
    const itemCounts = {};
    const itemSpend = {};
    const heat = {}; // day-slot -> count
    let biggest = null;

    for (const r of filtered) {
      const loc = r.location || "Unknown";
      byLocation[loc] = byLocation[loc] || { location: loc, visits: 0, spend: 0 };
      byLocation[loc].visits += 1;
      byLocation[loc].spend += Number(r.total) || 0;

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

      for (const it of r.items || []) {
        const name = (it.name || "").trim();
        if (!name) continue;
        const qty = Number(it.qty) || 1;
        itemCounts[name] = (itemCounts[name] || 0) + qty;
        itemSpend[name] = (itemSpend[name] || 0) + (Number(it.price) || 0);
      }

      if (!biggest || (Number(r.total) || 0) > (Number(biggest.total) || 0)) biggest = r;
    }

    const locations = Object.values(byLocation).sort((a, b) => b.visits - a.visits);
    const months = Object.values(byMonth).sort((a, b) => (a.key < b.key ? -1 : 1));
    const topItems = Object.keys(itemCounts)
      .map((name) => ({ name, count: itemCounts[name], spend: itemSpend[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const maxHeat = Math.max(1, ...Object.values(heat));

    return { total, count, avg: count ? total / count : 0, locations, months, topItems, heat, maxHeat, biggest };
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
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", color: C.gold }}>
              ★ TRITON2GO · PERSONAL LEDGER ★
            </div>
            <h1 style={{ fontFamily: SANS, fontWeight: 800, fontSize: 28, letterSpacing: "-0.01em" }}>
              Dining Habits
            </h1>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, opacity: 0.75 }}>
            {loaded ? `${receipts.length} receipts on file` : "loading…"}
          </div>
        </div>
        {/* tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1" role="tablist">
          {[["dashboard", "Dashboard"], ["import", "Import"], ["receipts", "Receipts"]].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="px-4 py-2"
              style={{
                fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em",
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

      <main className="max-w-5xl mx-auto px-4 py-6">
        {busy && (
          <div className="flex items-center gap-2 mb-4 p-3" style={{ background: C.navy, color: C.paper, borderRadius: 4, fontFamily: MONO, fontSize: 12 }}>
            <Loader2 size={14} className="animate-spin" /> {busy}
          </div>
        )}

        {/* ------- DASHBOARD ------- */}
        {tab === "dashboard" && (
          filtered.length === 0 ? (
            <div className="text-center py-16">
              <Receipt size={36} style={{ color: C.inkFaint, margin: "0 auto 12px" }} />
              <p style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18 }}>No receipts yet</p>
              <p style={{ color: C.inkFaint, fontSize: 14, marginTop: 4 }}>
                Head to the Import tab — upload receipt screenshots from the Triton2Go app to get started.
              </p>
              <button
                onClick={() => setTab("import")}
                className="mt-4 px-5 py-2"
                style={{ background: C.gold, color: C.navy, fontFamily: MONO, fontSize: 12, fontWeight: 600, border: "none", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em" }}
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
                        fontFamily: MONO, fontSize: 11, cursor: "pointer", borderRadius: 3,
                        border: `1px solid ${range === v ? C.navy : C.line}`,
                        background: range === v ? C.navy : "#FFF",
                        color: range === v ? C.paper : C.navySoft,
                      }}
                    >
                      {l}
                    </button>
                  ))}
                  <button onClick={exportCsv}>
                    Export CSV
                  </button>
                </div>
              </div>

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

              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                {/* spend over time */}
                <Panel title="Spend by month">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={stats.months} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={C.line} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontFamily: MONO, fontSize: 10, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontFamily: MONO, fontSize: 10, fill: C.inkFaint }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTip money />} />
                      <Area type="monotone" dataKey="spend" name="Spend" stroke={C.sea} strokeWidth={2} fill={C.sea} fillOpacity={0.15} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Panel>

                {/* by location */}
                <Panel title="Where the money goes">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.locations.slice(0, 6)} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="location" width={110} tick={{ fontFamily: MONO, fontSize: 10, fill: C.navySoft }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTip money />} />
                      <Bar dataKey="spend" name="Spend" radius={[0, 3, 3, 0]}>
                        {stats.locations.slice(0, 6).map((_, i) => (
                          <Cell key={i} fill={i === 0 ? C.gold : C.sea} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Panel>

                {/* top items — printed like a receipt */}
                <Panel title="Most ordered items">
                  {stats.topItems.length === 0 ? (
                    <p style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint }}>
                      No line items yet — screenshots of full receipts will fill this in.
                    </p>
                  ) : (
                    <div style={{ background: C.paper, padding: "12px 14px" }}>
                      {stats.topItems.map((it, i) => (
                        <div key={it.name} className="flex justify-between gap-2 py-1" style={{ fontFamily: MONO, fontSize: 12, borderBottom: i < stats.topItems.length - 1 ? `1px dashed ${C.line}` : "none" }}>
                          <span className="truncate">{it.name}</span>
                          <span style={{ whiteSpace: "nowrap", color: C.navySoft }}>×{it.count} · {fmt$(it.spend)}</span>
                        </div>
                      ))}
                      <ZigzagEdge color={C.paper} />
                    </div>
                  )}
                </Panel>

                {/* heatmap */}
                <Panel title="When you eat">
                  <div className="overflow-x-auto">
                    <div style={{ display: "grid", gridTemplateColumns: `44px repeat(${MEAL_SLOTS.length}, 1fr)`, gap: 3, minWidth: 320 }}>
                      <div />
                      {MEAL_SLOTS.map((s) => (
                        <div key={s.label} style={{ fontFamily: MONO, fontSize: 9, color: C.inkFaint, textAlign: "center" }}>{s.label}</div>
                      ))}
                      {DAY_NAMES.map((day, di) => (
                        <React.Fragment key={day}>
                          <div style={{ fontFamily: MONO, fontSize: 10, color: C.navySoft, alignSelf: "center" }}>{day}</div>
                          {MEAL_SLOTS.map((_, si) => {
                            const v = stats.heat[di + "-" + si] || 0;
                            return (
                              <div
                                key={si}
                                title={`${day} ${MEAL_SLOTS[si].label}: ${v} order${v === 1 ? "" : "s"}`}
                                style={{
                                  height: 26, borderRadius: 3,
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
                  <p style={{ fontFamily: MONO, fontSize: 10, color: C.inkFaint, marginTop: 8 }}>
                    Darker = more orders in that slot. Needs receipts with a time stamp.
                  </p>
                </Panel>
              </div>
            </>
          )
        )}

        {/* ------- IMPORT ------- */}
        {tab === "import" && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <Panel title="App receipt screenshots">
              <p style={{ fontSize: 13, color: C.navySoft, marginBottom: 12 }}>
                In Triton2Go, open each receipt and screenshot it. Upload the images here — Claude reads out the items, prices, location and date automatically. Duplicates are skipped by receipt number.
              </p>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} />
              <button
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={!!busy}
                className="w-full py-3 flex items-center justify-center gap-2"
                style={{ background: C.gold, color: C.navy, fontFamily: MONO, fontSize: 12, fontWeight: 600, border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer", letterSpacing: "0.08em", opacity: busy ? 0.6 : 1 }}
              >
                <Upload size={14} /> UPLOAD SCREENSHOTS
              </button>
            </Panel>

            <Panel title="Market receipts from Gmail">
              <p style={{ fontSize: 13, color: C.navySoft, marginBottom: 12 }}>
                Walkout-market purchases send email receipts. This searches your connected Gmail for Transact / Just Walk Out receipts and pulls them in.
              </p>
              <button
                onClick={handleGmail}
                disabled={!!busy}
                className="w-full py-3 flex items-center justify-center gap-2"
                style={{ background: C.navy, color: C.paper, fontFamily: MONO, fontSize: 12, fontWeight: 600, border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer", letterSpacing: "0.08em", opacity: busy ? 0.6 : 1 }}
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
              <p style={{ fontSize: 13, color: C.navySoft, marginBottom: 12 }}>
                Already have data from a scraper or export? Paste an array of receipts:{" "}
                <code style={{ fontFamily: MONO, fontSize: 11 }}>{"[{location,date,time,total,receiptNumber,items:[{name,qty,price}]}]"}</code>
              </p>
              {pasteOpen && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={6}
                    className="w-full p-2 mb-2"
                    style={{ fontFamily: MONO, fontSize: 11, border: `1px solid ${C.line}`, borderRadius: 3, resize: "vertical" }}
                    placeholder='[{"location":"64 Degrees","date":"2026-07-01","time":"18:42","total":12.5,"items":[{"name":"Poke Bowl","qty":1,"price":12.5}]}]'
                  />
                  <button
                    onClick={handlePaste}
                    className="px-4 py-2"
                    style={{ background: C.sea, color: "#FFF", fontFamily: MONO, fontSize: 12, border: "none", borderRadius: 3, cursor: "pointer" }}
                  >
                    Add receipts
                  </button>
                </>
              )}
            </Panel>

            {log.length > 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <Panel title="Import log" right={
                  <button onClick={() => setLog([])} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, fontFamily: MONO, fontSize: 11 }}>clear</button>
                }>
                  <div className="space-y-1">
                    {log.slice(0, 8).map((e, i) => (
                      <div key={i} className="flex items-start gap-2" style={{ fontFamily: MONO, fontSize: 11, color: e.ok ? C.navySoft : C.coral }}>
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
            <p style={{ fontFamily: MONO, fontSize: 12, color: C.inkFaint, textAlign: "center", padding: "48px 0" }}>
              Nothing on file yet.
            </p>
          ) : (
            <>
              <div className="flex justify-between items-center mb-3">
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.inkFaint }}>{receipts.length} receipts · newest first</span>
                <button
                  onClick={() => { if (window.confirm("Delete all stored receipts?")) clearAll(); }}
                  style={{ background: "none", border: `1px solid ${C.coral}`, color: C.coral, fontFamily: MONO, fontSize: 11, padding: "4px 10px", borderRadius: 3, cursor: "pointer" }}
                >
                  Clear all
                </button>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
                {receipts.map((r) => (
                  <div key={r.id}>
                    <div style={{ background: C.paper, boxShadow: "0 2px 8px rgba(22,36,61,0.10)", padding: "14px 14px 8px" }}>
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 14 }} className="flex items-center gap-1">
                            <MapPin size={12} style={{ color: C.sea }} /> {r.location || "Unknown"}
                          </div>
                          <div style={{ fontFamily: MONO, fontSize: 10, color: C.inkFaint }}>
                            {r.date}{r.time ? " · " + r.time : ""}{r.source ? " · " + r.source : ""}
                          </div>
                        </div>
                        <button onClick={() => removeReceipt(r.id)} aria-label="Delete receipt" style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div style={{ borderTop: `1px dashed ${C.line}`, margin: "8px 0" }} />
                      {(r.items || []).slice(0, 5).map((it, i) => (
                        <div key={i} className="flex justify-between" style={{ fontFamily: MONO, fontSize: 11, color: C.navySoft }}>
                          <span className="truncate">{(it.qty > 1 ? it.qty + "× " : "") + it.name}</span>
                          <span>{fmt$(it.price)}</span>
                        </div>
                      ))}
                      {(r.items || []).length > 5 && (
                        <div style={{ fontFamily: MONO, fontSize: 10, color: C.inkFaint }}>+{r.items.length - 5} more</div>
                      )}
                      <div className="flex justify-between mt-2" style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>
                        <span>TOTAL</span><span>{fmt$(r.total)}</span>
                      </div>
                      {r.receiptNumber && (
                        <div style={{ fontFamily: MONO, fontSize: 9, color: C.inkFaint, marginTop: 4 }}>#{r.receiptNumber}</div>
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

      <footer className="max-w-5xl mx-auto px-4 pb-6">
        <p style={{ fontFamily: MONO, fontSize: 10, color: C.inkFaint }}>
          Data stays in this artifact's private storage — nothing is shared. AI parsing can misread a receipt; spot-check totals against the app.
        </p>
      </footer>
    </div>
  );
}
