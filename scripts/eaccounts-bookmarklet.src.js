/*
 * eAccounts → Triton Dining Dashboard — transaction grabber (bookmarklet source)
 * ==============================================================================
 * Readable source. The pasteable one-liner is generated from this file:
 *     npm run build:bookmarklet
 * ...which rewrites the BOOKMARKLET block at the bottom of eaccounts-bookmarklet.js.
 *
 * Written against the real UCSD Account Transaction Report, whose columns are:
 *     Date/Time | Account Name | Card Number | Location | Transaction Type | Amount
 * Amounts render as "(10.75) USD" — parentheses mean debit. The report paginates
 * at 15 rows, so this script ACCUMULATES across pages in sessionStorage: click it
 * once per page and every click copies everything collected so far. Closing the
 * eAccounts tab clears the collection.
 */

(function () {
  var STORE = "t2g-eaccounts-grab";

  // ---- find the transactions table by its headers, not by position ----
  var WANT = ["date", "location", "amount"];
  var table = null, best = 0;
  [].forEach.call(document.querySelectorAll("table"), function (t) {
    var heads = headerCells(t);
    var score = WANT.filter(function (w) {
      return heads.some(function (h) { return h.indexOf(w) >= 0; });
    }).length;
    if (score > best) { best = score; table = t; }
  });

  function headerCells(t) {
    var hs = t.querySelectorAll("th");
    if (!hs.length) hs = t.querySelectorAll("thead td");
    if (!hs.length) {
      var first = t.querySelector("tr");
      hs = first ? first.querySelectorAll("td") : [];
    }
    return [].map.call(hs, function (h) { return h.textContent.trim().toLowerCase(); });
  }

  if (!table || best < 2) {
    alert(
      "eAccounts grabber: couldn't find the transactions table.\n\n" +
      "Run this on Account Transactions after clicking Search, so the " +
      "\"Account Transactions Found\" table is on screen."
    );
    return;
  }

  // ---- map columns by header text ----
  var heads = headerCells(table);
  function col(needle) {
    for (var i = 0; i < heads.length; i++) if (heads[i].indexOf(needle) >= 0) return i;
    return -1;
  }
  var iDate = col("date"), iLoc = col("location"), iAmt = col("amount");
  var iAcct = col("account name"), iType = col("transaction type");
  if (iDate < 0 || iAmt < 0) {
    alert("eAccounts grabber: found a table but not its Date/Amount columns.");
    return;
  }

  // ---- read the rows on this page ----
  var page = [];
  [].forEach.call(table.querySelectorAll("tr"), function (tr) {
    var cells = [].map.call(tr.querySelectorAll("td"), function (td) {
      return td.textContent.replace(/\s+/g, " ").trim();
    });
    if (cells.length <= Math.max(iDate, iAmt)) return; // header or pager row

    var rawAmt = cells[iAmt];
    if (!/\d/.test(rawAmt)) return;
    var amt = parseFloat(rawAmt.replace(/[^0-9.]/g, ""));
    if (!isFinite(amt)) return;

    // Transaction Type is authoritative when present; "(x) USD" parens are the
    // fallback signal. Debits (money leaving the account) come out negative.
    var type = iType >= 0 ? (cells[iType] || "").toLowerCase() : "";
    if (type.indexOf("credit") >= 0) amt = Math.abs(amt);
    else if (type.indexOf("debit") >= 0 || /^[(-]/.test(rawAmt)) amt = -Math.abs(amt);

    if (!cells[iDate]) return;
    page.push({
      datetime: cells[iDate],
      location: iLoc >= 0 ? cells[iLoc] : "Unknown",
      account: iAcct >= 0 ? cells[iAcct] : null,
      amount: amt,
    });
  });

  if (!page.length) {
    alert("eAccounts grabber: that table had no transaction rows on this page.");
    return;
  }

  // ---- merge into the running collection (so you can walk the pager) ----
  var all = [];
  try { all = JSON.parse(sessionStorage.getItem(STORE)) || []; } catch (e) { all = []; }
  var seen = {};
  all.forEach(function (r) { seen[r.datetime + "|" + r.location + "|" + r.amount] = 1; });
  var added = 0;
  page.forEach(function (r) {
    var k = r.datetime + "|" + r.location + "|" + r.amount;
    if (seen[k]) return;
    seen[k] = 1;
    all.push(r);
    added++;
  });
  try { sessionStorage.setItem(STORE, JSON.stringify(all)); } catch (e) {}

  var json = JSON.stringify(all);
  var msg =
    "Page added " + added + " new (" + all.length + " collected so far).\n\n" +
    "Click through the remaining pages and run this again on each — every click " +
    "copies the full collection.\n\nThen: dashboard → Import → Import from clipboard." +
    "\n\n(Close this tab to start a fresh collection.)";

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).then(
      function () { alert(msg); },
      function () { window.prompt("Copy this JSON, then paste it into the app:", json); }
    );
  } else {
    window.prompt("Copy this JSON, then paste it into the app:", json);
  }
})();
