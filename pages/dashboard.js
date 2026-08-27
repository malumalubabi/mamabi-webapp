// Dashboard - small stat cards, an inline-SVG "Revenue Flow" line chart with
// Daily/Weekly/Monthly bucketing and a Total/Per Channel toggle, an
// inline-SVG OpEx donut chart, transaction-history-style rows, and two small
// progress-bar cards. No charting library - plain SVG path/arc math,
// consistent with this app having no frontend dependencies anywhere else.
//
// Formerly the "Dashboard v2" experiment (see git history for the plain-tile
// original it replaced) - promoted to the main Dashboard once confirmed in
// browser. Internal identifiers keep their "dv2" prefix from that period;
// purely a naming leftover, no functional meaning.
registerPage("dashboard", async function (content) {
  const data = await api("dashboard");
  _dv2Data = data;

  content.innerHTML =
    dv2StylesHtml() +

    '<div class="dv2-stat-row">' +
      dv2StatCard("Cash Balance", formatRupiah(data.cashBalance)) +
      dv2StatCard("Bank Balance", formatRupiah(data.bankBalance)) +
      dv2StatCard("Net Profit", formatRupiah(data.netProfit), "accrual, this month") +
      dv2StatCard("Income", formatRupiah(data.income), "cashflow, this month") +
    "</div>" +

    '<div class="dv2-grid-2col dv2-align-stretch">' +
      '<div class="dv2-col-main">' +
        '<div class="dv2-card dv2-flow-card">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:8px;">' +
            "<h4>Revenue Flow</h4>" +
            '<div style="display:flex; gap:8px;">' +
              '<select id="dv2RevenueView" onchange="dv2RenderRevenueChart()">' +
                '<option value="total">Total</option>' +
                '<option value="channel">Per Channel</option>' +
              "</select>" +
              '<select id="dv2RevenuePeriod" onchange="dv2RenderRevenueChart()">' +
                '<option value="daily">Daily</option>' +
                '<option value="weekly">Weekly</option>' +
                '<option value="monthly">Monthly</option>' +
              "</select>" +
            "</div>" +
          "</div>" +
          '<div id="dv2RevenueChart" class="dv2-flow-chart-wrap"></div>' +
        "</div>" +
      "</div>" +
      '<div class="dv2-col-side">' +
        '<div class="dv2-card dv2-quick-actions">' +
          "<h4>Quick Actions</h4>" +
          '<button onclick="openOrderModal()">+ New Order</button>' +
          '<button onclick="openPurchaseModal()">+ Input Purchase</button>' +
          '<button onclick="openSalesEntryModal()">+ Input Sales</button>' +
        "</div>" +
        '<div class="dv2-card">' +
          "<h4>Monthly Expenses</h4>" +
          dv2DonutSection(data.opexByCategoryThisMonth) +
        "</div>" +
      "</div>" +
    "</div>" +

    '<div class="dv2-grid-2col" style="margin-top:20px;">' +
      '<div class="dv2-col-main">' +
        '<div class="dv2-card">' +
          "<h4>Orders Needing Action</h4>" +
          dv2ActionOrdersSection(data.actionNeededOrders) +
        "</div>" +
      "</div>" +
      '<div class="dv2-col-side">' +
        dv2UnpaidDriverPayoutCard(data.unpaidDriverPayout, data.driverPayoutThisMonth) +
        dv2StockAlertCard(data.lowStock, data.lowStockTotalTracked) +
      "</div>" +
    "</div>";

  dv2RenderRevenueChart();
});

let _dv2Data = null;

