// P&L - ported from the old app's PnLService.gs getPnLReport(), which was
// 100% computed live from Sales + Opex (no manual entry table at all). Same
// here, except a past month can be explicitly "closed" (frozen into
// pnl_lines) so its numbers stop moving even if Sales/Opex data changes
// later - see functions/api/pnl.js's file comment for the full reasoning.
// The report itself (rows/months/values shape) is built entirely server-side
// (functions/api/pnl.js) - this file just renders it and drives the
// Close/Recalculate actions per month.
// Registered as a Finance tab, not its own top-level route - see
// pages/cashflow.js's renderFinancePage/loadFinanceTab.

let _lastPnlData = null;

async function renderPnlPage(content) {
  content.innerHTML =
    '<div style="margin-bottom:8px;"><button onclick="loadPnl()">Refresh</button></div>' +
    '<div id="pnlWrap"><p>Loading...</p></div>';
  await loadPnl();
}

async function loadPnl() {
  const wrap = document.getElementById("pnlWrap");
  if (!wrap) return;
  wrap.innerHTML = "<p>Loading...</p>";

  _lastPnlData = await api("pnl");
  if (!document.getElementById("pnlWrap")) return;
  renderPnlTable(wrap);
}

function renderPnlTable(wrap) {
  const data = _lastPnlData;

  const warningHtml = data.unpricedProductNames.length
    ? ('<p style="background:#fff3cd; border:1px solid #ffe08a; padding:8px 12px; border-radius:4px;">' +
        "<strong>Heads up:</strong> Food Cost/Packaging Cost below excludes these products because they don't have costing set up yet (Menu &gt; Engineering &gt; Costing) - Total COGS is understated until they're costed: " +
        data.unpricedProductNames.join(", ") + "</p>")
    : "";

  wrap.innerHTML =
    warningHtml +
    '<div id="pnlScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead>" +
          "<tr><th>Item</th>" + data.months.map((m) => "<th>" + monthHeaderHtml(m) + "</th>").join("") + "</tr>" +
        "</thead>" +
        "<tbody>" + data.rows.map(pnlRowHtml).join("") + "</tbody>" +
      "</table>" +
    "</div>";
  enableDragScroll(document.getElementById("pnlScrollWrap"));
}

function monthHeaderHtml(m) {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
      "<span>" + m.label + "</span>" +
      '<span style="display:flex; align-items:center; gap:8px; font-weight:normal;">' + monthActionHtml(m) + "</span>" +
    "</div>"
  );
}

// A closed month's frozen snapshot can drift from live if an order/opex
// backdated into it lands AFTER it was closed - Total Revenue/COGS/OPEX are
// compared server-side (functions/api/pnl.js's bucketTotalsDiffer) so this
// shows up instead of the numbers just quietly going stale with no hint
// that Recalculate is needed.
// Small colored dot instead of a lock/unlock emoji - same status-at-a-glance
// purpose, without a decorative icon glyph.
function pnlStatusDot(color) {
  return '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + color + '; margin-right:4px; vertical-align:middle;"></span>';
}

function monthActionHtml(m) {
  if (m.closed) {
    const driftBadge = m.drifted
      ? '<span style="font-size:12px; color:#b00020; white-space:nowrap;" title="Live data no longer matches this closed snapshot - click Recalculate to update it.">&#9888; Data changed since close</span>'
      : "";
    return (
      driftBadge +
      '<span style="font-size:12px; color:var(--color-text-muted); white-space:nowrap;">' + pnlStatusDot("var(--color-text-muted)") + "Closed " + formatPnlClosedDate(m.closedAt) + "</span>" +
      '<button style="font-size:12px;" onclick="closeOrRecalculatePnlMonth(\'' + m.key + '\', true)">Recalculate</button>'
    );
  }
  if (!m.closeable) {
    return '<span style="font-size:12px; color:var(--color-text-muted);">' + pnlStatusDot("var(--color-success)") + "Live</span>";
  }
  return (
    '<span style="font-size:12px; color:var(--color-text-muted); white-space:nowrap;">' + pnlStatusDot("var(--color-success)") + "Live</span>" +
    '<button style="font-size:12px;" onclick="closeOrRecalculatePnlMonth(\'' + m.key + '\', false)">Close Month</button>'
  );
}

function formatPnlClosedDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function pnlRowHtml(r) {
  const colspan = 1 + _lastPnlData.months.length;
  if (r.values === null) {
    // Main category headers (Revenue/COGS/OPEX/Other Income/Profitability/
    // Benchmark Check) get a distinct tinted/accented treatment so they read
    // as section dividers - plain sub-headers ("Fixed Cost"/"Variable Cost"
    // under OPEX, "Gross Profit" as a derived subtotal) stay as before.
    // Profitability additionally gets extra top spacing (groupBreakBefore),
    // setting the Revenue-through-Other-Income data group apart from it.
    // background/border go on the <td>, not the <tr> - table rows don't
    // reliably render either property across browsers, only cells do.
    const cellStyle = r.isMain
      ? 'padding:6px 8px; background:var(--color-accent-tint); border-left:3px solid var(--color-accent);'
      : "padding:6px 8px;";
    const label = r.isMain
      ? '<strong style="text-transform:uppercase; letter-spacing:0.5px; font-size:13px;">' + r.label + "</strong>"
      : "<strong>" + r.label + "</strong>";
    return (
      (r.groupBreakBefore ? '<tr><td colspan="' + colspan + '" style="padding-top:20px; border:none;"></td></tr>' : "") +
      '<tr><td colspan="' + colspan + '" style="' + cellStyle + '">' + label + "</td></tr>"
    );
  }
  // A subsection subtotal (Fixed/Variable Cost's own "Subtotal" line) reads
  // lighter/muted with a dashed top rule - a true section total (Total
  // Revenue/COGS/OPEX/Other Income, Operating/Net Profit) stays crisp bold
  // with no border, so the two are never visually interchangeable, per
  // explicit request. Border goes on each <td>, not the <tr> - table rows
  // don't reliably render borders across browsers, only cells do.
  const cellStyle = r.isSubtotal
    ? 'font-weight:bold; font-style:italic; color:var(--color-text-muted); border-top:1px dashed var(--color-border-on-card);'
    : (r.bold ? "font-weight:bold;" : "");
  const styleAttr = cellStyle ? ' style="' + cellStyle + '"' : "";
  const cells = r.values.map((v) => "<td" + styleAttr + ">" + formatPnlValue(r.label, v) + "</td>").join("");
  return "<tr><td" + styleAttr + ">" + r.label + "</td>" + cells + "</tr>";
}

function formatPnlValue(label, value) {
  if (typeof value !== "number") return value === null || value === undefined ? "" : value;
  return String(label).trim().slice(-1) === "%" ? formatPercent(value) : '<span class="font-number">' + formatRupiah(value) + "</span>";
}

function closeOrRecalculatePnlMonth(monthKey, isRecalculate) {
  const title = isRecalculate ? "Recalculate " + monthKey + "?" : "Close " + monthKey + "?";
  const body = isRecalculate
    ? "This re-derives its numbers from CURRENT Sales/Opex data (and current PnL Categories Fixed/Variable settings) and overwrites the frozen snapshot."
    : "This freezes its P&L numbers so they won't change even if Sales/Opex data is edited later. You can Recalculate afterwards if a correction is needed.";

  openConfirmModal({
    title: title,
    body: body,
    confirmLabel: isRecalculate ? "Recalculate" : "Close Month",
    onConfirm: async function () {
      await api("pnl-close", { method: "POST", body: { monthKey: monthKey } });
      closeModal();
      await loadPnl();
    }
  });
}
