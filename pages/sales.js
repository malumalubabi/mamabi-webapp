// Sales - ported from the old app's 03 Sales module (Sales_Nav.html:
// Summary/Log/Input Sales). Input Sales is a MODAL (not a 3rd tab), matching
// this app's established pattern (New Order, Input Purchase, Input
// Transaction are all modals) - deviates from the old app's page-per-tab
// layout on purpose. One submission (Date+Platform+Platform Fee+Marketing
// Fee, shared) can carry several products, matching the old app's
// SalesEntry.html exactly - see functions/api/sales.js for how that maps
// onto sales_batches (the shared bits + fee/OpEx) + sales_entries (one row
// per product, its own sales_code).
//
// Summary and Log used to be separate tabs - now a single stacked page
// (Log below Summary, no tab-switch) per explicit request, so the nav's
// Sales entry is a plain button too (index.html), not a Summary/Log
// dropdown.
registerPage("sales", renderSalesPage);

let _salesLookups = null;
let _lastSalesRows = [];
let _salesLogChannelFilter = []; // empty = show every Channel (default)
let _salesLogDateFrom = "";
let _salesLogDateTo = "";
let _salesLogSort = "date-desc";
const SALES_LOG_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function ensureSalesLookups() {
  if (!_salesLookups) _salesLookups = await api("lookups");
  return _salesLookups;
}

async function renderSalesPage(content) {
  await ensureSalesLookups();

  content.innerHTML =
    "<h2>Sales</h2>" +
    '<div id="salesSummaryWrap"><p>Loading...</p></div>' +
    '<div id="salesLogWrap" style="margin-top:28px;"></div>';
  await loadSalesData();

  const query = location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  if (params.get("action") === "input") openSalesEntryModal();
}

// GET /api/sales already merges manual + live-derived Online rows and
// sorts newest first - Summary and Log both just read/reshape
// _lastSalesRows client side, no separate summary endpoint needed.
async function loadSalesData() {
  _lastSalesRows = await api("sales");
  if (!document.getElementById("salesSummaryWrap")) return;

  renderSalesSummaryTab(document.getElementById("salesSummaryWrap"));
  renderSalesLogTab(document.getElementById("salesLogWrap"));
}

// ---------- Summary ----------

