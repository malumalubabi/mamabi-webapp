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
    "<h2>Dashboard</h2>" +

    '<div class="dv2-stat-row">' +
      dv2StatCard("Cash Balance", formatRupiah(data.cashBalance)) +
      dv2StatCard("Bank Balance", formatRupiah(data.bankBalance)) +
      dv2StatCard("Net Cashflow", formatRupiah(data.income - data.expense), "actual, this month") +
      dv2StatCard("Net Profit", formatRupiah(data.netProfit), "accrual, this month") +
    "</div>" +

    '<div class="dv2-grid-2col dv2-align-stretch">' +
      '<div class="dv2-col-main">' +
        '<div class="dv2-card dv2-flow-card">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:8px;">' +
            "<h4>Revenue Flow</h4>" +
            '<div style="display:flex; gap:8px;">' +
              '<select id="dv2RevenueView" onchange="dv2RenderRevenueChart()">' +
                '<option value="total">All Channel</option>' +
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
          '<button onclick="openSalesEntryModal()">+ Input Sales</button>' +
          '<button onclick="openPurchaseModal()">+ Input Purchase</button>' +
          '<button onclick="openBatchModal()">+ Start New Batch</button>' +
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
      // Shadow-only for depth (no border) - box-shadow already reads as a
      // raised card on its own, a border on top of it is redundant.
      ".dv2-stat { flex:1 1 160px; background:var(--color-card-bg); background:var(--gradient-card-bg); box-shadow:0 1px 3px rgba(5,51,74,0.08); border-radius:10px; padding:12px 16px; }" +
      ".dv2-stat-label { font-size:12px; color:var(--color-text-muted); }" +
      // 18px = the app's one heading size (shared.css h2/h3/h4) - kept to
      // that same tier instead of its own larger size, per the "2-3 sizes
      // total" simplification; bold carries the emphasis instead.
      ".dv2-stat-value { font-size:18px; font-weight:bold; margin-top:2px; font-family:\"Inter\", Arial, sans-serif; }" +
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
      // position:relative so the hover tooltip (absolutely positioned, see
      // dv2WireChartTooltip) is placed relative to the chart area, not the
      // whole page.
      ".dv2-flow-chart-wrap { flex:1; min-height:220px; display:flex; flex-direction:column; min-width:0; position:relative; }" +
      ".dv2-chart-tooltip { position:absolute; pointer-events:none; display:none; background:var(--color-bg-page); color:var(--color-card-bg); font-size:12px; padding:6px 8px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.25); white-space:nowrap; z-index:10; }" +
      ".dv2-chart-tooltip .dv2-tt-row { display:flex; align-items:center; gap:6px; }" +
      ".dv2-chart-tooltip .dv2-tt-dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0; }" +
      // Row = frozen Y-axis SVG (fixed width, not part of the scroll area)
      // + the scrollable chart SVG side by side - so the axis labels stay
      // put while dragging/scrolling the chart horizontally instead of
      // sliding off with the data. align-items:center so any leftover
      // vertical space (both SVGs are a fixed pixel height now, see below)
      // sits evenly above/below instead of all at the bottom.
      ".dv2-chart-row { display:flex; flex:1; min-height:0; align-items:center; }" +
      // Both SVGs set an explicit height inline (matching their own
      // viewBox height exactly, see dv2RevenueAxisSvg/dv2RevenueChartSvg/
      // dv2RevenueMultiChartSvg) instead of height:100% - a percentage
      // height here would almost never exactly equal the viewBox height,
      // and combined with preserveAspectRatio="none" (needed so the axis
      // and chart scale identically, and so the chart fills its full
      // scrollable width) that mismatch stretches every glyph inside the
      // SVG non-uniformly, making the axis/date labels look squashed.
      // Pinning both dimensions 1:1 to the viewBox removes the mismatch
      // entirely, so nothing is left to stretch.
      ".dv2-chart-axis { flex-shrink:0; display:block; }" +
      // Chart itself gets a real pixel width (points.length * px-per-point,
      // see dv2RevenueChartSvg/dv2RevenueMultiChartSvg) so dense Daily data
      // doesn't get squeezed - this scrolls it horizontally instead
      // (enableDragScroll wired up in dv2RenderRevenueChart).
      ".dv2-chart-scroll { flex:1; min-height:0; overflow-x:auto; overflow-y:hidden; }" +
      ".dv2-chart-scroll svg { display:block; }" +
      ".dv2-chart-legend { flex-shrink:0; margin-top:6px; }" +
      // Shadow-only, same reasoning as .dv2-stat above - and h4's font-size/
      // weight/margin are no longer set here at all, now that shared.css
      // defines one shared heading tier for every h2/h3/h4 in the app;
      // color still needed since .dv2-card's own background differs from
      // whatever ambient text color its container would otherwise inherit.
      ".dv2-card { background:var(--color-card-bg); background:var(--gradient-card-bg); box-shadow:0 1px 3px rgba(5,51,74,0.08); border-radius:10px; padding:16px; }" +
      ".dv2-card h4 { color:var(--color-text-primary); }" +
      ".dv2-quick-actions button { display:block; width:100%; box-sizing:border-box; text-align:left; padding:12px; margin-bottom:8px; border-radius:8px; border:1px solid var(--color-border-on-card); background:var(--color-accent-tint); color:var(--color-text-primary); cursor:pointer; }" +
      ".dv2-quick-actions button:last-child { margin-bottom:0; }" +
      // filter:none cancels shared.css's generic button:hover{filter:brightness(1.2)},
      // which would otherwise wash this pink tint 20% toward white on hover.
      ".dv2-quick-actions button:hover { filter:none; background:var(--color-accent); }" +
      ".dv2-txn-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--color-border-on-card); }" +
      ".dv2-txn-row:last-child { border-bottom:none; }" +
      ".dv2-txn-avatar { width:36px; height:36px; border-radius:50%; background:var(--color-accent-tint); color:var(--color-text-primary); display:flex; align-items:center; justify-content:center; font-weight:600; flex-shrink:0; }" +
      ".dv2-txn-main { flex:1; min-width:0; }" +
      ".dv2-txn-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }" +
      ".dv2-txn-sub { font-size:12px; color:var(--color-text-muted); }" +
      ".dv2-txn-right { text-align:right; flex-shrink:0; }" +
      ".dv2-txn-amount { font-weight:600; font-family:\"Inter\", Arial, sans-serif; }" +
      ".dv2-badge { display:inline-block; font-size:12px; padding:4px 8px; border-radius:999px; margin-top:4px; }" +
      ".dv2-badge-red { background:#fee2e2; color:#b91c1c; }" +
      ".dv2-badge-amber { background:#fef3c7; color:#92400e; }" +
      ".dv2-mini-card { cursor:pointer; }" +
      ".dv2-mini-label { font-size:12px; color:var(--color-text-muted); }" +
      ".dv2-mini-value { font-size:18px; font-weight:bold; margin:4px 0 8px; font-family:\"Inter\", Arial, sans-serif; }" +
      ".dv2-mini-bar-track { background:var(--color-disabled-bg); border-radius:999px; height:6px; overflow:hidden; }" +
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

  dv2WireChartTooltip(el, buckets, view);
}

