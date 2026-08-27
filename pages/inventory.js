// Inventory nav is split into two pages - "Stock" (Overview/Purchase Log/
// Opname/Consumption Log - what's physically on hand and moving) and "Cost"
// (Current Cost/Cost Update Log - what it's valued at) - each with its own
// tab shell, ported from the old app's Inventory_Nav.html grouping (which
// had all six as one flat nav instead).
registerPage("inventory-stock", renderInventoryStockPage);
registerPage("inventory-cost", renderInventoryCostPage);

const STOCKABLE_TYPES = ["Ingredient", "Packaging", "Operating", "Semi-Finished", "Component"];

let _invLookups = null;

async function ensureInvLookups() {
  if (!_invLookups) _invLookups = await api("lookups");
  return _invLookups;
}

// Excludes Unavailable SKUs too (per explicit request) - this feeds the
// Purchase Log's Item picker, and buying more of something marked
// Unavailable wouldn't make sense.
function stockableSkus() {
  return _invLookups.skus.filter((s) => STOCKABLE_TYPES.indexOf(s.item_type) !== -1 && s.status !== "Unavailable");
}

// ---------- Stock page (Overview / Purchase Log / Opname / Consumption Log) ----------

let _activeInvStockTab = "overview";

// ?tab=overview&filter=low deep-links straight to Stock Overview
// pre-filtered to Habis/Mepet (e.g. Dashboard's Stock Alert tile) - same
// "?tab=" convention as pages/sales.js/database.js. filter=low sets
// _overviewStatusFilter (see below) before that tab renders.
async function renderInventoryStockPage(content) {
  content.innerHTML = "<h2>Inventory Stock</h2>" + buildInventoryStockTabsHtml();
  await ensureInvLookups();

  const query = location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const tabParam = params.get("tab");
  _activeInvStockTab = INV_STOCK_TABS.indexOf(tabParam) !== -1 ? tabParam : "overview";
  _overviewStatusFilter = params.get("filter") === "low" ? ["Habis", "Mepet"] : [];

  await switchInventoryStockTab(_activeInvStockTab, true);
}

function buildInventoryStockTabsHtml() {
  return (
    '<div class="tabs">' +
      '<button id="invStockTab-overview" class="tab-active" onclick="switchInventoryStockTab(\'overview\')">Stock Overview</button>' +
      '<button id="invStockTab-purchases" onclick="switchInventoryStockTab(\'purchases\')">Purchase Log</button>' +
      '<button id="invStockTab-opname" onclick="switchInventoryStockTab(\'opname\')">Stock Opname</button>' +
      '<button id="invStockTab-consumption" onclick="switchInventoryStockTab(\'consumption\')">Consumption Log</button>' +
    "</div>" +
    '<div id="inventoryStockTabContent"><p>Loading...</p></div>'
  );
}

const INV_STOCK_TABS = ["overview", "purchases", "opname", "consumption"];
const INV_STOCK_TAB_RENDERERS = {
  overview: renderOverviewTab,
  purchases: renderPurchasesTab,
  opname: renderOpnameTab,
  consumption: renderConsumptionLogTab
};

async function switchInventoryStockTab(tab, force) {
  if (tab === _activeInvStockTab && !force) return;
  _activeInvStockTab = tab;

  INV_STOCK_TABS.forEach((t) => document.getElementById("invStockTab-" + t).classList.toggle("tab-active", t === tab));

  const wrap = document.getElementById("inventoryStockTabContent");
  wrap.innerHTML = "<p>Loading...</p>";
  try {
    await INV_STOCK_TAB_RENDERERS[tab](wrap);
  } catch (err) {
    wrap.innerHTML = '<p style="color:#d32f2f">Error loading tab: ' + (err.message || err) + "</p>";
  }
}

// ---------- Cost page (Current Cost / Cost Update Log) ----------

let _activeInvCostTab = "current";

async function renderInventoryCostPage(content) {
  content.innerHTML = "<h2>Inventory Cost</h2>" + buildInventoryCostTabsHtml();
  await switchInventoryCostTab(_activeInvCostTab, true);
}

function buildInventoryCostTabsHtml() {
  return (
    '<div class="tabs">' +
      '<button id="invCostTab-current" class="tab-active" onclick="switchInventoryCostTab(\'current\')">Current Cost</button>' +
      '<button id="invCostTab-log" onclick="switchInventoryCostTab(\'log\')">Cost Update Log</button>' +
    "</div>" +
    '<div id="inventoryCostTabContent"><p>Loading...</p></div>'
  );
}

const INV_COST_TABS = ["current", "log"];
const INV_COST_TAB_RENDERERS = {
  current: renderCurrentCostTab,
  log: renderCostUpdateLogTab
};

async function switchInventoryCostTab(tab, force) {
  if (tab === _activeInvCostTab && !force) return;
  _activeInvCostTab = tab;

  INV_COST_TABS.forEach((t) => document.getElementById("invCostTab-" + t).classList.toggle("tab-active", t === tab));

  const wrap = document.getElementById("inventoryCostTabContent");
  wrap.innerHTML = "<p>Loading...</p>";
  try {
    await INV_COST_TAB_RENDERERS[tab](wrap);
  } catch (err) {
    wrap.innerHTML = '<p style="color:#d32f2f">Error loading tab: ' + (err.message || err) + "</p>";
  }
}

// ================================================================
// Stock Overview - ported from 04 Inventory/StockOverviewTable.html
// ================================================================

const OVERVIEW_ITEM_TYPES = ["Ingredient", "Semi-Finished", "Component", "Packaging", "Operating", "Other"];

let _overviewRows = [];
let _overviewTypeFilter = []; // empty = show every Item Type (default)
let _overviewStatusFilter = []; // empty = show every Status - set to ["Habis","Mepet"] via ?filter=low deep-link (see renderInventoryStockPage)