function dv2StylesHtml() {
  return (
    "<style>" +
      ".dv2-stat-row { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:20px; }" +
      ".dv2-stat { flex:1 1 160px; background:#fafafa; border:1px solid #eee; border-radius:10px; padding:12px 16px; }" +
      ".dv2-stat-label { font-size:12px; color:#888; }" +
      ".dv2-stat-value { font-size:22px; font-weight:700; margin-top:2px; }" +
      ".dv2-grid-2col { display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; }" +
      ".dv2-align-stretch { align-items:stretch; }" +
      ".dv2-col-main { flex:2 1 480px; min-width:0; display:flex; flex-direction:column; }" +
      ".dv2-col-side { flex:1 1 260px; min-width:0; display:flex; flex-direction:column; gap:20px; }" +
      ".dv2-col-main > .dv2-card { flex:1; display:flex; flex-direction:column; }" +
      // Flow chart card only - fills whatever height dv2-align-stretch gives
      // its column (matched to Quick Actions + Monthly Expenses stacked
      // height), instead of sizing to a fixed pixel height. Column layout so
      // the legend (Per Channel view) sits below the chart at its own
      // natural height rather than being squeezed out by a height:100% svg.
      ".dv2-flow-chart-wrap { flex:1; min-height:220px; display:flex; flex-direction:column; min-width:0; }" +
      // Chart itself gets a real pixel width (points.length * px-per-point,
      // see dv2RevenueChartSvg/dv2RevenueMultiChartSvg) so dense Daily data
      // doesn't get squeezed - this scrolls it horizontally instead
      // (enableDragScroll wired up in dv2RenderRevenueChart).
      ".dv2-chart-scroll { flex:1; min-height:0; overflow-x:auto; overflow-y:hidden; }" +
      ".dv2-chart-scroll svg { height:100%; display:block; }" +
      ".dv2-chart-legend { flex-shrink:0; margin-top:6px; }" +
      ".dv2-card { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:16px 18px; }" +
      ".dv2-card h4 { margin:0 0 12px; font-size:14px; font-weight:600; color:#333; }" +
      ".dv2-quick-actions button { display:block; width:100%; box-sizing:border-box; text-align:left; padding:10px 12px; margin-bottom:8px; border-radius:8px; border:1px solid #e5e7eb; background:#f9fafb; cursor:pointer; }" +
      ".dv2-quick-actions button:last-child { margin-bottom:0; }" +
      ".dv2-txn-row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #f0f0f0; }" +
      ".dv2-txn-row:last-child { border-bottom:none; }" +
      ".dv2-txn-avatar { width:36px; height:36px; border-radius:50%; background:#e0e7ff; color:#3730a3; display:flex; align-items:center; justify-content:center; font-weight:600; flex-shrink:0; }" +
      ".dv2-txn-main { flex:1; min-width:0; }" +
      ".dv2-txn-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }" +
      ".dv2-txn-sub { font-size:12px; color:#888; }" +
      ".dv2-txn-right { text-align:right; flex-shrink:0; }" +
      ".dv2-txn-amount { font-weight:600; }" +
      ".dv2-badge { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; margin-top:3px; }" +
      ".dv2-badge-red { background:#fee2e2; color:#b91c1c; }" +
      ".dv2-badge-amber { background:#fef3c7; color:#92400e; }" +
      ".dv2-mini-card { cursor:pointer; }" +
      ".dv2-mini-label { font-size:12px; color:#888; }" +
      ".dv2-mini-value { font-size:18px; font-weight:700; margin:4px 0 8px; }" +
      ".dv2-mini-bar-track { background:#eee; border-radius:999px; height:6px; overflow:hidden; }" +
      ".dv2-mini-bar-fill { height:100%; border-radius:999px; }" +
    "</style>"
  );
}

function dv2StatCard(label, value, sub) {
  return (
    '<div class="dv2-stat">' +
      '<div class="dv2-stat-label">' + label + (sub ? " (" + sub + ")" : "") + "</div>" +
      '<div class="dv2-stat-value">' + value + "</div>" +
    "</div>"
  );
}

// ---------- Revenue Flow chart (inline SVG line + area, no library) ----------