// Custom hover tooltip (not just the native <title> already on each dot) -
// tracks the mouse across the whole chart width, snaps to the nearest
// point regardless of how precisely the cursor lands on a dot, and shows
// every series' exact value at that point instantly (no native-tooltip
// delay). Recomputes width/padding/stepX/maxVal identically to whichever
// draw function just ran - deterministic pure functions of buckets.length
// and view, so recomputing here (rather than threading the values out of
// dv2RevenueChartSvg/dv2RevenueMultiChartSvg) can't drift out of sync.
function dv2WireChartTooltip(el, buckets, view) {
  const scrollEl = el.querySelector(".dv2-chart-scroll");
  const svg = scrollEl ? scrollEl.querySelector("svg") : null;
  const tooltip = el.querySelector(".dv2-chart-tooltip");
  if (!svg || !tooltip || !buckets.length) return;

  const width = Math.max(640, buckets.length * DV2_CHART_PX_PER_POINT);
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 26, left: 8 };
  const chartH = height - padding.top - padding.bottom;
  const stepX = buckets.length > 1 ? (width - padding.left - padding.right) / (buckets.length - 1) : 0;
  const xOf = (i) => padding.left + i * stepX;

  let platforms = null, platformColors = null, maxVal;
  if (view === "channel") {
    platforms = dv2SortPlatforms([...new Set(buckets.flatMap((b) => Object.keys(b.byPlatform)))]);
    if (!platforms.length) return;
    platformColors = dv2ColorsForPlatforms(platforms);
    maxVal = dv2NiceMax(Math.max(1, ...buckets.flatMap((b) => platforms.map((p) => b.byPlatform[p] || 0))));
  } else {
    maxVal = dv2NiceMax(Math.max(1, ...buckets.map((b) => b.revenue)));
  }
  const yOf = (v) => padding.top + chartH - (v / maxVal) * chartH;

  const svgNS = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(svgNS, "g");
  overlay.style.display = "none";
  const line = document.createElementNS(svgNS, "line");
  line.setAttribute("y1", padding.top);
  line.setAttribute("y2", padding.top + chartH);
  line.setAttribute("stroke", "var(--color-text-muted)");
  line.setAttribute("stroke-width", "1");
  line.setAttribute("stroke-dasharray", "3,3");
  overlay.appendChild(line);

  const dotColors = view === "channel" ? platformColors : ["#2563eb"];
  const dots = dotColors.map((color) => {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("r", "4");
    c.setAttribute("fill", color);
    c.setAttribute("stroke", "var(--color-card-bg)");
    c.setAttribute("stroke-width", "1.5");
    overlay.appendChild(c);
    return c;
  });
  svg.appendChild(overlay);

  function showAt(index) {
    const b = buckets[index];
    const x = xOf(index);
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);

    let html;
    if (view === "channel") {
      dots.forEach((dot, pi) => {
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", yOf(b.byPlatform[platforms[pi]] || 0));
      });
      html = '<div style="font-weight:bold; margin-bottom:4px;">' + b.label + "</div>" +
        platforms.map((p, pi) =>
          '<div class="dv2-tt-row"><span class="dv2-tt-dot" style="background:' + platformColors[pi] + ';"></span>' + p + ': <span class="font-number">' + formatRupiah(b.byPlatform[p] || 0) + "</span></div>"
        ).join("");
    } else {
      dots[0].setAttribute("cx", x);
      dots[0].setAttribute("cy", yOf(b.revenue));
      html = '<div style="font-weight:bold;">' + b.label + '</div><div><span class="font-number">' + formatRupiah(b.revenue) + "</span></div>";
    }
    tooltip.innerHTML = html;
    overlay.style.display = "";
    tooltip.style.display = "block";
  }

  function hide() {
    overlay.style.display = "none";
    tooltip.style.display = "none";
  }

  svg.addEventListener("mousemove", function (e) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const scaleX = width / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    let index = Math.round((svgX - padding.left) / (stepX || 1));
    index = Math.max(0, Math.min(buckets.length - 1, index));
    showAt(index);

    // Positioned relative to the chart-wrap (el), not the page - flipped to
    // the cursor's left instead of right when it would otherwise spill past
    // the visible (non-scrolled) edge.
    const wrapRect = el.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 140;
    let left = e.clientX - wrapRect.left + 14;
    if (left + tooltipWidth > wrapRect.width) left = e.clientX - wrapRect.left - tooltipWidth - 14;
    tooltip.style.left = left + "px";
    tooltip.style.top = (e.clientY - wrapRect.top - 10) + "px";
  });
  svg.addEventListener("mouseleave", hide);
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