async function renderOverviewTab(wrap) {
  const lowStockBanner = _overviewStatusFilter.length
    ? '<p style="background:#fff3e0; padding:8px 12px; margin:0 0 8px;">Showing Low Stock only (from Dashboard). ' +
        '<a href="#" onclick="clearOverviewStatusFilter(); return false;">Clear</a></p>'
    : "";

  wrap.innerHTML =
    lowStockBanner +
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Stock Overview</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="overviewFilterBadge" style="color:#666; font-size:12px;">All</span>' +
        '<button onclick="openOverviewFilterModal()">Set Filter</button>' +
      "</div>" +
    "</div>" +
    '<div id="stockOverviewPaginationNav" class="pagination-nav"></div>' +
    "<style>#stockOverviewTable th, #stockOverviewTable td { padding-top: 2px; padding-bottom: 2px; }</style>" +
    '<div id="stockOverviewScrollWrap" style="overflow-x:auto;">' +
      '<table id="stockOverviewTable">' +
        "<thead><tr><th>Type</th><th>Category</th><th>Item</th><th>Unit</th>" +
        "<th>Current Stock</th><th>Min Stock</th><th>Status</th><th>Last Opname</th></tr></thead>" +
        '<tbody id="stockOverviewTbody"><tr><td colspan="8">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";
  enableDragScroll(document.getElementById("stockOverviewScrollWrap"));
  await loadStockOverview();
}

async function loadStockOverview() {
  _overviewRows = await api("inventory/overview");
  renderStockOverviewTable();
}

// Filters the already-fetched rows client-side (no re-fetch) - used both
// after a fresh load and after Apply Filter, so switching filters is
// instant. Keeps _overviewTypeFilter (module state) as the source of truth
// for what's currently applied, restored into the modal's checkboxes next
// time it opens.
function renderStockOverviewTable() {
  const tbody = document.getElementById("stockOverviewTbody");
  if (!tbody) return; // tab may have been switched away while this was loading

  const rows = _overviewRows.filter((r) =>
    (!_overviewTypeFilter.length || _overviewTypeFilter.indexOf(r.itemType) !== -1) &&
    (!_overviewStatusFilter.length || _overviewStatusFilter.indexOf(r.status) !== -1)
  );

  tbody.innerHTML = rows.length ? rows.map(overviewRowHtml).join("") : '<tr><td colspan="8">No items match this filter.</td></tr>';
  paginateTable("stockOverviewTbody", "stockOverviewPaginationNav", 20);

  const badge = document.getElementById("overviewFilterBadge");
  if (badge) badge.textContent = _overviewTypeFilter.length ? _overviewTypeFilter.join(", ") : "All";
}

function clearOverviewStatusFilter() {
  _overviewStatusFilter = [];
  renderOverviewTab(document.getElementById("inventoryStockTabContent"));
}