function renderSalesSummaryTab(wrap) {
  const monthKey = todayISO().slice(0, 7);
  const rows = _lastSalesRows.filter((r) => r.date.slice(0, 7) === monthKey);

  if (!rows.length) {
    wrap.innerHTML = "<h3>This Month Recap</h3><p>No sales recorded this month yet.</p>";
    return;
  }

  const platforms = Array.from(new Set(rows.map((r) => r.platform)));
  const summary = platforms.map((platform) => {
    const platformRows = rows.filter((r) => r.platform === platform);
    return {
      platform: platform,
      revenue: platformRows.reduce((s, r) => s + r.revenue, 0),
      qty: platformRows.reduce((s, r) => s + r.qty, 0),
      grossProfit: platformRows.reduce((s, r) => s + r.grossProfit, 0)
    };
  });

  const totals = summary.reduce(
    (acc, p) => ({ revenue: acc.revenue + p.revenue, qty: acc.qty + p.qty, grossProfit: acc.grossProfit + p.grossProfit }),
    { revenue: 0, qty: 0, grossProfit: 0 }
  );

  const monthLabel = new Date(monthKey + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  wrap.innerHTML =
    "<h3>This Month Recap</h3>" +
    "<table>" +
      "<thead><tr><th>" + monthLabel + "</th>" + summary.map((p) => "<th>" + p.platform + "</th>").join("") + "<th>Total</th></tr></thead>" +
      "<tbody>" +
        '<tr><td>Total Revenue</td>' + summary.map((p) => '<td><span class="font-number">' + formatRupiah(p.revenue) + "</span></td>").join("") + '<td><span class="font-number">' + formatRupiah(totals.revenue) + "</span></td></tr>" +
        "<tr><td>Total QTY Sold</td>" + summary.map((p) => "<td>" + p.qty + "</td>").join("") + "<td>" + totals.qty + "</td></tr>" +
        '<tr><td>Total Gross Profit</td>' + summary.map((p) => '<td><span class="font-number">' + formatRupiah(p.grossProfit) + "</span></td>").join("") + '<td><span class="font-number">' + formatRupiah(totals.grossProfit) + "</span></td></tr>" +
        "<tr><td>Gross Margin</td>" +
          summary.map((p) => "<td>" + formatPercent(p.revenue ? p.grossProfit / p.revenue : 0) + "</td>").join("") +
          "<td>" + formatPercent(totals.revenue ? totals.grossProfit / totals.revenue : 0) + "</td></tr>" +
      "</tbody>" +
    "</table>";
}

// ---------- Log ----------

// Generic version of the old app's withOrderMergeInfo_() - groups by
// groupKey ("order:ORD-0079" for Online, "batch:SLB-0001" for manual)
// instead of Order ID specifically, so Delivery Fee/Order ID can be shown
// once per group via rowspan regardless of which source the group came from.
function withGroupMergeInfo(rows) {
  return rows.map((r, i) => {
    if (i > 0 && rows[i - 1].groupKey === r.groupKey) {
      return Object.assign({}, r, { mergeSpan: 0 });
    }
    let span = 1;
    while (rows[i + span] && rows[i + span].groupKey === r.groupKey) span++;
    return Object.assign({}, r, { mergeSpan: span });
  });
}

// Sums revenue across every product line in a batch/order group, for the
// Total Revenue column's Gross figure (a single product line's own revenue
// isn't the batch's total when there's more than one product in it).
function withGroupRevenueTotals(rows) {
  const totals = {};
  rows.forEach((r) => { totals[r.groupKey] = (totals[r.groupKey] || 0) + r.revenue; });
  return rows.map((r) => Object.assign({}, r, { groupRevenue: totals[r.groupKey] }));
}

// Loosely based on the old app's SalesTable.html columns, since diverged:
// "Margin" relabeled "Gross Margin" (matches the Summary tab's wording);
// Delivery Fee/Platform Fee/Marketing Fee collapsed into one contextual
// "Fees" column; Channel and Order ID both dropped as their own columns,
// now ride muted underneath Date instead; a "Total Revenue" column (Gross/
// Net for the whole batch) added at the end (all rowspan-merged once per
// batch/order group).
// Every Channel value that can appear in the Log. "Online" is a real Sales
// Platform entry now (Base Pricing meta, same as Dine In) purely so it's
// documented/orderable in Settings - it's still never a manual choice, see
// salePlatformOptionsHtml below, which is the one place it gets filtered
// back out.
function salesLogChannelOptions() {
  return _salesLookups.salesPlatforms;
}

// Same as Stock Overview's applyOverviewFilter() - re-renders from the
// already-fetched _lastSalesRows, no re-fetch needed just to change filters/sort.
function openSalesLogFilterSortModal() {
  const sortOptions = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  const checkboxes = salesLogChannelOptions().map((c) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="salesLogChannelCheck" value="' + c + '"' + (_salesLogChannelFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c +
    "</label>"
  ).join("");
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="salesLogSortOption" value="' + val + '"' + (_salesLogSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Sales Log</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="salesLogDateFrom" value="' + _salesLogDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="salesLogDateTo" value="' + _salesLogDateTo + '">' +
    "</div><br><br>" +
    "<label>Channel</label>" +
    "<div>" + checkboxes + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applySalesLogFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applySalesLogFilterSort() {
  _salesLogDateFrom = document.getElementById("salesLogDateFrom").value || "";
  _salesLogDateTo = document.getElementById("salesLogDateTo").value || "";
  _salesLogChannelFilter = Array.from(document.querySelectorAll(".salesLogChannelCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="salesLogSortOption"]:checked');
  if (selectedSort) _salesLogSort = selectedSort.value;
  closeModal();
  renderSalesLogTab(document.getElementById("salesLogWrap"));
}

// Groups by groupKey first (preserving first-seen order) and sorts the
// GROUPS by date - not a flat sort of individual rows, which could scatter
// a multi-product batch/order's lines apart from each other and break
// withGroupMergeInfo's rowspan merge (it needs same-groupKey rows
// contiguous). Every line in one group shares the same date already, so
// this is the group's own date either way.
function sortSalesGroups(rows) {
  const order = [];
  const byKey = new Map();
  rows.forEach((r) => {
    if (!byKey.has(r.groupKey)) { byKey.set(r.groupKey, []); order.push(r.groupKey); }
    byKey.get(r.groupKey).push(r);
  });
  const groups = order.map((k) => byKey.get(k));
  groups.sort((a, b) => {
    if (a[0].date === b[0].date) return 0;
    const cmp = a[0].date < b[0].date ? -1 : 1;
    return _salesLogSort === "date-asc" ? cmp : -cmp;
  });
  return groups.flat();
}

function renderSalesLogTab(wrap) {
  if (!_lastSalesRows.length) {
    wrap.innerHTML = "<h3>Sales Log</h3><p>No sales recorded yet.</p>";
    return;
  }

  const filteredRows = _lastSalesRows.filter((r) =>
    (!_salesLogChannelFilter.length || _salesLogChannelFilter.indexOf(r.platform) !== -1) &&
    (!_salesLogDateFrom || r.date >= _salesLogDateFrom) &&
    (!_salesLogDateTo || r.date <= _salesLogDateTo)
  );
  const rows = withGroupMergeInfo(withGroupRevenueTotals(sortSalesGroups(filteredRows)));

  // table-layout:fixed + an explicit colgroup - pagination hides rows via
  // display:none rather than removing them, so with the default auto layout
  // each page's column widths would get recomputed from only that page's
  // (differently-sized) content and visibly jump between pages.
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Sales Log</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="salesLogFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openSalesLogFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openSalesEntryModal()">+ Input Sales</button>' +
      "</div>" +
    "</div>" +
    '<div id="salesPaginationNav" class="pagination-nav"></div>' +
    (rows.length
      // Product got squeezed to near-nothing once enough fixed-width columns
      // piled up (table-layout:fixed only gives it whatever's left) - every
      // column now has its own generous fixed width (no "flowing" to fit the
      // viewport), and the table overflows its own min-width into a
      // horizontal scrollbar (wrapper below) rather than crushing anything.
      ? '<div id="salesLogScrollWrap" style="overflow-x:auto;">' +
        '<table style="table-layout:fixed; min-width:1260px;">' +
          '<colgroup><col style="width:130px;"><col style="width:220px;"><col style="width:50px;">' +
            '<col style="width:100px;"><col style="width:100px;"><col style="width:100px;"><col style="width:80px;">' +
            '<col style="width:130px;"><col style="width:130px;"><col style="width:140px;"><col style="width:70px;"></colgroup>' +
          "<thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Selling Price</th><th>Revenue</th>" +
          "<th>Gross Profit</th><th>Gross Margin</th><th>Fees</th><th>Total Revenue</th><th>Notes</th><th></th></tr></thead>" +
          '<tbody id="salesLogTbody">' + rows.map(salesRowHtml).join("") + "</tbody>" +
        "</table>" +
        "</div>"
      : "<p>No sales match this filter.</p>");

  const badge = document.getElementById("salesLogFilterSortBadge");
  if (badge) {
    const dateParts = [];
    if (_salesLogDateFrom) dateParts.push("from " + _salesLogDateFrom);
    if (_salesLogDateTo) dateParts.push("to " + _salesLogDateTo);
    const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
    badge.textContent = dateText + " | " + (_salesLogChannelFilter.length ? _salesLogChannelFilter.join(", ") : "All") + " | " + SALES_LOG_SORT_LABELS[_salesLogSort];
  }

  if (rows.length) {
    paginateGroupedTable("salesLogTbody", "salesPaginationNav", 5);
    enableDragScroll(document.getElementById("salesLogScrollWrap"));
  }
}

function salesRowHtml(r) {
  const groupStart = r.mergeSpan > 0;
  const rowspanAttr = r.mergeSpan > 1 ? ' rowspan="' + r.mergeSpan + '"' : "";
  const isManual = r.source === "manual";

  // One "Fees" column standing in for whatever fee concept applies to this
  // Channel - Online has a Delivery Fee, GrabFood/GoFood have Platform/
  // Marketing Fee (either line dropped if 0/empty), Dine In has none.
  const feesCell = groupStart ? "<td" + rowspanAttr + ">" + salesFeesCellHtml(r) + "</td>" : "";

  // Gross/Net Revenue for the whole batch/order, not just this one product
  // line - same Net formula as the Input Sales modal (Gross - (Platform Fee
  // + Marketing Fee)). Online/Dine In never carry those fees, so Net would
  // always equal Gross there - not worth a second line.
  const totalRevenueCell = groupStart ? "<td" + rowspanAttr + ">" + salesTotalRevenueCellHtml(r) + "</td>" : "";

  // Date/Channel/Order ID share one column now - Date on top, Channel (and
  // Order ID, for every Online row, Delivery or Takeaway alike - deviates
  // from the old app's Delivery-only rule, per explicit request) muted
  // underneath, same rowspan merge as Fees/Actions since all three are
  // shared by every product line in a batch/order.
  const orderIdSuffix = r.source === "online" ? "<br>" + r.refId : "";
  const dateCell = groupStart
    ? "<td" + rowspanAttr + ">" + r.date + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.platform + orderIdSuffix + "</span></td>"
    : "";

  // Single entry point per batch (not per product line) - one "Edit" button,
  // shown once per group, opens a modal covering every possible action
  // (edit fee, edit/remove/add products, delete the whole batch). Online
  // rows aren't editable here at all, go edit the source Order instead,
  // same restriction as the old app. The cell itself is rowspan'd like
  // deliveryCell/orderIdCell (not just its contents) so a multi-line batch
  // doesn't leave a trail of empty bordered cells down every other row.
  const batchActions = isManual
    ? '<button class="btn-compact" onclick="openSalesBatchModal(\'' + r.refId + '\')">Edit</button>'
    : "";
  const actionsCell = groupStart ? "<td" + rowspanAttr + ' class="colActions compact-cell">' + batchActions + "</td>" : "";

  // Notes is a batch/order-level note (cascaded onto every line at save
  // time, not something that ever varies line-to-line within one group) -
  // same rowspan merge as Date/Fees/Total Revenue/Actions.
  const notesCell = groupStart ? "<td" + rowspanAttr + ">" + (r.notes || "") + "</td>" : "";

  const margin = r.revenue ? r.grossProfit / r.revenue : 0;

  return (
    '<tr class="' + (groupStart ? "group-start" : "") + '">' +
      dateCell +
      "<td>" + r.productName + "</td>" +
      "<td>" + r.qty + "</td>" +
      '<td><span class="font-number">' + formatRupiah(r.sellingPrice) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.revenue) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.grossProfit) + "</span></td>" +
      "<td>" + formatPercent(margin) + "</td>" +
      feesCell + totalRevenueCell + notesCell + actionsCell +
    "</tr>"
  );
}

function salesFeeLineHtml(label, amount) {
  return '<span style="color:var(--color-text-muted); font-size:12px;">' + label + ':</span><br><span class="font-number">' + formatRupiah(amount) + "</span>";
}

function salesFeesCellHtml(r) {
  if (r.platform === "Online") {
    return r.deliveryFee > 0 ? salesFeeLineHtml("Delivery", r.deliveryFee) : "-";
  }
  if (r.platform === "GrabFood" || r.platform === "GoFood") {
    const lines = [];
    if (r.platformFee > 0) lines.push(salesFeeLineHtml("Platform", r.platformFee));
    if (r.marketingFee > 0) lines.push(salesFeeLineHtml("Marketing", r.marketingFee));
    return lines.length ? lines.join("<br>") : "-";
  }
  return "-"; // Dine In has no fee concept
}

function salesTotalRevenueCellHtml(r) {
  const gross = r.groupRevenue;
  if (r.platform === "GrabFood" || r.platform === "GoFood") {
    const net = gross - (r.platformFee + r.marketingFee);
    return salesFeeLineHtml("Gross", gross) + "<br>" + salesFeeLineHtml("Net", net);
  }
  return salesFeeLineHtml("Gross", gross);
}

// ---------- Input Sales (create a batch) ----------

// Only Platform Pricing platforms are manually selectable here - Base
// Pricing ones (Online today, Dine In once its own auto-entry scheme from
// the web exists) have their own auto-derived source instead of ever going
// through Input Sales/Batch Edit, same reasoning as Online's existing
// getOnlineSalesRows in functions/api/_lib/sales.js. platformsUsingPlatformPrice
// IS that Platform Pricing subset already (see functions/api/lookups.js).
function salePlatformOptionsHtml(current) {
  let html = '<option value="">-- Select platform --</option>';
  const selectable = _salesLookups.platformsUsingPlatformPrice;
  selectable.forEach((p) => {
    html += "<option" + (p === current ? " selected" : "") + ">" + p + "</option>";
  });
  // Defensive: if an existing batch's platform got moved to Base Pricing
  // after the fact, still show it (flagged) instead of silently blanking
  // the field out on edit.
  if (current && selectable.indexOf(current) === -1) {
    html += '<option value="' + current + '" selected>' + current + " (no longer manually selectable)</option>";
  }
  return html;
}

function salesProductOptions() {
  // Product uses "Active"/"Inactive" (not "Available"/"Unavailable" like
  // every other item_type) - an Inactive product was still showing up here
  // since this filter never checked status at all.
  return _salesLookups.skus.filter((s) => s.item_type === "Product" && s.status !== "Inactive");
}

// Self-contained (loads its own lookups) rather than assuming
// renderSalesPage already ran - callable from anywhere, e.g. Dashboard's
// "+ Input Sales" shortcut, which may open this before the Sales page
// itself has ever been visited this session.
async function openSalesEntryModal() {
  await ensureSalesLookups();
  openModal(
    "<h2>Input Sales</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="saleToday" onchange="setSaleToday()">' +
      '<label for="saleToday">Today</label>' +
      '<input type="date" id="saleDate">' +
    "</div><br>" +

    "<label>Channel</label><br>" +
    '<select id="salePlatform" onchange="onSalePlatformChange()">' + salePlatformOptionsHtml("") + "</select>" +
    '<p style="font-size:12px; color:var(--color-text-muted);">Platforms themselves are managed on the Settings page.</p><br>' +

    '<table style="table-layout:fixed; width:auto; margin-bottom:8px;">' +
      '<colgroup><col style="width:200px;"><col style="width:90px;"><col style="width:130px;"><col style="width:130px;"><col style="width:74px;"></colgroup>' +
      "<thead><tr><th>Item</th><th>Qty</th><th>Selling Price</th><th>Total</th><th></th></tr></thead>" +
      '<tbody id="saleItemRows"></tbody>' +
      '<tfoot><tr><td colspan="5"><button type="button" onclick="addSaleItemRow()">+ Add Item</button></td></tr></tfoot>' +
    "</table><br>" +

    '<div id="saleFeeSection" style="display:none;">' +
      '<div style="display:flex; gap:20px;">' +
        '<div><label>Platform Fee</label><br><input type="text" id="salePlatformFee" inputmode="numeric" oninput="formatAmount(this); updateSaleRevenueSummary()"></div>' +
        '<div><label>Marketing Fee</label><br><input type="text" id="saleMarketingFee" inputmode="numeric" oninput="formatAmount(this); updateSaleRevenueSummary()"></div>' +
      "</div><br><br>" +
    "</div>" +

    '<div style="display:flex; gap:16px; padding:8px 12px; border:1px solid var(--color-border-on-card); max-width:fit-content;">' +
      '<div><label>Gross Revenue</label><br><strong id="saleGrossRevenue" class="font-number" style="font-size:12px;">Rp 0</strong></div>' +
      '<div><label>Net Revenue</label><br><strong id="saleNetRevenue" class="font-number" style="font-size:12px;">Rp 0</strong></div>' +
    "</div>" +
    '<p style="font-size:12px; color:var(--color-text-muted); max-width:480px;">Net Revenue = Gross Revenue - (Platform Fee + Marketing Fee). It\'s not Net Profit yet — Food/Packaging Cost and other Operational Expenses aren\'t subtracted here (look up to Profit and Loss for that).</p><br>' +

    "<label>Notes</label><br>" +
    '<input type="text" id="saleNotes"><br><br>' +

    '<button id="saveSaleBtn" class="btn-primary" onclick="saveSalesBatch()">Save</button>' +
    '<span id="saveSaleStatus" class="save-status"></span>'
  );

  document.getElementById("saleItemRows").innerHTML = "";
  addSaleItemRow();
}

function setSaleToday() {
  const today = document.getElementById("saleToday");
  const date = document.getElementById("saleDate");
  if (today.checked) {
    date.value = todayISO();
    date.disabled = true;
  } else {
    date.value = "";
    date.disabled = false;
  }
}

// Table row, not the shared flex ".item-row" (would break a <tr>'s column
// layout, same reasoning as addBatchEditItemRow below) - fixed-width
// columns via buildSalesEntryFormHtml's colgroup instead of each combo
// setting its own inline min-width, so the Product column no longer
// resizes per-row based on the selected name's length.
function addSaleItemRow() {
  const wrap = document.getElementById("saleItemRows");
  const row = document.createElement("tr");
  row.className = "sale-item-row";
  row.innerHTML =
    '<td><div class="saleProductCombo"></div></td>' +
    '<td><input type="number" class="qty" min="1" style="width:100%; box-sizing:border-box;" oninput="updateSaleRowTotal(this.closest(\'.sale-item-row\'))"></td>' +
    '<td><input type="text" class="sellingPrice" inputmode="numeric" style="width:100%; box-sizing:border-box;" oninput="formatAmount(this); updateSaleRowTotal(this.closest(\'.sale-item-row\'))"></td>' +
    '<td><input type="text" class="total" readonly style="width:100%; box-sizing:border-box; background:var(--color-disabled-bg);"></td>' +
    '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeSaleItemRow(this)">Remove</button></td>';
  wrap.appendChild(row);

  const options = salesProductOptions();
  row._combo = createCombobox(
    row.querySelector(".saleProductCombo"),
    options.map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select item...",
      onSelect: function (skuId) { onSaleRowProductChange(row, skuId); }
    }
  );
}

function removeSaleItemRow(btn) {
  const rows = document.querySelectorAll("#saleItemRows .sale-item-row");
  if (rows.length <= 1) return;
  btn.closest(".sale-item-row").remove();
  updateSaleRevenueSummary();
}

// Selling Price auto-fills from the product's Platform Selling Price (if
// this platform is in "Platforms Using Platform Price") or Base Selling
// Price otherwise - still freely editable after. Ported from the old app's
// usesPlatformSellingPrice()/onProductChange(). Changing Platform re-checks
// every already-filled row, same as the old app's onPlatformChange().
function onSaleRowProductChange(row, skuId) {
  const product = _salesLookups.skus.find((s) => s.id === skuId);

  const platform = document.getElementById("salePlatform").value;
  const usesPlatformPrice = _salesLookups.platformsUsingPlatformPrice.indexOf(platform) !== -1;
  const price = product ? (usesPlatformPrice ? Number(product.platform_selling_price) || 0 : Number(product.selling_price) || 0) : 0;

  row.querySelector(".sellingPrice").value = price ? formatRupiah(price) : "";
  updateSaleRowTotal(row);
}

function onSalePlatformChange() {
  document.querySelectorAll("#saleItemRows .sale-item-row").forEach((row) => {
    const skuId = row._combo ? row._combo.getValue() : "";
    if (skuId) onSaleRowProductChange(row, skuId);
  });

  updateSaleFeeSectionVisibility();
}

// Platform Fee/Marketing Fee only apply to channels an actual delivery
// platform charges a cut on (GrabFood/GoFood) - Dine In (and Online, though
// that's never a manual choice here) doesn't have either, so the fields
// are hidden rather than left sitting there implying they're relevant.
function updateSaleFeeSectionVisibility() {
  const platform = document.getElementById("salePlatform").value;
  const section = document.getElementById("saleFeeSection");
  const show = platform && platform !== "Dine In";
  section.style.display = show ? "" : "none";

  if (!show) {
    document.getElementById("salePlatformFee").value = "";
    document.getElementById("saleMarketingFee").value = "";
    updateSaleRevenueSummary();
  }
}

function updateSaleRowTotal(row) {
  const qty = Number(row.querySelector(".qty").value) || 0;
  const price = parseAmount(row.querySelector(".sellingPrice").value);
  const total = qty * price;
  row.querySelector(".total").value = total ? formatRupiah(total) : "";
  updateSaleRevenueSummary();
}

function updateSaleRevenueSummary() {
  let gross = 0;
  document.querySelectorAll("#saleItemRows .sale-item-row").forEach((row) => {
    const qty = Number(row.querySelector(".qty").value) || 0;
    const price = parseAmount(row.querySelector(".sellingPrice").value);
    gross += qty * price;
  });

  const platformFee = parseAmount(document.getElementById("salePlatformFee").value);
  const marketingFee = parseAmount(document.getElementById("saleMarketingFee").value);
  const net = gross - platformFee - marketingFee;

  document.getElementById("saleGrossRevenue").textContent = formatRupiah(gross);
  document.getElementById("saleNetRevenue").textContent = formatRupiah(net);
}

function collectSaleItems() {
  const items = [];
  document.querySelectorAll("#saleItemRows .sale-item-row").forEach((row) => {
    const skuId = row._combo ? row._combo.getValue() : "";
    const qty = Number(row.querySelector(".qty").value) || 0;
    const sellingPrice = parseAmount(row.querySelector(".sellingPrice").value);
    if (skuId && qty > 0 && sellingPrice > 0) items.push({ skuId: skuId, qty: qty, sellingPrice: sellingPrice });
  });
  return items;
}

function saveSalesBatch() {
  const date = document.getElementById("saleDate").value;
  const platform = document.getElementById("salePlatform").value;
  const items = collectSaleItems();
  const platformFee = parseAmount(document.getElementById("salePlatformFee").value);
  const marketingFee = parseAmount(document.getElementById("saleMarketingFee").value);
  const notes = document.getElementById("saleNotes").value || null;

  if (!date) { alert("Please select a date."); return; }
  if (!platform) { alert("Please select a platform."); return; }
  if (!items.length) { alert("Please add at least one product (with qty and selling price)."); return; }

  const body = { date: date, platform: platform, items: items, platformFee: platformFee, marketingFee: marketingFee, notes: notes };
  const btn = document.getElementById("saveSaleBtn");
  const statusEl = document.getElementById("saveSaleStatus");

  withSaveStatus(btn, statusEl, "Sales", async function () {
    await api("sales", { method: "POST", body: body });
    closeModal();
    await loadSalesData();
  });
}

// ---------- Edit batch (single entry point: Date/Platform/fees/Notes +
// every product line, editable/removable/addable, + Delete Batch) ----------

function openSalesBatchModal(batchCode) {
  const lines = _lastSalesRows.filter((r) => r.refId === batchCode && r.source === "manual");
  if (!lines.length) return;
  const first = lines[0];

  openModal(
    "<h2>Edit Batch - " + batchCode + "</h2>" +
    "<label>Date</label><br>" +
    '<input type="date" id="batchEditDate" value="' + first.date + '"><br>' +

    "<label>Channel</label><br>" +
    '<select id="batchEditPlatform" onchange="onBatchEditPlatformChange()">' + salePlatformOptionsHtml(first.platform) + "</select><br><br>" +

    '<div id="batchEditFeeSection">' +
      '<div style="display:flex; gap:16px;">' +
        '<div><label>Platform Fee</label><br><input type="text" id="batchEditPlatformFee" inputmode="numeric" value="' + (first.platformFee ? formatRupiah(first.platformFee) : "") + '" oninput="formatAmount(this); updateBatchEditRevenueSummary()"></div>' +
        '<div><label>Marketing Fee</label><br><input type="text" id="batchEditMarketingFee" inputmode="numeric" value="' + (first.marketingFee ? formatRupiah(first.marketingFee) : "") + '" oninput="formatAmount(this); updateBatchEditRevenueSummary()"></div>' +
      "</div><br>" +
    "</div>" +

    '<table style="table-layout:fixed; width:auto; margin-bottom:8px;">' +
      '<colgroup><col style="width:200px;"><col style="width:90px;"><col style="width:130px;"><col style="width:130px;"><col style="width:74px;"></colgroup>' +
      "<thead><tr><th>Item</th><th>Qty</th><th>Selling Price</th><th>Total</th><th></th></tr></thead>" +
      '<tbody id="batchEditItemRows"></tbody>' +
      '<tfoot><tr><td colspan="5"><button type="button" onclick="addBatchEditItemRow()">+ Add Item</button></td></tr></tfoot>' +
    "</table><br>" +

    '<div style="display:flex; gap:16px; padding:8px 12px; border:1px solid var(--color-border-on-card); max-width:fit-content;">' +
      '<div><label>Gross Revenue</label><br><strong id="batchEditGrossRevenue" class="font-number" style="font-size:12px;">Rp 0</strong></div>' +
      '<div><label>Net Revenue</label><br><strong id="batchEditNetRevenue" class="font-number" style="font-size:12px;">Rp 0</strong></div>' +
    "</div><br>" +

    "<label>Notes</label><br>" +
    '<input type="text" id="batchEditNotes" value="' + (first.notes || "") + '"><br><br>' +

    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<div>" +
        '<button id="saveBatchEditBtn" class="btn-primary" onclick="saveSalesBatchEdit(\'' + batchCode + '\')">Save</button> ' +
        '<span id="saveBatchEditStatus" class="save-status"></span>' +
      "</div>" +
      '<div id="batchDeleteWrap">' + batchDeleteTriggerHtml(batchCode) + "</div>" +
    "</div>"
  );
  document.getElementById("batchEditItemRows").innerHTML = "";
  lines.forEach((r) => addBatchEditItemRow(r));
  onBatchEditPlatformChange();
}

function addBatchEditItemRow(existingRow) {
  const wrap = document.getElementById("batchEditItemRows");
  const row = document.createElement("tr");
  // NOT "item-row" - that class carries display:flex (shared.css, for the
  // div-based rows on other forms), which would break a <tr>'s table layout
  // and make its cells wrap like flex items instead of staying in columns.
  row.className = "batch-edit-row";
  if (existingRow) row.dataset.salesCode = existingRow.salesCode;
  row.innerHTML =
    '<td><div class="batchEditProductCombo"></div></td>' +
    '<td><input type="number" class="qty" min="1" value="' + (existingRow ? existingRow.qty : "") + '" style="width:100%; box-sizing:border-box;" oninput="updateBatchEditRowTotal(this.closest(\'.batch-edit-row\'))"></td>' +
    '<td><input type="text" class="sellingPrice" inputmode="numeric" value="' + (existingRow ? formatRupiah(existingRow.sellingPrice) : "") + '" style="width:100%; box-sizing:border-box;" oninput="formatAmount(this); updateBatchEditRowTotal(this.closest(\'.batch-edit-row\'))"></td>' +
    '<td><input type="text" class="total" readonly style="width:100%; box-sizing:border-box; background:var(--color-disabled-bg);"></td>' +
    '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeBatchEditItemRow(this)">Remove</button></td>';
  wrap.appendChild(row);

  const options = salesProductOptions();
  row._combo = createCombobox(
    row.querySelector(".batchEditProductCombo"),
    options.map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select item...",
      onSelect: function (skuId) { onBatchEditRowProductChange(row, skuId); }
    }
  );

  if (existingRow) {
    const product = options.find((s) => s.sku === existingRow.sku);
    if (product) row._combo.setSelection(product.id, product.name);
  }

  updateBatchEditRowTotal(row);
}