// Period (Daily/Weekly/Monthly) and View (Total/Per Channel) are
// independent controls, both re-render from the same bucketed data -
// dv2GroupDaily does the bucketing once, dv2RevenueChartSvg (one line) or
// dv2RevenueMultiChartSvg (one line per platform) draws it.
function dv2RenderRevenueChart() {
  const el = document.getElementById("dv2RevenueChart");
  if (!el || !_dv2Data) return;
  const period = document.getElementById("dv2RevenuePeriod").value;
  const view = document.getElementById("dv2RevenueView").value;
  const buckets = dv2GroupDaily(_dv2Data.revenueTrendDaily, period);

  if (view === "channel") {
    el.innerHTML = dv2RevenueMultiChartSvg(buckets);
  } else {
    el.innerHTML = dv2RevenueChartSvg(buckets.map((b) => ({ label: b.label, value: b.revenue })));
  }

  const scrollEl = el.querySelector(".dv2-chart-scroll");
  if (scrollEl) {
    enableDragScroll(scrollEl);
    // Default view = most recent data, not the oldest point in the window.
    scrollEl.scrollLeft = scrollEl.scrollWidth;
  }
}

// Daily = last 30 raw days as-is. Weekly = grouped by the Monday that
// starts each day's ISO week. Monthly = grouped by calendar month. All
// three read from the same 90-day daily dataset (functions/api/
// dashboard.js's revenueTrendDailyList) - no separate fetch per period.
// Keeps byPlatform per bucket (summed across its member days), not just
// the total, so the Per Channel view doesn't need its own bucketing pass.
function dv2GroupDaily(daily, period) {
  if (period === "daily") {
    return daily.slice(-30).map((d) => ({ label: dv2ShortDayLabel(d.date), revenue: d.revenue, byPlatform: d.byPlatform }));
  }

  const byBucket = new Map();
  const order = [];
  daily.forEach((d) => {
    const key = period === "weekly" ? dv2MondayOf(d.date) : d.date.slice(0, 7);
    if (!byBucket.has(key)) { byBucket.set(key, { revenue: 0, byPlatform: {} }); order.push(key); }
    const b = byBucket.get(key);
    b.revenue += d.revenue;
    Object.entries(d.byPlatform).forEach(([platform, amount]) => {
      b.byPlatform[platform] = (b.byPlatform[platform] || 0) + amount;
    });
  });

  return order.map((key) => {
    const b = byBucket.get(key);
    return { label: period === "weekly" ? dv2ShortDayLabel(key) : dv2ShortMonthLabel(key), revenue: b.revenue, byPlatform: b.byPlatform };
  });
}

function dv2MondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay() || 7; // Sunday(0) -> 7
  dt.setUTCDate(dt.getUTCDate() - (dayOfWeek - 1));
  return dt.toISOString().slice(0, 10);
}

function dv2ShortDayLabel(dateStr) {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

function dv2ShortMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function dv2FormatRupiahShort(value) {
  const num = Number(value) || 0;
  if (Math.abs(num) >= 1000000) return "Rp" + (num / 1000000).toFixed(1) + "M";
  if (Math.abs(num) >= 1000) return "Rp" + Math.round(num / 1000) + "K";
  return "Rp" + Math.round(num);
}

// px-per-point wide enough that Daily view's ~30 points stay readable
// instead of being squeezed into the panel's fixed width - the panel
// scrolls horizontally (drag or native scrollbar) once content exceeds it.
const DV2_CHART_PX_PER_POINT = 46;

function dv2RevenueChartSvg(points) {
  if (!points.length) return "<p>No sales data yet.</p>";

  const width = Math.max(640, points.length * DV2_CHART_PX_PER_POINT), height = 240;
  const padding = { top: 16, right: 16, bottom: 26, left: 54 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? chartW / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + chartH - (p.value / maxVal) * chartH,
    label: p.label,
    value: p.value
  }));

  const linePath = coords.map((c, i) => (i === 0 ? "M" : "L") + c.x.toFixed(1) + " " + c.y.toFixed(1)).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = linePath + " L" + last.x.toFixed(1) + " " + (padding.top + chartH) + " L" + first.x.toFixed(1) + " " + (padding.top + chartH) + " Z";

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const y = padding.top + chartH - frac * chartH;
      return (
        '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y.toFixed(1) + '" stroke="#eee" stroke-width="1"/>' +
        '<text x="' + (padding.left - 8) + '" y="' + (y + 4).toFixed(1) + '" font-size="10" fill="#999" text-anchor="end">' + dv2FormatRupiahShort(frac * maxVal) + "</text>"
      );
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(coords.length / 8));
  const xLabels = coords
    .filter((c, i) => i % labelEvery === 0 || i === coords.length - 1)
    .map((c) => '<text x="' + c.x.toFixed(1) + '" y="' + (height - 8) + '" font-size="10" fill="#999" text-anchor="middle">' + c.label + "</text>")
    .join("");

  const dots = coords.map((c) => '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="2.5" fill="#2563eb"><title>' + c.label + ": " + formatRupiah(c.value) + "</title></circle>").join("");

  return (
    '<div class="dv2-chart-scroll">' +
      '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" style="width:' + width + 'px;">' +
        gridLines +
        '<path d="' + areaPath + '" fill="#2563eb1a" stroke="none"/>' +
        '<path d="' + linePath + '" fill="none" stroke="#2563eb" stroke-width="2"/>' +
        dots +
        xLabels +
      "</svg>" +
    "</div>"
  );
}