function openOverviewFilterModal() {
  const checkboxes = OVERVIEW_ITEM_TYPES.map((t) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="overviewTypeCheck" value="' + t + '"' + (_overviewTypeFilter.indexOf(t) !== -1 ? " checked" : "") + "> " + t +
    "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Item Type</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyOverviewFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyOverviewFilter() {
  _overviewTypeFilter = Array.from(document.querySelectorAll(".overviewTypeCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderStockOverviewTable();
}

function overviewRowHtml(r) {
  const minStockDisplay = r.minStock === null ? "" : r.minStock;
  return (
    "<tr>" +
      "<td>" + r.itemType + "</td>" +
      "<td>" + (r.category || "") + "</td>" +
      "<td>" + r.name + '<br><span style="color:#666; font-size:12px;">' + r.sku + "</span></td>" +
      "<td>" + r.unit + "</td>" +
      "<td>" + r.currentStock + "</td>" +
      '<td class="minStock" data-sku="' + r.sku + '" data-raw="' + minStockDisplay + '">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">' +
          '<span class="minStockDisplay">' + minStockDisplay + "</span>" +
          '<button onclick="editMinStock(this)">Edit</button>' +
        "</div>" +
      "</td>" +
      '<td class="status-' + r.status + '">' + r.status + "</td>" +
      "<td>" + (r.lastOpnameDate || "") + "</td>" +
    "</tr>"
  );
}

function editMinStock(btn) {
  const cell = btn.closest(".minStock");
  const raw = Number(cell.dataset.raw) || 0;

  cell.innerHTML =
    '<input type="number" class="min-stock-input" min="0" value="' + raw + '" style="width:80px;"> ' +
    '<button onclick="saveMinStock(this)">Save</button> ' +
    '<button onclick="loadStockOverview()">Cancel</button>';
}

function saveMinStock(btn) {
  const cell = btn.closest(".minStock");
  const sku = cell.dataset.sku;
  const minStock = cell.querySelector("input").value;

  if (minStock === "" || Number(minStock) < 0) {
    alert("Please enter a valid min stock.");
    return;
  }

  withInlineSaveStatus(btn, "Min Stock", async function () {
    await api("inventory/overview", { method: "PATCH", body: { sku: sku, minStock: Number(minStock) } });
    await loadStockOverview();
  });
}

// ================================================================
// Purchase Log - ported from 04 Inventory/StockInEntry.html +
// StockInEntry_JS.html (form) and StockInTable.html (grouped log table).
// No per-row Edit/Delete here on purpose - see functions/api/purchases.js's
// file comment (create-only, same reasoning as Cashflow's append-only
// ledger - cost/stock numbers derived from a purchase at insert time aren't
// safe to silently recompute after the fact).
// ================================================================

let _supplierCombo = null;
let _purchasePaginationTargetSize = 20;
let _lastPurchaseRows = [];
let _purchaseCategoryFilter = []; // empty = show every Category (default)
let _purchaseStatusFilter = []; // empty = show every Status (default)
let _purchaseSort = "date-desc";

const PURCHASE_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function renderPurchasesTab(wrap) {
  wrap.innerHTML = buildPurchaseTableShellHtml();
  await loadPurchaseTable();
}

async function openPurchaseModal() {
  await ensureInvLookups(); // may have been nulled by a prior new-supplier save, to force a refetch
  openModal(buildPurchaseFormHtml());
  initPurchaseForm();
}

function buildPurchaseFormHtml() {
  return (
    "<h2>Input Purchase</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="purchaseToday" onchange="setPurchaseToday()">' +
      '<label for="purchaseToday">Today</label>' +
      '<input type="date" id="purchaseDate">' +
    "</div><br><br>" +

    "<label>Supplier</label><br>" +
    '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
      '<div id="purchaseSupplierCombo" style="min-width:220px;"></div>' +
      '<label style="display:flex; align-items:center; gap:4px; font-weight:normal;">' +
        '<input type="checkbox" id="newSupplierToggle" onchange="toggleNewSupplier()">' +
        "New Supplier" +
      "</label>" +
      '<input type="text" id="newSupplierName" placeholder="New supplier name" style="display:none;">' +
    "</div><br><br>" +

    "<label>Items</label>" +
    '<div id="purchaseItemRows"></div>' +
    '<button type="button" onclick="addPurchaseItemRow()">+ Add Item</button>' +
    '<div style="margin-top:8px; font-weight:bold;">Total Cost: <span id="purchaseGrandTotal">Rp 0</span></div><br><br>' +

    '<div style="display:flex; gap:20px;">' +
      "<div>" +
        "<label>Status</label><br>" +
        '<select id="purchaseStatus"><option>Paid</option><option>Unpaid</option><option>Pending</option></select>' +
      "</div>" +
      "<div>" +
        "<label>Method</label><br>" +
        '<select id="purchaseMethod"></select>' +
      "</div>" +
    "</div><br><br>" +

    "<label>Notes</label><br>" +
    '<input type="text" id="purchaseNotes"><br><br>' +

    '<button id="savePurchaseBtn" onclick="savePurchase()">Save</button>' +
    '<span id="savePurchaseStatus" class="save-status"></span>'
  );
}

function initPurchaseForm() {
  document.getElementById("purchaseDate").value = todayISO();

  const methodSelect = document.getElementById("purchaseMethod");
  methodSelect.innerHTML = _invLookups.paymentMethods.map((m) => "<option>" + m + "</option>").join("");

  _supplierCombo = createCombobox(
    document.getElementById("purchaseSupplierCombo"),
    _invLookups.suppliers.map((s) => ({ value: s.id, label: s.name })),
    { placeholder: "Select supplier...", allowFreeText: false }
  );

  document.getElementById("purchaseItemRows").innerHTML = "";
  addPurchaseItemRow();
}

function setPurchaseToday() {
  if (document.getElementById("purchaseToday").checked) document.getElementById("purchaseDate").value = todayISO();
}

function toggleNewSupplier() {
  const isNew = document.getElementById("newSupplierToggle").checked;
  const combo = document.getElementById("purchaseSupplierCombo");
  combo.style.pointerEvents = isNew ? "none" : "";
  combo.style.opacity = isNew ? "0.5" : "";
  document.getElementById("newSupplierName").style.display = isNew ? "" : "none";
  if (isNew && _supplierCombo) _supplierCombo.clear();
  if (!isNew) document.getElementById("newSupplierName").value = "";
}

// Ported from StockInEntry_JS.html's addStockInRow() - Item -> Item Type
// (auto, read-only) -> Category (auto) -> Unit (auto) -> Qty -> Cost, in
// that field order, sized the same.
function addPurchaseItemRow() {
  const wrap = document.getElementById("purchaseItemRows");
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<div><label>Item</label><br><div class="sku-combo" style="min-width:220px;"></div></div>' +
    '<div><label>Item Type</label><br><input type="text" class="itemType" disabled style="background:#f5f5f5; width:100px;"></div>' +
    '<div><label>Category</label><br><input type="text" class="category" disabled style="background:#f5f5f5; width:100px;"></div>' +
    '<div><label>Unit</label><br><input type="text" class="unit" disabled style="background:#f5f5f5; width:55px;"></div>' +
    '<div><label>Qty</label><br><input type="number" class="qty" min="0" step="any"></div>' +
    '<div><label>Cost</label><br><input type="text" class="totalCost" inputmode="numeric" oninput="formatAmount(this); recalcPurchaseGrandTotal()"></div>' +
    '<div><label>Notes</label><br><input type="text" class="lineNotes" style="width:140px;"></div>' +
    '<button type="button" onclick="removePurchaseItemRow(this)">Remove</button>';
  wrap.appendChild(row);

  const combo = createCombobox(
    row.querySelector(".sku-combo"),
    stockableSkus().map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select item...",
      allowFreeText: false,
      onSelect: function (skuId) { onPurchaseItemChange(row, skuId); }
    }
  );
  row._combo = combo;
}

function onPurchaseItemChange(row, skuId) {
  const item = _invLookups.skus.find((s) => s.id === skuId);
  row.querySelector(".itemType").value = item ? item.item_type : "";
  row.querySelector(".category").value = item ? item.category || "" : "";
  row.querySelector(".unit").value = item ? item.unit : "";
}

function removePurchaseItemRow(btn) {
  const rows = document.querySelectorAll("#purchaseItemRows .item-row");
  if (rows.length <= 1) return;
  btn.closest(".item-row").remove();
  recalcPurchaseGrandTotal();
}

function recalcPurchaseGrandTotal() {
  let total = 0;
  document.querySelectorAll("#purchaseItemRows .totalCost").forEach((input) => { total += parseAmount(input.value); });
  document.getElementById("purchaseGrandTotal").textContent = formatRupiah(total);
}

function collectPurchaseItems() {
  const items = [];
  document.querySelectorAll("#purchaseItemRows .item-row").forEach((row) => {
    const skuId = row._combo.getValue();
    const item = _invLookups.skus.find((s) => s.id === skuId);
    const qty = row.querySelector(".qty").value;
    const totalCost = parseAmount(row.querySelector(".totalCost").value);
    if (!skuId && !qty && !totalCost) return; // skip a fully-empty row, like the old app
    items.push({
      skuId: skuId,
      category: item ? item.category || null : null,
      unit: item ? item.unit : "",
      qty: qty,
      totalCost: totalCost,
      notes: row.querySelector(".lineNotes").value.trim() || null
    });
  });
  return items;
}

async function savePurchase() {
  const items = collectPurchaseItems();

  if (!document.getElementById("purchaseDate").value) { alert("Please select a date."); return; }
  if (!items.length) { alert("Please add at least one item."); return; }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.skuId) { alert("Please select an item for row " + (i + 1) + "."); return; }
    if (!it.qty || Number(it.qty) <= 0) { alert("Please enter a valid qty for row " + (i + 1) + "."); return; }
    if (!it.totalCost || it.totalCost <= 0) { alert("Please enter a valid cost for row " + (i + 1) + "."); return; }
  }

  const isNewSupplier = document.getElementById("newSupplierToggle").checked;
  const supplierName = document.getElementById("newSupplierName").value.trim();
  if (isNewSupplier && !supplierName) { alert("Please enter the new supplier's name."); return; }
  if (!isNewSupplier && !_supplierCombo.getValue()) { alert("Please select a supplier."); return; }

  const btn = document.getElementById("savePurchaseBtn");
  const statusEl = document.getElementById("savePurchaseStatus");

  withSaveStatus(btn, statusEl, "Purchase", async function () {
    const payload = {
      date: document.getElementById("purchaseDate").value,
      isNewSupplier: isNewSupplier,
      supplierName: isNewSupplier ? supplierName : undefined,
      supplierId: isNewSupplier ? undefined : _supplierCombo.getValue(),
      status: document.getElementById("purchaseStatus").value,
      method: document.getElementById("purchaseMethod").value,
      notes: document.getElementById("purchaseNotes").value || null,
      items: items
    };

    const created = await api("purchases", { method: "POST", body: payload });
    if (isNewSupplier) _invLookups = null; // force a refetch so the new supplier shows up next time

    closeModal();
    await loadPurchaseTable();
    return created;
  });
}

