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

function stockableSkus() {
  return _invLookups.skus.filter((s) => STOCKABLE_TYPES.indexOf(s.item_type) !== -1);
}

// ---------- Stock page (Overview / Purchase Log / Opname / Consumption Log) ----------

let _activeInvStockTab = "overview";

async function renderInventoryStockPage(content) {
  content.innerHTML = "<h2>Inventory Stock</h2>" + buildInventoryStockTabsHtml();
  await ensureInvLookups();
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

async function renderOverviewTab(wrap) {
  wrap.innerHTML =
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

  const rows = _overviewTypeFilter.length
    ? _overviewRows.filter((r) => _overviewTypeFilter.indexOf(r.itemType) !== -1)
    : _overviewRows;

  tbody.innerHTML = rows.length ? rows.map(overviewRowHtml).join("") : '<tr><td colspan="8">No items match this filter.</td></tr>';
  paginateTable("stockOverviewTbody", "stockOverviewPaginationNav", 20);

  const badge = document.getElementById("overviewFilterBadge");
  if (badge) badge.textContent = _overviewTypeFilter.length ? _overviewTypeFilter.join(", ") : "All";
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
// StockInEntry_JS.html (form) and StockInTable.html (grouped log table)
// ================================================================

let _supplierCombo = null;
let _purchasePaginationTargetSize = 20;

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
      totalCost: totalCost
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
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Purchase Log</h3>" +
      '<button onclick="openPurchaseModal()">+ Input Purchase</button>' +
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
  const rows = await api("purchases");
  const tbody = document.getElementById("purchaseLogTbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(purchaseRowHtml).join("") : '<tr><td colspan="9">No purchases yet.</td></tr>';
  paginateGroupedTable("purchaseLogTbody", "purchasePaginationNav", 20);
  enableDragScroll(document.getElementById("purchaseLogScrollWrap"));
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
      '<td title="' + r.itemName + '">' + r.itemName + "</td>" +
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

function buildOpnameFormHtml() {
  return (
    "<h2>Input Stock Opname</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="opnameToday" checked onchange="setOpnameToday()">' +
      '<label for="opnameToday">Today</label>' +
      '<input type="date" id="opnameDate">' +
    "</div><br><br>" +

    "<label>Search Item</label><br>" +
    '<input type="text" id="opnameItemFilter" placeholder="SKU or item name..." oninput="filterOpnameRows()">' +
    "<br><br>" +

    "<table>" +
      "<thead><tr><th>Done</th><th>Item</th><th>Unit</th><th>Book Balance</th><th>Physical Count</th><th>Notes</th></tr></thead>" +
      '<tbody id="opnameChecklistBody"><tr><td colspan="6">Loading...</td></tr></tbody>' +
    "</table><br>" +

    '<button id="saveOpnameBtn" onclick="saveStockOpname()">Save</button>' +
    '<span id="saveOpnameStatus" class="save-status"></span>'
  );
}

function initOpnameForm() {
  setOpnameToday();
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

  tbody.innerHTML = "";
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.skuId = item.id;
    tr.dataset.sku = item.sku;
    tr.dataset.name = item.name;
    tr.innerHTML =
      '<td><input type="checkbox" onchange="toggleOpnameRowLock(this)"></td>' +
      "<td>" + item.name + '<br><span style="color:#666; font-size:12px;">' + item.sku + "</span></td>" +
      "<td>" + item.unit + "</td>" +
      "<td>" + item.currentStock + "</td>" +
      '<td><input type="number" class="physicalCount" min="0" step="any" style="width:90px;"></td>' +
      '<td><input type="text" class="notes"></td>';
    tbody.appendChild(tr);
  });
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
  document.querySelectorAll("#opnameChecklistBody tr").forEach((row) => {
    const sku = (row.dataset.sku || "").toLowerCase();
    const name = (row.dataset.name || "").toLowerCase();
    row.style.display = (!query || sku.indexOf(query) !== -1 || name.indexOf(query) !== -1) ? "" : "none";
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

async function renderConsumptionLogTab(wrap) {
  const rows = await api("consumption-log");
  if (!rows.length) {
    wrap.innerHTML = "<p>No consumption recorded yet.</p>";
    return;
  }

  wrap.innerHTML =
    "<h3>Consumption Log</h3>" +
    '<div id="consumptionPaginationNav" class="pagination-nav"></div>' +
    "<table>" +
      "<thead><tr><th>Ref ID</th><th>Date</th><th>Item</th><th>Qty</th><th>Source</th><th>Notes</th></tr></thead>" +
      '<tbody id="consumptionTbody">' + rows.map(consumptionRowHtml).join("") + "</tbody>" +
    "</table>";

  paginateTable("consumptionTbody", "consumptionPaginationNav", 20);
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

async function renderCurrentCostTab(wrap) {
  const rows = await api("current-cost");
  if (!rows.length) {
    wrap.innerHTML = "<h3>Current Cost</h3><p>No cost data yet - nothing has been purchased.</p>";
    return;
  }

  wrap.innerHTML =
    "<h3>Current Cost</h3>" +
    '<div id="currentCostPaginationNav" class="pagination-nav"></div>' +
    '<div id="currentCostScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>SKU</th><th>Category</th><th>Item Name</th><th>Unit</th><th>Purchase Qty</th>" +
        "<th>Purchase Price</th><th>Current Unit Cost</th><th>Last Updated</th><th>Supplier</th></tr></thead>" +
        '<tbody id="currentCostTbody">' + rows.map(currentCostRowHtml).join("") + "</tbody>" +
      "</table>" +
    "</div>";

  paginateTable("currentCostTbody", "currentCostPaginationNav", 20);
  enableDragScroll(document.getElementById("currentCostScrollWrap"));
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

async function renderCostUpdateLogTab(wrap) {
  const rows = await api("cost-update-log");
  if (!rows.length) {
    wrap.innerHTML = "<h3>Cost Update Log</h3><p>No cost updates yet.</p>";
    return;
  }

  wrap.innerHTML =
    "<h3>Cost Update Log</h3>" +
    '<div id="costUpdatePaginationNav" class="pagination-nav"></div>' +
    '<div id="costUpdateScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>SKU</th><th>Item Name</th><th>Supplier</th><th>Purchase Qty</th><th>Unit</th>" +
        "<th>Purchase Price</th><th>Previous Unit Cost</th><th>Updated Unit Cost</th><th>Variance</th><th>Variance %</th><th>Remarks</th></tr></thead>" +
        '<tbody id="costUpdateTbody">' + rows.map(costUpdateRowHtml).join("") + "</tbody>" +
      "</table>" +
    "</div>";

  paginateTable("costUpdateTbody", "costUpdatePaginationNav", 20);
  enableDragScroll(document.getElementById("costUpdateScrollWrap"));
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