// One line per Sales Platform (Online/GrabFood/GoFood/Dine In/...), same
// axes/scale as the single-line Total view above so the two are visually
// comparable - just multiple polylines instead of one, plus a color legend.
function dv2RevenueMultiChartSvg(buckets) {
  if (!buckets.length) return "<p>No sales data yet.</p>";
  const platforms = dv2SortPlatforms([...new Set(buckets.flatMap((b) => Object.keys(b.byPlatform)))]);
  if (!platforms.length) return "<p>No sales data yet.</p>";

  const width = Math.max(640, buckets.length * DV2_CHART_PX_PER_POINT), height = 240;
  const padding = { top: 16, right: 16, bottom: 26, left: 54 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = Math.max(1, ...buckets.flatMap((b) => platforms.map((p) => b.byPlatform[p] || 0)));
  const stepX = buckets.length > 1 ? chartW / (buckets.length - 1) : 0;

  const xOf = (i) => padding.left + i * stepX;
  const yOf = (v) => padding.top + chartH - (v / maxVal) * chartH;

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const y = padding.top + chartH - frac * chartH;
      return (
        '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y.toFixed(1) + '" stroke="#eee" stroke-width="1"/>' +
        '<text x="' + (padding.left - 8) + '" y="' + (y + 4).toFixed(1) + '" font-size="10" fill="#999" text-anchor="end">' + dv2FormatRupiahShort(frac * maxVal) + "</text>"
      );
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const xLabels = buckets
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => i % labelEvery === 0 || i === buckets.length - 1)
    .map(({ b, i }) => '<text x="' + xOf(i).toFixed(1) + '" y="' + (height - 8) + '" font-size="10" fill="#999" text-anchor="middle">' + b.label + "</text>")
    .join("");

  const platformColors = dv2ColorsForPlatforms(platforms);

  const lines = platforms
    .map((platform, pi) => {
      const color = platformColors[pi];
      const path = buckets.map((b, i) => (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(b.byPlatform[platform] || 0).toFixed(1)).join(" ");
      const dots = buckets
        .map((b, i) => '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(b.byPlatform[platform] || 0).toFixed(1) + '" r="2" fill="' + color + '"><title>' + platform + " - " + b.label + ": " + formatRupiah(b.byPlatform[platform] || 0) + "</title></circle>")
        .join("");
      return '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>' + dots;
    })
    .join("");

  const legend = platforms
    .map(
      (platform, pi) =>
        '<span style="display:inline-flex; align-items:center; gap:4px; margin-right:14px; font-size:11px; color:#666;">' +
          '<span style="width:9px; height:9px; border-radius:2px; background:' + platformColors[pi] + '; display:inline-block;"></span>' + platform +
        "</span>"
    )
    .join("");

  return (
    '<div class="dv2-chart-scroll">' +
      '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" style="width:' + width + 'px;">' +
        gridLines + lines + xLabels +
      "</svg>" +
    "</div>" +
    '<div class="dv2-chart-legend">' + legend + "</div>"
  );
}

// Fixed brand-ish colors for the two channels the user singled out (Online =
// blue, GoFood = red); every other platform (GrabFood, Dine In, ...) falls
// back to the shared donut palette, skipping blue/red so it never collides
// with the fixed pair.
const DV2_PLATFORM_COLORS = { "Online": "#2563eb", "GoFood": "#dc2626" };
// Same palette as DV2_DONUT_COLORS below minus blue/red (already spoken for
// above) - kept as a literal instead of filtering that array, since this
// const runs at script-load time, before DV2_DONUT_COLORS is declared.
const DV2_FALLBACK_LINE_COLORS = ["#16a34a", "#f59e0b", "#8b5cf6", "#0891b2", "#db2777", "#65a30d"];

function dv2ColorsForPlatforms(platforms) {
  let fallbackIdx = 0;
  return platforms.map((platform) => {
    if (DV2_PLATFORM_COLORS[platform]) return DV2_PLATFORM_COLORS[platform];
    const color = DV2_FALLBACK_LINE_COLORS[fallbackIdx % DV2_FALLBACK_LINE_COLORS.length];
    fallbackIdx++;
    return color;
  });
}

// Explicit business-preferred order rather than alphabetical (which would
// read GoFood, GrabFood, Online) - unlisted platforms sort alphabetically
// after the three named ones.
const DV2_PLATFORM_ORDER = ["Online", "GrabFood", "GoFood"];

function dv2SortPlatforms(platforms) {
  return platforms.slice().sort((a, b) => {
    const ia = DV2_PLATFORM_ORDER.indexOf(a), ib = DV2_PLATFORM_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

// ---------- OpEx donut chart (inline SVG arcs, no library) ----------

const DV2_DONUT_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#8b5cf6", "#0891b2", "#db2777", "#65a30d"];

function dv2DonutSection(segments) {
  if (!segments.length) return "<p>No OpEx recorded yet this month.</p>";
  return dv2DonutChartHtml(segments);
}

function dv2PolarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function dv2DonutSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const p1 = dv2PolarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = dv2PolarToCartesian(cx, cy, rOuter, endAngle);
  const p3 = dv2PolarToCartesian(cx, cy, rInner, endAngle);
  const p4 = dv2PolarToCartesian(cx, cy, rInner, startAngle);
  return (
    "M " + p1.x.toFixed(2) + " " + p1.y.toFixed(2) +
    " A " + rOuter + " " + rOuter + " 0 " + largeArc + " 1 " + p2.x.toFixed(2) + " " + p2.y.toFixed(2) +
    " L " + p3.x.toFixed(2) + " " + p3.y.toFixed(2) +
    " A " + rInner + " " + rInner + " 0 " + largeArc + " 0 " + p4.x.toFixed(2) + " " + p4.y.toFixed(2) +
    " Z"
  );
}

function dv2DonutChartHtml(segments) {
  const total = segments.reduce((s, x) => s + x.amount, 0) || 1;
  const size = 150, cx = size / 2, cy = size / 2, rOuter = 66, rInner = 40;

  let angle = -90; // 12 o'clock start
  const paths = segments
    .map((seg, i) => {
      const frac = seg.amount / total;
      const sweep = Math.min(frac * 360, 359.999); // exact 360 degenerates the arc math
      const path = dv2DonutSegmentPath(cx, cy, rOuter, rInner, angle, angle + sweep);
      angle += sweep;
      return '<path d="' + path + '" fill="' + DV2_DONUT_COLORS[i % DV2_DONUT_COLORS.length] + '"><title>' + seg.category + ": " + formatRupiah(seg.amount) + "</title></path>";
    })
    .join("");

  const legend = segments
    .map(
      (seg, i) =>
        '<div style="display:flex; align-items:center; gap:6px; font-size:12px; margin:3px 0;">' +
          '<span style="width:10px; height:10px; border-radius:2px; background:' + DV2_DONUT_COLORS[i % DV2_DONUT_COLORS.length] + '; flex-shrink:0;"></span>' +
          '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + seg.category + "</span>" +
          '<span style="margin-left:auto; color:#666; white-space:nowrap;">' + formatRupiah(seg.amount) + "</span>" +
        "</div>"
    )
    .join("");

  return (
    '<div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">' +
      '<svg viewBox="0 0 ' + size + " " + size + '" style="width:130px; height:130px; flex-shrink:0;">' + paths + "</svg>" +
      '<div style="flex:1; min-width:120px;">' + legend + "</div>" +
    "</div>"
  );
}

// ---------- Orders Needing Action, transaction-history style ----------

function dv2ActionOrdersSection(orders) {
  if (!orders.length) return "<p>No orders need action right now.</p>";
  return (
    orders.map(dv2ActionOrderRowHtml).join("") +
    '<p style="margin:12px 0 0;"><button onclick="navigateTo(\'orders\')">View all Orders</button></p>'
  );
}

function dv2ActionOrderRowHtml(o) {
  const initial = (o.customerName || "?").charAt(0).toUpperCase();
  const badge = o.paymentStatus !== "Paid"
    ? '<span class="dv2-badge dv2-badge-red">Unpaid</span>'
    : '<span class="dv2-badge dv2-badge-amber">' + o.fulfillmentStatus + "</span>";

  return (
    '<div class="dv2-txn-row">' +
      '<div class="dv2-txn-avatar">' + initial + "</div>" +
      '<div class="dv2-txn-main">' +
        '<div class="dv2-txn-name">' + o.customerName + "</div>" +
        '<div class="dv2-txn-sub">' + o.orderCode + " &middot; " + o.orderDate + " &middot; " + o.orderType + "</div>" +
      "</div>" +
      '<div class="dv2-txn-right">' +
        '<div class="dv2-txn-amount">' + formatRupiah(o.totalPrice) + "</div>" +
        badge +
      "</div>" +
    "</div>"
  );
}

// ---------- Unpaid Driver Payout / Stock Alert mini progress cards ----------

// caption spells out exactly what the bar's fraction means - a bare colored
// bar with no accompanying text reads as decorative even when it isn't, per
// explicit request.
function dv2MiniProgressCardHtml(label, valueText, ratio, color, caption, onclick) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const clickAttr = onclick ? ' onclick="' + onclick + '"' : "";
  return (
    '<div class="dv2-card dv2-mini-card"' + clickAttr + ">" +
      '<div class="dv2-mini-label">' + label + "</div>" +
      '<div class="dv2-mini-value">' + valueText + "</div>" +
      '<div class="dv2-mini-bar-track"><div class="dv2-mini-bar-fill" style="width:' + pct.toFixed(1) + "%; background:" + color + ';"></div></div>' +
      '<div style="font-size:11px; color:#888; margin-top:4px;">' + caption + "</div>" +
    "</div>"
  );
}

// Progress = how much of THIS MONTH's driver payout obligation is still
// unpaid (paid vs unpaid split, functions/api/dashboard.js's
// driverPayoutThisMonth) - the headline number itself stays the all-time
// actionable total (unpaidDriverPayout), same as the original Dashboard.
function dv2UnpaidDriverPayoutCard(unpaidTotal, monthSplit) {
  const monthTotal = monthSplit.paid + monthSplit.unpaid;
  const ratio = monthTotal > 0 ? monthSplit.unpaid / monthTotal : 0;
  const caption = monthTotal > 0
    ? Math.round(ratio * 100) + "% of this month's driver fees unpaid"
    : "No driver fees this month yet";
  return dv2MiniProgressCardHtml(
    "Unpaid Driver Payout",
    formatRupiah(unpaidTotal),
    ratio,
    "#dc2626",
    caption,
    "navigateTo('orders?tab=payout')"
  );
}

function dv2StockAlertCard(items, totalTracked) {
  const count = items.length;
  const label = count === 0 ? "All stock OK" : count + " item" + (count === 1 ? "" : "s") + " Low Stock";
  const ratio = totalTracked > 0 ? count / totalTracked : 0;
  const caption = totalTracked > 0
    ? count + " of " + totalTracked + " tracked items low"
    : "No items being tracked yet";
  return dv2MiniProgressCardHtml(
    "Stock Alert",
    label,
    ratio,
    "#f59e0b",
    caption,
    count > 0 ? "navigateTo('inventory-stock?tab=overview&filter=low')" : null
  );
}