// ---------- Purchase log table (grouped by Purchase ID, rowspan) ----------

function buildPurchaseTableShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
      "<h3>Purchase Log</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="purchaseFilterBadge" style="color:#666; font-size:12px;">All</span>' +
        '<button onclick="openPurchaseFilterModal()">Set Filter</button>' +
        '<span id="purchaseSortBadge" style="color:#666; font-size:12px;">Sort: ' + PURCHASE_SORT_LABELS[_purchaseSort] + "</span>" +
        '<button onclick="openPurchaseSortModal()">Sort</button>' +
        '<button onclick="openPurchaseModal()">+ Input Purchase</button>' +
      "</div>" +
    "</div>" +
    "<style>" +
      "#purchaseLogTable { table-layout: fixed; }" +
      "#purchaseLogTable th, #purchaseLogTable td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 2px; padding-bottom: 2px; }" +
      ".colId { width: 220px; } .colCategory { width: 100px; }" +
      ".colItemName { width: 260px; } .colQty { width: 55px; } .colUnit { width: 60px; }" +
      ".colTotalCost { width: 130px; } .colUnitCost { width: 110px; } .colStatus { width: 90px; }" +
      ".colNotes { width: 160px; }" +
    "</style>" +
    '<div id="purchasePaginationNav" class="pagination-nav"></div>' +
    '<div id="purchaseLogScrollWrap" style="overflow-x:auto;">' +
      '<table id="purchaseLogTable">' +
        "<colgroup>" +
          '<col class="colId"><col class="colCategory">' +
          '<col class="colItemName"><col class="colQty"><col class="colUnit">' +
          '<col class="colTotalCost"><col class="colUnitCost"><col class="colStatus">' +
          '<col class="colNotes">' +
        "</colgroup>" +
        "<thead><tr><th>Date</th><th>Category</th><th>Item Name</th>" +
        "<th>Qty</th><th>Unit</th><th>Total Cost</th><th>Unit Cost</th><th>Status</th><th>Notes</th></tr></thead>" +
        '<tbody id="purchaseLogTbody"><tr><td colspan="9">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadPurchaseTable() {
  _lastPurchaseRows = await api("purchases");
  if (!document.getElementById("purchaseLogTbody")) return;
  renderPurchaseLogRows();
}

// Regroups from scratch (purchaseCode-contiguous runs, first-seen order)
// instead of trusting the server's groupStart/groupSize - those only match
// the server's own fetch order, which filtering/sorting here changes.
function regroupPurchaseRows(rows) {
  const order = [];
  const byCode = new Map();
  rows.forEach((r) => {
    if (!byCode.has(r.purchaseCode)) { byCode.set(r.purchaseCode, []); order.push(r.purchaseCode); }
    byCode.get(r.purchaseCode).push(r);
  });
  return order.map((code) => byCode.get(code));
}

function flattenPurchaseGroups(groups) {
  const flat = [];
  groups.forEach((g) => g.forEach((r, i) => flat.push(Object.assign({}, r, { groupStart: i === 0, groupSize: g.length }))));
  return flat;
}

// Category is filtered at the LINE level (a multi-item purchase can have
// some lines match and some not - useful on its own, e.g. "every time we
// bought X" regardless of what else was in that purchase), Status at the
// group level (same value on every line of one purchase already). Sort
// always operates on whole groups (by that purchase's date).
function visiblePurchaseRows() {
  const filtered = _lastPurchaseRows.filter((r) =>
    (!_purchaseCategoryFilter.length || _purchaseCategoryFilter.indexOf(r.category || "") !== -1) &&
    (!_purchaseStatusFilter.length || _purchaseStatusFilter.indexOf(r.status) !== -1)
  );
  const groups = regroupPurchaseRows(filtered);
  groups.sort((a, b) => {
    if (a[0].date === b[0].date) return 0;
    const cmp = a[0].date < b[0].date ? -1 : 1;
    return _purchaseSort === "date-asc" ? cmp : -cmp;
  });
  return flattenPurchaseGroups(groups);
}

function renderPurchaseLogRows() {
  const tbody = document.getElementById("purchaseLogTbody");
  if (!tbody) return;

  const filterBadge = document.getElementById("purchaseFilterBadge");
  if (filterBadge) {
    const parts = [].concat(_purchaseCategoryFilter, _purchaseStatusFilter);
    filterBadge.textContent = parts.length ? parts.join(", ") : "All";
  }
  const sortBadge = document.getElementById("purchaseSortBadge");
  if (sortBadge) sortBadge.textContent = "Sort: " + PURCHASE_SORT_LABELS[_purchaseSort];

  const rows = visiblePurchaseRows();
  tbody.innerHTML = rows.length ? rows.map(purchaseRowHtml).join("") : '<tr><td colspan="9">No purchases match this filter.</td></tr>';
  paginateGroupedTable("purchaseLogTbody", "purchasePaginationNav", 20);
  enableDragScroll(document.getElementById("purchaseLogScrollWrap"));
}