function removeBatchEditItemRow(btn) {
  const rows = document.querySelectorAll("#batchEditItemRows .batch-edit-row");
  if (rows.length <= 1) { alert("A batch must have at least one product. Use \"Delete Batch\" to remove it entirely."); return; }
  btn.closest(".batch-edit-row").remove();
  updateBatchEditRevenueSummary();
}

// Only a NEWLY added row autofills its price on product selection - an
// existing line's historical selling price is left alone unless the user
// edits it directly, same reasoning as sales/[code].js's PATCH (a line's own
// price is independent of the batch's Platform/Channel).
function onBatchEditRowProductChange(row, skuId) {
  if (row.dataset.salesCode) { updateBatchEditRowTotal(row); return; }

  const product = _salesLookups.skus.find((s) => s.id === skuId);
  const platform = document.getElementById("batchEditPlatform").value;
  const usesPlatformPrice = _salesLookups.platformsUsingPlatformPrice.indexOf(platform) !== -1;
  const price = product ? (usesPlatformPrice ? Number(product.platform_selling_price) || 0 : Number(product.selling_price) || 0) : 0;

  row.querySelector(".sellingPrice").value = price ? formatRupiah(price) : "";
  updateBatchEditRowTotal(row);
}

function onBatchEditPlatformChange() {
  const platform = document.getElementById("batchEditPlatform").value;
  const section = document.getElementById("batchEditFeeSection");
  const show = platform && platform !== "Dine In";
  section.style.display = show ? "" : "none";

  if (!show) {
    document.getElementById("batchEditPlatformFee").value = "";
    document.getElementById("batchEditMarketingFee").value = "";
  }
  updateBatchEditRevenueSummary();
}

