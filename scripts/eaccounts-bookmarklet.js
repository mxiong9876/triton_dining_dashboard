/*
 * eAccounts → Triton Dining Dashboard — transaction grabber (bookmarklet)
 * =========================================================================
 * Runs in your ALREADY-LOGGED-IN Transact eAccounts tab, reads the transactions
 * table on screen, and copies it to your clipboard as JSON the dashboard's
 * "Import from clipboard" button understands. eAccounts has no export feature —
 * this reads the rendered page instead, so it doesn't need one.
 *
 * Readable source lives in eaccounts-bookmarklet.src.js. Regenerate the
 * one-liner below with:  npm run build:bookmarklet
 *
 * HOW TO INSTALL (once):
 *   1. Make a new bookmark in your browser (bookmark any page, then edit it).
 *   2. Replace the bookmark's URL with the whole "javascript:..." line below.
 *   3. Name it "Grab eAccounts".
 *
 * HOW TO USE:
 *   1. Account Transactions → set the date range → Search.
 *   2. Click "Grab eAccounts" on page 1.
 *   3. Click page 2 in the pager, run it again. Repeat for every page —
 *      the report shows 15 rows per page and the script accumulates, so each
 *      click copies EVERYTHING collected so far, not just the current page.
 *   4. Dashboard → Import → "Import from clipboard". Once, at the end.
 *   Closing the eAccounts tab clears the collection and starts you fresh.
 *
 * NOTES:
 *   - Columns are located by header text (Date/Time, Location, Amount, Account
 *     Name, Transaction Type), so column order can change without breaking it.
 *   - "(10.75) USD" is read as a debit. The Transaction Type column wins when
 *     present; the parentheses are the fallback.
 *   - Re-importing overlapping date ranges is safe — the dashboard dedupes.
 *
 * BOOKMARKLET — generated, do not edit by hand
 *
javascript:(function(){(function(){var p="t2g-eaccounts-grab",S=["date","location","amount"],i=null,s=0;[].forEach.call(document.querySelectorAll("table"),function(e){var t=g(e),a=S.filter(function(n){return t.some(function(l){return l.indexOf(n)>=0})}).length;a>s&&(s=a,i=e)});function g(e){var t=e.querySelectorAll("th");if(t.length||(t=e.querySelectorAll("thead td")),!t.length){var a=e.querySelector("tr");t=a?a.querySelectorAll("td"):[]}return[].map.call(t,function(n){return n.textContent.trim().toLowerCase()})}if(!i||s<2){alert('eAccounts grabber: couldn\'t find the transactions table.\n\nRun this on Account Transactions after clicking Search, so the "Account Transactions Found" table is on screen.');return}var m=g(i);function o(e){for(var t=0;t<m.length;t++)if(m[t].indexOf(e)>=0)return t;return-1}var c=o("date"),v=o("location"),u=o("amount"),b=o("account name"),y=o("transaction type");if(c<0||u<0){alert("eAccounts grabber: found a table but not its Date/Amount columns.");return}var h=[];if([].forEach.call(i.querySelectorAll("tr"),function(e){var t=[].map.call(e.querySelectorAll("td"),function(O){return O.textContent.replace(/\s+/g," ").trim()});if(!(t.length<=Math.max(c,u))){var a=t[u];if(/\d/.test(a)){var n=parseFloat(a.replace(/[^0-9.]/g,""));if(isFinite(n)){var l=y>=0?(t[y]||"").toLowerCase():"";l.indexOf("credit")>=0?n=Math.abs(n):(l.indexOf("debit")>=0||/^[(-]/.test(a))&&(n=-Math.abs(n)),t[c]&&h.push({datetime:t[c],location:v>=0?t[v]:"Unknown",account:b>=0?t[b]:null,amount:n})}}}}),!h.length){alert("eAccounts grabber: that table had no transaction rows on this page.");return}var r=[];try{r=JSON.parse(sessionStorage.getItem(p))||[]}catch(e){r=[]}var f={};r.forEach(function(e){f[e.datetime+"|"+e.location+"|"+e.amount]=1});var A=0;h.forEach(function(e){var t=e.datetime+"|"+e.location+"|"+e.amount;f[t]||(f[t]=1,r.push(e),A++)});try{sessionStorage.setItem(p,JSON.stringify(r))}catch(e){}var d=JSON.stringify(r),w="Page added "+A+" new ("+r.length+" collected so far).\n\nClick through the remaining pages and run this again on each \u2014 every click copies the full collection.\n\nThen: dashboard \u2192 Import \u2192 Import from clipboard.\n\n(Close this tab to start a fresh collection.)";navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(d).then(function(){alert(w)},function(){window.prompt("Copy this JSON, then paste it into the app:",d)}):window.prompt("Copy this JSON, then paste it into the app:",d)})();})();
 *
 */