function openPurchaseFilterModal() {
  const categories = [...new Set(_lastPurchaseRows.map((r) => r.category || "").filter(Boolean))].sort();
  const statuses = [...new Set(_lastPurchaseRows.map((r) => r.status).filter(Boolean))].sort();

  const categoryChecks = categories.map((c) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="purchaseCategoryFilterCheck" value="' + c + '"' + (_purchaseCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c + "</label>"
  ).join("");
  const statusChecks = statuses.map((s) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="purchaseStatusFilterCheck" value="' + s + '"' + (_purchaseStatusFilter.indexOf(s) !== -1 ? " checked" : "") + "> " + s + "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter</h2>" +
    "<label>Category</label>" +
    "<div>" + categoryChecks + "</div><br>" +
    "<label>Status</label>" +
    "<div>" + statusChecks + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyPurchaseFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyPurchaseFilter() {
  _purchaseCategoryFilter = Array.from(document.querySelectorAll(".purchaseCategoryFilterCheck:checked")).map((cb) => cb.value);
  _purchaseStatusFilter = Array.from(document.querySelectorAll(".purchaseStatusFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderPurchaseLogRows();
}

function openPurchaseSortModal() {
  const options = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  openModal(
    "<h2>Sort Purchase Log</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="purchaseSortOption" value="' + val + '"' + (_purchaseSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyPurchaseSort()">Apply</button>'
  );
}

function applyPurchaseSort() {
  const selected = document.querySelector('input[name="purchaseSortOption"]:checked');
  if (!selected) return;
  _purchaseSort = selected.value;
  closeModal();
  renderPurchaseLogRows();
}

function purchaseRowHtml(r) {
  const groupCells = r.groupStart
    ? '<td rowspan="' + r.groupSize + '">' + r.date +
        '<br><span style="color:#666; font-size:12px;">' + r.purchaseCode + "</span>" +
        '<br><span title="' + r.supplier + '">' + r.supplier + "</span>" +
      "</td>"
    : "";
  const trailingCells = r.groupStart
    ? '<td rowspan="' + r.groupSize + '">' + r.status + '<br><span style="color:#666; font-size:12px;">' + r.method + "</span></td>" +
      '<td rowspan="' + r.groupSize + '" title="' + (r.notes || "") + '">' + (r.notes || "") + "</td>"
    : "";

  return (
    '<tr class="' + (r.groupStart ? "group-start" : "") + '">' +
      groupCells +
      '<td title="' + (r.category || "") + '">' + (r.category || "") + "</td>" +
      '<td title="' + r.itemName + (r.lineNotes ? " - " + r.lineNotes : "") + '">' + r.itemName +
        (r.lineNotes ? '<br><span style="color:#666; font-size:11px;">' + r.lineNotes + "</span>" : "") +
      "</td>" +
      "<td>" + r.qty + "</td>" +
      "<td>" + r.unit + "</td>" +
      "<td>" + formatRupiah(r.totalCost) + "</td>" +
      "<td>" + formatRupiah(r.unitCost) + "</td>" +
      trailingCells +
    "</tr>"
  );
}

// ================================================================
// Stock Opname - checklist form ported from
// 04 Inventory/StockOpnameEntry.html + StockOpnameEntry_JS.html; log
// table from StockOpnameTable.html. Book Balance is loaded from the same
// current_stock-backed overview data and re-verified server-side at save
// time (see functions/api/opname.js) - not trusted from what's on screen.
// ================================================================

async function renderOpnameTab(wrap) {
  wrap.innerHTML = buildOpnameTableShellHtml();
  await loadOpnameTable();
}

async function openOpnameModal() {
  openModal(buildOpnameFormHtml());
  initOpnameForm();
  await loadOpnameChecklist();
}

// Column order is Item/Unit/Book Balance/Physical Count/Notes/Done - Done
// last (right edge of the row), not leading, per explicit request. Type/
// Category filters sit top-right, opposite Date/Search - condensed column
// widths (colgroup + table-layout:fixed) so the whole checklist fits a
// tablet screen without horizontal scrolling.
function buildOpnameFormHtml() {
  return (
    "<h2>Input Stock Opname</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="opnameToday" checked onchange="setOpnameToday()">' +
      '<label for="opnameToday">Today</label>' +
      '<input type="date" id="opnameDate">' +
    "</div><br><br>" +

    '<div style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:10px;">' +
      "<div>" +
        "<label>Search Item</label><br>" +
        '<input type="text" id="opnameItemFilter" placeholder="SKU or item name..." style="width:180px;" oninput="filterOpnameRows()">' +
      "</div>" +
      '<div style="display:flex; gap:10px;">' +
        '<div><label>Type</label><br><select id="opnameTypeFilter" style="width:130px;" onchange="filterOpnameRows()"><option value="">All Types</option></select></div>' +
        '<div><label>Category</label><br><select id="opnameCategoryFilter" style="width:130px;" onchange="filterOpnameRows()"><option value="">All Categories</option></select></div>' +
      "</div>" +
    "</div><br>" +

    '<div id="opnameChecklistScrollWrap" style="overflow-x:auto;">' +
      '<table style="table-layout:fixed; min-width:630px;">' +
        '<colgroup><col style="width:200px;"><col style="width:50px;"><col style="width:85px;">' +
          '<col style="width:90px;"><col style="width:140px;"><col style="width:50px;"></colgroup>' +
        "<thead><tr><th>Item</th><th>Unit</th><th>Book Balance</th><th>Physical Count</th><th>Notes</th><th>Done</th></tr></thead>" +
        '<tbody id="opnameChecklistBody"><tr><td colspan="6">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div><br>" +

    '<button id="saveOpnameBtn" onclick="saveStockOpname()">Save</button>' +
    '<span id="saveOpnameStatus" class="save-status"></span>'
  );
}

function initOpnameForm() {
  setOpnameToday();
  enableDragScroll(document.getElementById("opnameChecklistScrollWrap"));
}

function setOpnameToday() {
  if (document.getElementById("opnameToday").checked) document.getElementById("opnameDate").value = todayISO();
  else document.getElementById("opnameDate").value = "";
}

async function loadOpnameChecklist() {
  const tbody = document.getElementById("opnameChecklistBody");
  tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

  const items = await api("inventory/overview");
  if (!document.getElementById("opnameChecklistBody")) return;

  populateOpnameFilterOptions(items);

  tbody.innerHTML = "";
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.skuId = item.id;
    tr.dataset.sku = item.sku;
    tr.dataset.name = item.name;
    tr.dataset.itemType = item.itemType || "";
    tr.dataset.category = item.category || "";
    tr.innerHTML =
      "<td>" + item.name + '<br><span style="color:#666; font-size:12px;">' + item.sku + "</span></td>" +
      "<td>" + item.unit + "</td>" +
      "<td>" + item.currentStock + "</td>" +
      '<td><input type="number" class="physicalCount" min="0" step="any" style="width:100%; box-sizing:border-box;"></td>' +
      '<td><input type="text" class="notes" style="width:100%; box-sizing:border-box;"></td>' +
      '<td><input type="checkbox" onchange="toggleOpnameRowLock(this)"></td>';
    tbody.appendChild(tr);
  });
}

// Options built from whatever's actually in the checklist (not a separate
// fixed list) - same "seen values only" approach as other ad-hoc filters in
// this app (e.g. pages/sales.js's channel filter).
function populateOpnameFilterOptions(items) {
  const types = [...new Set(items.map((i) => i.itemType).filter(Boolean))].sort();
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort();

  const typeSelect = document.getElementById("opnameTypeFilter");
  const categorySelect = document.getElementById("opnameCategoryFilter");
  if (typeSelect) typeSelect.innerHTML = '<option value="">All Types</option>' + types.map((t) => "<option>" + t + "</option>").join("");
  if (categorySelect) categorySelect.innerHTML = '<option value="">All Categories</option>' + categories.map((c) => "<option>" + c + "</option>").join("");
}

function toggleOpnameRowLock(checkbox) {
  const row = checkbox.closest("tr");
  const physicalCount = row.querySelector(".physicalCount");
  const notes = row.querySelector(".notes");

  if (checkbox.checked) {
    if (physicalCount.value === "") {
      alert("Please enter Physical Count before checking.");
      checkbox.checked = false;
      return;
    }
    physicalCount.disabled = true;
    notes.disabled = true;
    row.classList.add("done");
  } else {
    physicalCount.disabled = false;
    notes.disabled = false;
    row.classList.remove("done");
  }
}

function filterOpnameRows() {
  const query = document.getElementById("opnameItemFilter").value.trim().toLowerCase();
  const typeFilter = document.getElementById("opnameTypeFilter").value;
  const categoryFilter = document.getElementById("opnameCategoryFilter").value;

  document.querySelectorAll("#opnameChecklistBody tr").forEach((row) => {
    const sku = (row.dataset.sku || "").toLowerCase();
    const name = (row.dataset.name || "").toLowerCase();
    const matchesQuery = !query || sku.indexOf(query) !== -1 || name.indexOf(query) !== -1;
    const matchesType = !typeFilter || row.dataset.itemType === typeFilter;
    const matchesCategory = !categoryFilter || row.dataset.category === categoryFilter;
    row.style.display = (matchesQuery && matchesType && matchesCategory) ? "" : "none";
  });
}

async function saveStockOpname() {
  const date = document.getElementById("opnameDate").value;
  if (!date) { alert("Please select a date."); return; }

  const items = [];
  document.querySelectorAll("#opnameChecklistBody tr").forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox || !checkbox.checked) return;
    items.push({
      skuId: row.dataset.skuId,
      physicalCount: Number(row.querySelector(".physicalCount").value),
      notes: row.querySelector(".notes").value || null
    });
  });

  if (!items.length) { alert("Check at least one item that's been counted."); return; }

  const btn = document.getElementById("saveOpnameBtn");
  const statusEl = document.getElementById("saveOpnameStatus");

  withSaveStatus(btn, statusEl, "Stock Opname", async function () {
    const created = await api("opname", { method: "POST", body: { date: date, items: items } });
    closeModal();
    await loadOpnameTable();
    return created;
  });
}