function updateBatchEditRowTotal(row) {
  const qty = Number(row.querySelector(".qty").value) || 0;
  const price = parseAmount(row.querySelector(".sellingPrice").value);
  const total = qty * price;
  row.querySelector(".total").value = total ? formatRupiah(total) : "";
  updateBatchEditRevenueSummary();
}

function updateBatchEditRevenueSummary() {
  let gross = 0;
  document.querySelectorAll("#batchEditItemRows .batch-edit-row").forEach((row) => {
    const qty = Number(row.querySelector(".qty").value) || 0;
    const price = parseAmount(row.querySelector(".sellingPrice").value);
    gross += qty * price;
  });

  const platformFee = parseAmount(document.getElementById("batchEditPlatformFee").value);
  const marketingFee = parseAmount(document.getElementById("batchEditMarketingFee").value);
  const net = gross - platformFee - marketingFee;

  document.getElementById("batchEditGrossRevenue").textContent = formatRupiah(gross);
  document.getElementById("batchEditNetRevenue").textContent = formatRupiah(net);
}

// Save orchestrates three calls against the existing per-line/per-batch
// endpoints rather than one new bulk endpoint: PATCH the batch (Date/
// Platform/fees/Notes, cascades onto every line), DELETE lines the user
// removed, PATCH lines that already existed, POST any brand-new lines
// (sales.js's POST doubles as "add to batch" when batchCode is set).
async function saveSalesBatchEdit(batchCode) {
  const date = document.getElementById("batchEditDate").value;
  const platform = document.getElementById("batchEditPlatform").value;
  const platformFee = parseAmount(document.getElementById("batchEditPlatformFee").value);
  const marketingFee = parseAmount(document.getElementById("batchEditMarketingFee").value);
  const notes = document.getElementById("batchEditNotes").value || null;

  if (!date) { alert("Please select a date."); return; }
  if (!platform) { alert("Please select a platform."); return; }

  const rows = Array.from(document.querySelectorAll("#batchEditItemRows .batch-edit-row"));
  const existingItems = [];
  const newItems = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const skuId = row._combo ? row._combo.getValue() : "";
    const qty = Number(row.querySelector(".qty").value) || 0;
    const sellingPrice = parseAmount(row.querySelector(".sellingPrice").value);
    if (!skuId || qty <= 0 || sellingPrice <= 0) { alert("Please fill in product, qty, and selling price for every row."); return; }
    if (row.dataset.salesCode) existingItems.push({ salesCode: row.dataset.salesCode, skuId: skuId, qty: qty, sellingPrice: sellingPrice });
    else newItems.push({ skuId: skuId, qty: qty, sellingPrice: sellingPrice });
  }

  const originalCodes = _lastSalesRows.filter((r) => r.refId === batchCode && r.source === "manual").map((r) => r.salesCode);
  const keptCodes = existingItems.map((it) => it.salesCode);
  const removedCodes = originalCodes.filter((c) => keptCodes.indexOf(c) === -1);

  const btn = document.getElementById("saveBatchEditBtn");
  const statusEl = document.getElementById("saveBatchEditStatus");

  withSaveStatus(btn, statusEl, "Batch", async function () {
    await api("sales-batches/" + encodeURIComponent(batchCode), {
      method: "PATCH",
      body: { date: date, platform: platform, platformFee: platformFee, marketingFee: marketingFee, notes: notes }
    });

    for (let i = 0; i < removedCodes.length; i++) {
      await api("sales/" + encodeURIComponent(removedCodes[i]), { method: "DELETE" });
    }
    for (let i = 0; i < existingItems.length; i++) {
      const it = existingItems[i];
      await api("sales/" + encodeURIComponent(it.salesCode), { method: "PATCH", body: { skuId: it.skuId, qty: it.qty, sellingPrice: it.sellingPrice } });
    }
    if (newItems.length) {
      await api("sales", { method: "POST", body: { batchCode: batchCode, date: date, platform: platform, items: newItems } });
    }

    closeModal();
    await loadSalesData();
  });
}