// Rounds the raw data max UP to a "nice" round number (1/2/2.5/5/10 x a
// power of 10) - both the chart's vertical scale and the Y-axis gridline
// values derive from this, so an odd max like 677,000 doesn't produce an
// equally odd-looking axis label. Standard "nice numbers" chart-axis
// algorithm, not anything sales-specific.
function dv2NiceMax(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = Math.pow(10, exponent);
  const fraction = value / magnitude;
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * magnitude;
}

// px-per-point wide enough that Daily view's ~30 points stay readable
// instead of being squeezed into the panel's fixed width - the panel
// scrolls horizontally (drag or native scrollbar) once content exceeds it.
const DV2_CHART_PX_PER_POINT = 46;
const DV2_AXIS_WIDTH = 46;

// Frozen Y-axis: a separate fixed-width SVG (not inside .dv2-chart-scroll),
// so the value labels stay visible while the chart itself scrolls
// horizontally - per explicit request. top/bottom must match whatever
// padding the accompanying chart SVG uses so the gridline heights line up.
function dv2RevenueAxisSvg(maxVal, height, padding) {
  const chartH = height - padding.top - padding.bottom;
  const labels = [0, 0.5, 1]
    .map((frac) => {
      const y = padding.top + chartH - frac * chartH;
      return '<text x="' + (DV2_AXIS_WIDTH - 6) + '" y="' + (y + 4).toFixed(1) + '" font-size="10" fill="var(--color-text-muted)" text-anchor="end">' + dv2FormatRupiahShort(frac * maxVal) + "</text>";
    })
    .join("");
  // width AND height both pinned inline to the viewBox's own dimensions
  // (not height:100%, see .dv2-chart-axis) - keeps the rendered aspect
  // ratio exactly 1:1 with the viewBox so nothing inside (the axis text)
  // gets stretched, while still lining gridlines up with the chart SVG
  // exactly since both use this same height.
  return '<svg class="dv2-chart-axis" viewBox="0 0 ' + DV2_AXIS_WIDTH + " " + height + '" style="width:' + DV2_AXIS_WIDTH + "px; height:" + height + 'px;">' + labels + "</svg>";
}