// ---------- Opname log table ----------

function buildOpnameTableShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Stock Opname Log</h3>" +
      '<button onclick="openOpnameModal()">+ Input Stock Opname</button>' +
    "</div>" +
    '<div id="opnamePaginationNav" class="pagination-nav"></div>' +
    '<div id="opnameLogScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Opname ID</th><th>Date</th><th>Item</th><th>Book Balance</th>" +
        "<th>Physical Count</th><th>Variance</th><th>Variance Value</th><th>Notes</th></tr></thead>" +
        '<tbody id="opnameLogTbody"><tr><td colspan="8">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadOpnameTable() {
  const rows = await api("opname");
  const tbody = document.getElementById("opnameLogTbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(opnameRowHtml).join("") : '<tr><td colspan="8">No opname entries yet.</td></tr>';
  paginateTable("opnameLogTbody", "opnamePaginationNav", 20);
  enableDragScroll(document.getElementById("opnameLogScrollWrap"));
}

function opnameRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.opnameCode + "</td>" +
      "<td>" + r.date + "</td>" +
      "<td>" + r.itemName + '<br><span style="color:#666; font-size:12px;">' + r.sku + "</span></td>" +
      "<td>" + r.bookBalance + "</td>" +
      "<td>" + r.physicalCount + "</td>" +
      "<td>" + r.variance + "</td>" +
      "<td>" + (r.varianceValue === null ? "" : formatRupiah(r.varianceValue)) + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
    "</tr>"
  );
}

// ================================================================
// Consumption Log - read-only, ported from
// 04 Inventory/ConsumptionLogTable.html. Only Batch Production writes to
// production_consumption so far, so Ref ID is always a batch code for now
// (the old app's log also covered Orders/Sales consumption, which this app
// doesn't deduct stock for yet).
// ================================================================

let _lastConsumptionRows = [];
let _consumptionSourceFilter = []; // empty = show every Source (default)
let _consumptionSort = "date-desc";
const CONSUMPTION_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function renderConsumptionLogTab(wrap) {
  _lastConsumptionRows = await api("consumption-log");
  if (!_lastConsumptionRows.length) {
    wrap.innerHTML = "<p>No consumption recorded yet.</p>";
    return;
  }

  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
      "<h3>Consumption Log</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="consumptionFilterBadge" style="color:#666; font-size:12px;">All</span>' +
        '<button onclick="openConsumptionFilterModal()">Set Filter</button>' +
        '<span id="consumptionSortBadge" style="color:#666; font-size:12px;">Sort: ' + CONSUMPTION_SORT_LABELS[_consumptionSort] + "</span>" +
        '<button onclick="openConsumptionSortModal()">Sort</button>' +
      "</div>" +
    "</div>" +
    '<div id="consumptionPaginationNav" class="pagination-nav"></div>' +
    "<table>" +
      "<thead><tr><th>Ref ID</th><th>Date</th><th>Item</th><th>Qty</th><th>Source</th><th>Notes</th></tr></thead>" +
      '<tbody id="consumptionTbody"></tbody>' +
    "</table>";

  renderConsumptionLogRows();
}