// Inline confirm toggle, not openConfirmModal - this button lives inside
// the already-open Edit Sales Batch modal, and openModal() always closes
// whatever modal is currently open before showing a new one (only one at a
// time), so stacking a confirm modal on top would silently discard the
// edit modal under it even on Cancel. Expanding in place instead (same
// view/edit-toggle idiom as editMinStock/scaledQtyViewHtml elsewhere)
// keeps the edit modal intact regardless of what's chosen here.
function batchDeleteTriggerHtml(batchCode) {
  return '<button type="button" style="color:#b00020;" onclick="confirmDeleteSalesBatchInline(\'' + batchCode + '\')">Delete Batch</button>';
}

function confirmDeleteSalesBatchInline(batchCode) {
  const wrap = document.getElementById("batchDeleteWrap");
  wrap.innerHTML =
    '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;">' +
      '<span style="color:#b00020; font-size:12.5px; max-width:260px; text-align:right;">Delete this batch? Every product line, their stock consumption, and the linked Platform/Marketing Fee expenses will all be removed.</span>' +
      '<button type="button" class="deleteBatchConfirmBtn" style="color:#b00020;" onclick="deleteSalesBatchFromModal(\'' + batchCode + '\', this)">Yes, Delete</button>' +
      '<button type="button" onclick="cancelDeleteSalesBatchInline(\'' + batchCode + '\')">Cancel</button>' +
    "</div>" +
    '<span class="save-status" style="display:block; text-align:right; margin-top:6px;"></span>';
}

function cancelDeleteSalesBatchInline(batchCode) {
  document.getElementById("batchDeleteWrap").innerHTML = batchDeleteTriggerHtml(batchCode);
}

function deleteSalesBatchFromModal(batchCode, btn) {
  const statusEl = document.getElementById("batchDeleteWrap").querySelector(".save-status");
  withSaveStatus(btn, statusEl, "Batch", async function () {
    await api("sales-batches/" + encodeURIComponent(batchCode), { method: "DELETE" });
    closeModal();
    await loadSalesData();
  });
}