function dv2RevenueChartSvg(points) {
  if (!points.length) return "<p>No sales data yet.</p>";

  const width = Math.max(640, points.length * DV2_CHART_PX_PER_POINT), height = 240;
  const padding = { top: 16, right: 16, bottom: 26, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = dv2NiceMax(Math.max(1, ...points.map((p) => p.value)));
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
      return '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y.toFixed(1) + '" stroke="var(--color-border-on-card)" stroke-width="1"/>';
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(coords.length / 8));
  const xLabels = coords
    .filter((c, i) => i % labelEvery === 0 || i === coords.length - 1)
    .map((c) => '<text x="' + c.x.toFixed(1) + '" y="' + (height - 8) + '" font-size="10" fill="var(--color-text-muted)" text-anchor="middle">' + c.label + "</text>")
    .join("");

  const dots = coords.map((c) => '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="2.5" fill="#2563eb"><title>' + c.label + ": " + formatRupiah(c.value) + "</title></circle>").join("");

  return (
    '<div class="dv2-chart-row">' +
      dv2RevenueAxisSvg(maxVal, height, padding) +
      '<div class="dv2-chart-scroll">' +
        '<svg viewBox="0 0 ' + width + " " + height + '" style="width:' + width + "px; height:" + height + 'px;">' +
          gridLines +
          '<path d="' + areaPath + '" fill="#2563eb1a" stroke="none"/>' +
          '<path d="' + linePath + '" fill="none" stroke="#2563eb" stroke-width="2"/>' +
          dots +
          xLabels +
        "</svg>" +
      "</div>" +
    "</div>" +
    '<div class="dv2-chart-tooltip"></div>'
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
  const padding = { top: 16, right: 16, bottom: 26, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const maxVal = dv2NiceMax(Math.max(1, ...buckets.flatMap((b) => platforms.map((p) => b.byPlatform[p] || 0))));
  const stepX = buckets.length > 1 ? chartW / (buckets.length - 1) : 0;

  const xOf = (i) => padding.left + i * stepX;
  const yOf = (v) => padding.top + chartH - (v / maxVal) * chartH;

  const gridLines = [0, 0.5, 1]
    .map((frac) => {
      const y = padding.top + chartH - frac * chartH;
      return '<line x1="' + padding.left + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding.right) + '" y2="' + y.toFixed(1) + '" stroke="var(--color-border-on-card)" stroke-width="1"/>';
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const xLabels = buckets
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => i % labelEvery === 0 || i === buckets.length - 1)
    .map(({ b, i }) => '<text x="' + xOf(i).toFixed(1) + '" y="' + (height - 8) + '" font-size="10" fill="var(--color-text-muted)" text-anchor="middle">' + b.label + "</text>")
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
        '<span style="display:inline-flex; align-items:center; gap:4px; margin-right:12px; font-size:12px; color:var(--color-text-muted);">' +
          '<span style="width:9px; height:9px; border-radius:2px; background:' + platformColors[pi] + '; display:inline-block;"></span>' + platform +
        "</span>"
    )
    .join("");

  return (
    '<div class="dv2-chart-row">' +
      dv2RevenueAxisSvg(maxVal, height, padding) +
      '<div class="dv2-chart-scroll">' +
        '<svg viewBox="0 0 ' + width + " " + height + '" style="width:' + width + "px; height:" + height + 'px;">' +
          gridLines + lines + xLabels +
        "</svg>" +
      "</div>" +
    "</div>" +
    '<div class="dv2-chart-tooltip"></div>' +
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
        '<div style="display:flex; align-items:center; gap:8px; font-size:12px; margin:4px 0;">' +
          '<span style="width:10px; height:10px; border-radius:2px; background:' + DV2_DONUT_COLORS[i % DV2_DONUT_COLORS.length] + '; flex-shrink:0;"></span>' +
          '<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + seg.category + "</span>" +
          '<span class="font-number" style="margin-left:auto; color:var(--color-text-muted); white-space:nowrap;">' + formatRupiah(seg.amount) + "</span>" +
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
        '<div class="dv2-txn-sub">' + o.orderCode + "&nbsp;&nbsp;&nbsp;" + o.orderDate + "&nbsp;&nbsp;&nbsp;" + o.orderType + "</div>" +
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
      '<div style="font-size:12px; color:var(--color-text-muted); margin-top:4px;">' + caption + "</div>" +
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
    "navigateTo('orders-payout')"
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