function renderConsumptionLogRows() {
  const tbody = document.getElementById("consumptionTbody");
  if (!tbody) return;

  const filterBadge = document.getElementById("consumptionFilterBadge");
  if (filterBadge) filterBadge.textContent = _consumptionSourceFilter.length ? _consumptionSourceFilter.join(", ") : "All";
  const sortBadge = document.getElementById("consumptionSortBadge");
  if (sortBadge) sortBadge.textContent = "Sort: " + CONSUMPTION_SORT_LABELS[_consumptionSort];

  const filtered = _consumptionSourceFilter.length
    ? _lastConsumptionRows.filter((r) => _consumptionSourceFilter.indexOf(r.source || "") !== -1)
    : _lastConsumptionRows;
  const rows = filtered.slice().sort((a, b) => {
    if (a.date === b.date) return 0;
    const cmp = a.date < b.date ? -1 : 1;
    return _consumptionSort === "date-asc" ? cmp : -cmp;
  });

  tbody.innerHTML = rows.length ? rows.map(consumptionRowHtml).join("") : '<tr><td colspan="6">No consumption matches this filter.</td></tr>';
  paginateTable("consumptionTbody", "consumptionPaginationNav", 20);
}

function openConsumptionFilterModal() {
  const sources = [...new Set(_lastConsumptionRows.map((r) => r.source || "").filter(Boolean))].sort();
  const checkboxes = sources.map((s) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="consumptionSourceFilterCheck" value="' + s + '"' + (_consumptionSourceFilter.indexOf(s) !== -1 ? " checked" : "") + "> " + s + "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Source</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyConsumptionFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyConsumptionFilter() {
  _consumptionSourceFilter = Array.from(document.querySelectorAll(".consumptionSourceFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderConsumptionLogRows();
}

function openConsumptionSortModal() {
  const options = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  openModal(
    "<h2>Sort Consumption Log</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="consumptionSortOption" value="' + val + '"' + (_consumptionSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyConsumptionSort()">Apply</button>'
  );
}

function applyConsumptionSort() {
  const selected = document.querySelector('input[name="consumptionSortOption"]:checked');
  if (!selected) return;
  _consumptionSort = selected.value;
  closeModal();
  renderConsumptionLogRows();
}

function consumptionRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.refId + "</td>" +
      "<td>" + r.date + "</td>" +
      "<td>" + r.itemName + '<br><span style="color:#666; font-size:12px;">' + r.sku + "</span></td>" +
      "<td>" + r.qty + "</td>" +
      "<td>" + (r.source || "") + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
    "</tr>"
  );
}

// ================================================================
// Current Cost - read-only, ported from 04 Inventory/CurrentCostTable.html.
// One row per SKU, its most recent purchase-driven cost (only SKUs
// purchased at least once show up - see functions/api/current-cost.js).
// ================================================================

let _lastCurrentCostRows = [];
let _currentCostCategoryFilter = []; // empty = show every Category (default)
let _currentCostSort = "name-asc";
const CURRENT_COST_SORT_LABELS = {
  "name-asc": "Item Name (A-Z)", "name-desc": "Item Name (Z-A)",
  "cost-desc": "Unit Cost (High-Low)", "cost-asc": "Unit Cost (Low-High)"
};

async function renderCurrentCostTab(wrap) {
  _lastCurrentCostRows = await api("current-cost");
  if (!_lastCurrentCostRows.length) {
    wrap.innerHTML = "<h3>Current Cost</h3><p>No cost data yet - nothing has been purchased.</p>";
    return;
  }

  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
      "<h3>Current Cost</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="currentCostFilterBadge" style="color:#666; font-size:12px;">All Categories</span>' +
        '<button onclick="openCurrentCostFilterModal()">Set Filter</button>' +
        '<span id="currentCostSortBadge" style="color:#666; font-size:12px;">Sort: ' + CURRENT_COST_SORT_LABELS[_currentCostSort] + "</span>" +
        '<button onclick="openCurrentCostSortModal()">Sort</button>' +
      "</div>" +
    "</div>" +
    '<div id="currentCostPaginationNav" class="pagination-nav"></div>' +
    '<div id="currentCostScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>SKU</th><th>Category</th><th>Item Name</th><th>Unit</th><th>Purchase Qty</th>" +
        "<th>Purchase Price</th><th>Current Unit Cost</th><th>Last Updated</th><th>Supplier</th></tr></thead>" +
        '<tbody id="currentCostTbody"></tbody>' +
      "</table>" +
    "</div>";

  renderCurrentCostRows();
  enableDragScroll(document.getElementById("currentCostScrollWrap"));
}

function renderCurrentCostRows() {
  const tbody = document.getElementById("currentCostTbody");
  if (!tbody) return;

  const filterBadge = document.getElementById("currentCostFilterBadge");
  if (filterBadge) filterBadge.textContent = _currentCostCategoryFilter.length ? _currentCostCategoryFilter.join(", ") : "All Categories";
  const sortBadge = document.getElementById("currentCostSortBadge");
  if (sortBadge) sortBadge.textContent = "Sort: " + CURRENT_COST_SORT_LABELS[_currentCostSort];

  const filtered = _currentCostCategoryFilter.length
    ? _lastCurrentCostRows.filter((r) => _currentCostCategoryFilter.indexOf(r.category || "") !== -1)
    : _lastCurrentCostRows;
  const rows = filtered.slice().sort((a, b) => {
    switch (_currentCostSort) {
      case "name-desc": return b.name.localeCompare(a.name);
      case "cost-desc": return b.unitCost - a.unitCost;
      case "cost-asc": return a.unitCost - b.unitCost;
      default: return a.name.localeCompare(b.name);
    }
  });

  tbody.innerHTML = rows.length ? rows.map(currentCostRowHtml).join("") : '<tr><td colspan="9">No items match this filter.</td></tr>';
  paginateTable("currentCostTbody", "currentCostPaginationNav", 20);
}

function openCurrentCostFilterModal() {
  const categories = [...new Set(_lastCurrentCostRows.map((r) => r.category || "").filter(Boolean))].sort();
  const checkboxes = categories.map((c) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="currentCostCategoryFilterCheck" value="' + c + '"' + (_currentCostCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c + "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Category</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyCurrentCostFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyCurrentCostFilter() {
  _currentCostCategoryFilter = Array.from(document.querySelectorAll(".currentCostCategoryFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderCurrentCostRows();
}

function openCurrentCostSortModal() {
  const options = [["name-asc", "Item Name (A-Z)"], ["name-desc", "Item Name (Z-A)"], ["cost-desc", "Unit Cost (High-Low)"], ["cost-asc", "Unit Cost (Low-High)"]];
  openModal(
    "<h2>Sort Current Cost</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="currentCostSortOption" value="' + val + '"' + (_currentCostSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyCurrentCostSort()">Apply</button>'
  );
}

function applyCurrentCostSort() {
  const selected = document.querySelector('input[name="currentCostSortOption"]:checked');
  if (!selected) return;
  _currentCostSort = selected.value;
  closeModal();
  renderCurrentCostRows();
}

function currentCostRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.sku + "</td>" +
      "<td>" + (r.category || "") + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + r.unit + "</td>" +
      "<td>" + r.purchaseQty + "</td>" +
      "<td>" + formatRupiah(r.purchasePrice) + "</td>" +
      "<td>" + formatRupiah(r.unitCost) + "</td>" +
      "<td>" + r.lastUpdated + "</td>" +
      "<td>" + (r.supplier || "") + "</td>" +
    "</tr>"
  );
}

// ================================================================
// Cost Update Log - read-only, ported from
// 04 Inventory/CostUpdateLogTable.html. Full audit trail (sku_cost_history),
// auto-written by the trg_log_cost_update trigger on every purchase_lines
// insert - nothing here writes to it directly.
// ================================================================

let _lastCostUpdateRows = [];
let _costUpdateSupplierFilter = []; // empty = show every Supplier (default)
let _costUpdateSort = "date-desc";
const COST_UPDATE_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function renderCostUpdateLogTab(wrap) {
  _lastCostUpdateRows = await api("cost-update-log");
  if (!_lastCostUpdateRows.length) {
    wrap.innerHTML = "<h3>Cost Update Log</h3><p>No cost updates yet.</p>";
    return;
  }

  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
      "<h3>Cost Update Log</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="costUpdateFilterBadge" style="color:#666; font-size:12px;">All Suppliers</span>' +
        '<button onclick="openCostUpdateFilterModal()">Set Filter</button>' +
        '<span id="costUpdateSortBadge" style="color:#666; font-size:12px;">Sort: ' + COST_UPDATE_SORT_LABELS[_costUpdateSort] + "</span>" +
        '<button onclick="openCostUpdateSortModal()">Sort</button>' +
      "</div>" +
    "</div>" +
    '<div id="costUpdatePaginationNav" class="pagination-nav"></div>' +
    '<div id="costUpdateScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>SKU</th><th>Item Name</th><th>Supplier</th><th>Purchase Qty</th><th>Unit</th>" +
        "<th>Purchase Price</th><th>Previous Unit Cost</th><th>Updated Unit Cost</th><th>Variance</th><th>Variance %</th><th>Remarks</th></tr></thead>" +
        '<tbody id="costUpdateTbody"></tbody>' +
      "</table>" +
    "</div>";

  renderCostUpdateRows();
  enableDragScroll(document.getElementById("costUpdateScrollWrap"));
}

function renderCostUpdateRows() {
  const tbody = document.getElementById("costUpdateTbody");
  if (!tbody) return;

  const filterBadge = document.getElementById("costUpdateFilterBadge");
  if (filterBadge) filterBadge.textContent = _costUpdateSupplierFilter.length ? _costUpdateSupplierFilter.join(", ") : "All Suppliers";
  const sortBadge = document.getElementById("costUpdateSortBadge");
  if (sortBadge) sortBadge.textContent = "Sort: " + COST_UPDATE_SORT_LABELS[_costUpdateSort];

  const filtered = _costUpdateSupplierFilter.length
    ? _lastCostUpdateRows.filter((r) => _costUpdateSupplierFilter.indexOf(r.supplier || "") !== -1)
    : _lastCostUpdateRows;
  const rows = filtered.slice().sort((a, b) => {
    if (a.date === b.date) return 0;
    const cmp = a.date < b.date ? -1 : 1;
    return _costUpdateSort === "date-asc" ? cmp : -cmp;
  });

  tbody.innerHTML = rows.length ? rows.map(costUpdateRowHtml).join("") : '<tr><td colspan="12">No entries match this filter.</td></tr>';
  paginateTable("costUpdateTbody", "costUpdatePaginationNav", 20);
}

function openCostUpdateFilterModal() {
  const suppliers = [...new Set(_lastCostUpdateRows.map((r) => r.supplier || "").filter(Boolean))].sort();
  const checkboxes = suppliers.map((s) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="costUpdateSupplierFilterCheck" value="' + s + '"' + (_costUpdateSupplierFilter.indexOf(s) !== -1 ? " checked" : "") + "> " + s + "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Supplier</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyCostUpdateFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyCostUpdateFilter() {
  _costUpdateSupplierFilter = Array.from(document.querySelectorAll(".costUpdateSupplierFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderCostUpdateRows();
}

function openCostUpdateSortModal() {
  const options = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  openModal(
    "<h2>Sort Cost Update Log</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="costUpdateSortOption" value="' + val + '"' + (_costUpdateSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyCostUpdateSort()">Apply</button>'
  );
}

function applyCostUpdateSort() {
  const selected = document.querySelector('input[name="costUpdateSortOption"]:checked');
  if (!selected) return;
  _costUpdateSort = selected.value;
  closeModal();
  renderCostUpdateRows();
}

function costUpdateRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.date + "</td>" +
      "<td>" + r.sku + "</td>" +
      "<td>" + r.itemName + "</td>" +
      "<td>" + (r.supplier || "") + "</td>" +
      "<td>" + (r.qty === null ? "" : r.qty) + "</td>" +
      "<td>" + (r.unit || "") + "</td>" +
      "<td>" + formatRupiah(r.purchasePrice) + "</td>" +
      "<td>" + (r.previousUnitCost === null ? "-" : formatRupiah(r.previousUnitCost)) + "</td>" +
      "<td>" + formatRupiah(r.updatedUnitCost) + "</td>" +
      "<td>" + (r.variance === null ? "-" : formatRupiah(r.variance)) + "</td>" +
      "<td>" + (r.variancePct === null ? "-" : formatPercent(r.variancePct / 100)) + "</td>" +
      "<td>" + (r.remarks || "") + "</td>" +
    "</tr>"
  );
}
