// Database - SKU (6 type tabs)/Supplier/Customer/Staff master data CRUD.
// Ported loosely from the old app's 07 Database module: same entities and
// column sets, but Create/Edit uses this app's modal pattern (not the old
// app's inline per-row edit), and Delete is a hard-delete-with-usage-guard
// for ALL FOUR entities (old app only guarded SKU - Supplier/Customer/Staff
// were denormalized text there, safe to delete blindly; here they're real
// FKs - see functions/api/{suppliers,customers,staff}/[code].js). Component/
// Semi-Finished SKU costing detail lives in Menu Engineering > Costing
// already - not duplicated here.
registerPage("database", renderDatabasePage);

let _activeDbSection = "sku";

// Nav's SKU submenu links carry the type in the tab value ("sku-Ingredient")
// so setActiveNavButton's data-tab matching (shared.js) can highlight the
// exact SKU type, not just "somewhere in Database" - split back apart here.
async function renderDatabasePage(content) {
  const query = location.hash.split("?")[1] || "";
  const tabParam = new URLSearchParams(query).get("tab") || "";

  if (tabParam.indexOf("sku-") === 0) {
    _activeDbSection = "sku";
    const type = tabParam.slice(4);
    if (SKU_TYPES.indexOf(type) !== -1) _activeSkuType = type;
  } else if (["supplier", "customer", "staff"].indexOf(tabParam) !== -1) {
    _activeDbSection = tabParam;
  }

  content.innerHTML = "<h2>Database</h2>" + buildDatabaseTabsHtml();
  wireDatabaseTabs();
  await loadDatabaseSection(_activeDbSection);
}

function buildDatabaseTabsHtml() {
  return (
    '<div class="tabs">' +
      '<button id="dbTab-sku" onclick="switchDatabaseSection(\'sku\')">SKU</button>' +
      '<button id="dbTab-supplier" onclick="switchDatabaseSection(\'supplier\')">Supplier</button>' +
      '<button id="dbTab-customer" onclick="switchDatabaseSection(\'customer\')">Customer</button>' +
      '<button id="dbTab-staff" onclick="switchDatabaseSection(\'staff\')">Staff</button>' +
    "</div>" +
    '<div id="databaseSectionWrap"><p>Loading...</p></div>'
  );
}

function wireDatabaseTabs() {
  ["sku", "supplier", "customer", "staff"].forEach((s) => document.getElementById("dbTab-" + s).classList.toggle("tab-active", s === _activeDbSection));
}

function switchDatabaseSection(section) {
  if (section === _activeDbSection) return;
  _activeDbSection = section;
  wireDatabaseTabs();
  loadDatabaseSection(section);
}

async function loadDatabaseSection(section) {
  const wrap = document.getElementById("databaseSectionWrap");
  wrap.innerHTML = "<p>Loading...</p>";
  if (section === "sku") await renderSkuSection(wrap);
  else if (section === "supplier") await renderSupplierSection(wrap);
  else if (section === "customer") await renderCustomerSection(wrap);
  else await renderStaffSection(wrap);
}

// ================================================================
// SKU (Ingredient/Packaging/Operating/Product/Component/Semi-Finished -
// matches the old app's 6 visible Database > SKU tabs; "Other" has no tab
// there either, same here)
// ================================================================

const SKU_TYPES = ["Ingredient", "Packaging", "Operating", "Product", "Component", "Semi-Finished"];
let _activeSkuType = "Ingredient";
let _lastSkuRows = [];
let _skuArrangeMode = false;
let _skuArrangeRows = [];
let _skuCategoryFilter = []; // empty = show every Category (default) - reset on type switch, see switchSkuType
// Defaults to the type's "on" status (Available, or Active for Product) -
// reset per-type in switchSkuType since the vocabulary itself differs by
// type (see skuStatusOptionsHtml). "All" is still reachable via Set Filter.
let _skuStatusFilter = ["Available"];

function skuTypeTabId(type) {
  return "skuTypeTab-" + type.replace(/[^a-zA-Z]/g, "");
}

async function renderSkuSection(wrap) {
  wrap.innerHTML =
    '<div class="tabs" style="margin-top:4px;">' +
      SKU_TYPES.map((t) => '<button id="' + skuTypeTabId(t) + '" onclick="switchSkuType(\'' + t + '\')">' + t + "</button>").join("") +
    "</div>" +
    '<div id="skuTypeWrap"><p>Loading...</p></div>';
  wireSkuTypeTabs();
  await loadSkuType(_activeSkuType);
}

function wireSkuTypeTabs() {
  SKU_TYPES.forEach((t) => document.getElementById(skuTypeTabId(t)).classList.toggle("tab-active", t === _activeSkuType));
}

function switchSkuType(type) {
  if (type === _activeSkuType) return;
  _activeSkuType = type;
  _skuArrangeMode = false;
  _skuCategoryFilter = []; // categories are type-specific, stale otherwise
  _skuStatusFilter = [type === "Product" ? "Active" : "Available"]; // vocabulary is type-specific too
  wireSkuTypeTabs();
  loadSkuType(type);
}

async function loadSkuType(type) {
  const wrap = document.getElementById("skuTypeWrap");
  wrap.innerHTML = "<p>Loading...</p>";
  _lastSkuRows = await api("sku-items?type=" + encodeURIComponent(type));
  if (!document.getElementById("skuTypeWrap")) return;
  renderSkuTable(wrap);
}

// Same Arrange pattern as Menu Engineering > Pricing (see pricingRowHtml/
// startArrangePricing/saveArrangePricing in menu.js) - move ↑/↓ staged
// locally, one API call on Save Order with the final full sequence. Backed
// by functions/api/sku-order.js (display_order for Product, so this stays
// in sync with Pricing's own Arrange; registry_order for every other type,
// which also drives Stock Overview's row order).
// Filter only applies to the normal view, not Arrange mode - Arrange
// always stages/reorders the FULL list (same as before), a partial
// filtered view would make "Save Order" silently drop whatever's hidden.
function visibleSkuRows() {
  if (_skuArrangeMode) return _skuArrangeRows;
  return _lastSkuRows.filter((r) =>
    (!_skuCategoryFilter.length || _skuCategoryFilter.indexOf(r.category || "") !== -1) &&
    (!_skuStatusFilter.length || _skuStatusFilter.indexOf(r.status) !== -1)
  );
}

function renderSkuTable(wrap) {
  const rows = visibleSkuRows();

  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>SKU Registry - " + _activeSkuType + "</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        (_skuArrangeMode ? "" :
          '<span id="skuFilterBadge" style="color:var(--color-text-muted); font-size:12px;">' +
            (_skuCategoryFilter.length ? _skuCategoryFilter.join(", ") : "All Categories") + " | " +
            (_skuStatusFilter.length ? _skuStatusFilter.join(", ") : "All Statuses") +
          "</span>" +
          '<button onclick="openSkuFilterModal()">Set Filter</button>'
        ) +
        '<button class="btn-primary" onclick="openSkuModal(null)">+ Add SKU</button>' +
      "</div>" +
    "</div>" +
    '<div id="skuPaginationNav" class="pagination-nav"></div>' +
    '<div id="skuScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr>" +
          (_skuArrangeMode ? "<th></th>" : "") +
          "<th>Category</th><th>Name</th><th>Unit</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="skuTbody">' + (rows.length ? rows.map((r, i) => skuRowHtml(r, i === 0, i === rows.length - 1)).join("") : '<tr><td colspan="5">No SKUs match this filter.</td></tr>') + "</tbody>" +
      "</table>" +
    "</div>" +
    '<div style="display:flex; justify-content:flex-start; gap:8px; margin-top:8px;">' +
      (_skuArrangeMode
        ? '<button onclick="cancelArrangeSku()">Cancel</button><button onclick="saveArrangeSku()">Save Order</button><span id="arrangeSkuStatus" class="save-status"></span>'
        : '<button onclick="startArrangeSku()">Arrange</button>') +
    "</div>";

  if (!_skuArrangeMode) paginateTable("skuTbody", "skuPaginationNav", 20);
  enableDragScroll(document.getElementById("skuScrollWrap"));
}

function openSkuFilterModal() {
  const categories = [...new Set(_lastSkuRows.map((r) => r.category || "").filter(Boolean))].sort();
  const categoryChecks = categories.map((c) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="skuCategoryFilterCheck" value="' + c + '"' + (_skuCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c +
    "</label>"
  ).join("");
  // Same two-value vocabulary as skuStatusOptionsHtml (Add/Edit SKU's own
  // Status dropdown) - Active/Inactive for Product, Available/Unavailable
  // for everything else.
  const statusOptions = _activeSkuType === "Product" ? ["Active", "Inactive"] : ["Available", "Unavailable"];
  const statusChecks = statusOptions.map((s) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="skuStatusFilterCheck" value="' + s + '"' + (_skuStatusFilter.indexOf(s) !== -1 ? " checked" : "") + "> " + s +
    "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - SKU Registry</h2>" +
    "<label>Category</label>" +
    "<div>" + (categoryChecks || "<p>No categories on this SKU type.</p>") + "</div><br>" +
    "<label>Status</label>" +
    "<div>" + statusChecks + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button class="btn-primary" onclick="applySkuFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applySkuFilter() {
  _skuCategoryFilter = Array.from(document.querySelectorAll(".skuCategoryFilterCheck:checked")).map((cb) => cb.value);
  _skuStatusFilter = Array.from(document.querySelectorAll(".skuStatusFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  renderSkuTable(document.getElementById("skuTypeWrap"));
}

function skuRowHtml(r, isFirst, isLast) {
  const moveCell = _skuArrangeMode
    ? "<td>" +
        '<button style="font-size:12px;" onclick="moveSkuOrder(\'' + r.sku + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:12px;" onclick="moveSkuOrder(\'' + r.sku + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  return (
    "<tr>" +
      moveCell +
      "<td>" + (r.category || "") + "</td>" +
      "<td>" + r.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.sku + "</span></td>" +
      "<td>" + r.unit + "</td>" +
      "<td>" + r.status + "</td>" +
      (_skuArrangeMode ? "" :
        ('<td class="compact-cell"><button class="btn-compact" onclick="openSkuModal(\'' + r.sku + '\')">Edit</button> ' +
        '<button class="btn-compact" onclick="deleteSku(\'' + r.sku + '\')">Delete</button></td>')
      ) +
    "</tr>"
  );
}

function startArrangeSku() {
  _skuArrangeMode = true;
  _skuArrangeRows = _lastSkuRows.slice();
  renderSkuTable(document.getElementById("skuTypeWrap"));
}

function cancelArrangeSku() {
  _skuArrangeMode = false;
  renderSkuTable(document.getElementById("skuTypeWrap"));
}

function moveSkuOrder(sku, direction) {
  const index = _skuArrangeRows.findIndex((r) => r.sku === sku);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= _skuArrangeRows.length) return;

  const tmp = _skuArrangeRows[index];
  _skuArrangeRows[index] = _skuArrangeRows[targetIndex];
  _skuArrangeRows[targetIndex] = tmp;

  renderSkuTable(document.getElementById("skuTypeWrap"));
}

function saveArrangeSku() {
  const btn = document.querySelector('button[onclick="saveArrangeSku()"]');
  const statusEl = document.getElementById("arrangeSkuStatus");

  withSaveStatus(btn, statusEl, "Order", async function () {
    await api("sku-order", { method: "POST", body: { skus: _skuArrangeRows.map((r) => r.sku), itemType: _activeSkuType } });
    _skuArrangeMode = false;
    await loadSkuType(_activeSkuType);
  });
}

// SKU code/Type/Category are only set at Add time - SKU Code auto-fills
// from Settings > SKU Configuration (Type/Category codes, see
// skuCodePreview below and functions/api/sku-items.js) and Category is a
// dropdown of that same config, both locked after creation (matches the old
// app's updateSkuItem, which never touched them either).
// Product uses Active/Inactive, every other type uses Available/Unavailable
// - two different vocabularies for the same on/off concept (Product's
// "Active" predates the Inventory-side Available/Unavailable pair and was
// never reconciled - fixing that mismatch is out of scope here, this just
// stops the Status dropdown from silently corrupting it). First option is
// always the "on" state and the default for a brand-new SKU.
function skuStatusOptionsHtml(itemType, currentStatus) {
  const options = itemType === "Product" ? ["Active", "Inactive"] : ["Available", "Unavailable"];
  return options.map((o) => "<option" + ((currentStatus ? currentStatus === o : o === options[0]) ? " selected" : "") + ">" + o + "</option>").join("");
}

// Category/Unit options both come from Settings > SKU Configuration now
// (settings_lists "SKU Category Code - {type}" / "SKU Unit Code") - strict
// dropdowns, no manual entry (per explicit reversal of an earlier free-text
// version). Fetched once per session; Manage SKU Config is a separate page
// (Settings), so a value added there won't show up here until next reload -
// acceptable since Add SKU and Settings aren't used in the same breath.
let _skuConfigData = null;

async function ensureSkuConfigData() {
  if (_skuConfigData) return;
  _skuConfigData = await api("settings");
}

// Matches the server's own derivation (functions/api/sku-items.js) so the
// user sees the real code before saving, not just after. Prefix comes from
// SKU Configuration's meta (Type code + Category code), not from any
// existing sku_items row - works even for a configured category with zero
// SKUs yet. Empty return means Type/Category isn't configured at all (only
// reachable by picking the blank/default option, since both dropdowns only
// ever offer configured values).
function skuCodePreview(category) {
  const typeCode = (_skuConfigData.listsMeta["SKU Type Code"] || {})[_activeSkuType];
  const categoryCode = (_skuConfigData.listsMeta["SKU Category Code - " + _activeSkuType] || {})[category];
  if (!typeCode || !categoryCode) return "";

  const prefix = typeCode + "-" + categoryCode;
  let maxN = 0;
  _lastSkuRows.forEach((r) => {
    if (r.sku.indexOf(prefix + "-") !== 0) return;
    const m = r.sku.match(/-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  });
  return prefix + "-" + String(maxN + 1).padStart(4, "0");
}

function onSkuCategoryChange() {
  document.getElementById("skuCode").value = skuCodePreview(document.getElementById("skuCategory").value);
}

async function openSkuModal(sku) {
  const row = sku ? _lastSkuRows.find((r) => r.sku === sku) : null;
  const itemType = row ? row.item_type : _activeSkuType;

  await ensureSkuConfigData();
  const categories = row ? [] : (_skuConfigData.lists["SKU Category Code - " + itemType] || []);
  // Dropdown shows the friendly Name (Gram, Piece, ...) but its value - what
  // actually gets saved to sku_items.unit and shown everywhere else in the
  // app (recipe qty, purchase lines, batch consumption, ...) - is the short
  // Code (g, pc, ...), per explicit correction: unit Name is UI-only, every
  // other reference to a unit uses the Code.
  const unitNames = _skuConfigData.lists["SKU Unit Code"] || [];
  const unitCodeByName = _skuConfigData.listsMeta["SKU Unit Code"] || {};

  openModal(
    "<h2>" + (sku ? "Edit SKU - " + sku : "Add SKU - " + _activeSkuType) + "</h2>" +
    (row
      ? ('<p><strong>SKU:</strong> ' + row.sku + ' &nbsp; <strong>Type:</strong> ' + row.item_type + ' &nbsp; <strong>Category:</strong> ' + (row.category || "-") + "</p>")
      : (
          "<label>Category</label><br>" +
          '<select id="skuCategory" onchange="onSkuCategoryChange()" style="width:170px;">' +
            (categories.length ? categories.map((c) => "<option>" + c + "</option>").join("") : '<option value="">No categories configured</option>') +
          "</select><br><br>" +
          "<label>SKU Code</label><br>" +
          '<input type="text" id="skuCode" readonly style="background:var(--color-disabled-bg);"><br><br>'
        )
    ) +
    "<label>Item Name</label><br>" +
    '<input type="text" id="skuName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Unit</label><br>" +
    '<select id="skuUnit" style="width:170px;">' +
      (unitNames.length
        ? unitNames.map((n) => {
            const code = unitCodeByName[n] || n;
            return '<option value="' + code + '"' + (row && row.unit === code ? " selected" : "") + ">" + n + "</option>";
          }).join("")
        : '<option value="">No units configured</option>') +
    "</select><br><br>" +
    "<label>Status</label><br>" +
    '<select id="skuStatus">' + skuStatusOptionsHtml(itemType, row ? row.status : null) + "</select><br><br>" +
    '<button id="saveSkuBtn" class="btn-primary" onclick="saveSku(' + (sku ? "'" + sku + "'" : "null") + ')">Save</button>' +
    '<span id="saveSkuStatus" class="save-status"></span>'
  );

  if (!row && categories.length) onSkuCategoryChange();
}

function saveSku(existingSku) {
  const name = document.getElementById("skuName").value.trim();
  const unit = document.getElementById("skuUnit").value;
  const status = document.getElementById("skuStatus").value;

  if (!name) { alert("Please enter an Item Name."); return; }
  if (!unit) { alert("Please select a Unit."); return; }

  const btn = document.getElementById("saveSkuBtn");
  const statusEl = document.getElementById("saveSkuStatus");

  if (existingSku) {
    withSaveStatus(btn, statusEl, "SKU", async function () {
      await api("sku-items/" + encodeURIComponent(existingSku), { method: "PATCH", body: { name: name, unit: unit, status: status } });
      closeModal();
      await loadSkuType(_activeSkuType);
    });
    return;
  }

  const category = document.getElementById("skuCategory").value;
  if (!category) { alert("Please select a Category."); return; }

  withSaveStatus(btn, statusEl, "SKU", async function () {
    await api("sku-items", { method: "POST", body: { itemType: _activeSkuType, category: category, name: name, unit: unit, status: status } });
    closeModal();
    await loadSkuType(_activeSkuType);
  });
}

function deleteSku(sku) {
  openConfirmModal({
    title: "Delete this SKU?",
    body: "This can't be undone.",
    chip: sku,
    confirmLabel: "Delete SKU",
    danger: true,
    onConfirm: async function () {
      await api("sku-items/" + encodeURIComponent(sku), { method: "DELETE" });
      closeModal();
      await loadSkuType(_activeSkuType);
    }
  });
}

// ================================================================
// Supplier
// ================================================================

let _lastSupplierRows = [];
let _supplierSort = "name-asc";
let _supplierStatusFilter = ["Active"]; // defaults to Active only, per explicit request - "All" is still reachable via Filter & Sort

const ENTITY_SORT_LABELS = {
  "name-asc": "Name (A-Z)",
  "name-desc": "Name (Z-A)",
  "code-asc": "Code (small-large)",
  "code-desc": "Code (large-small)",
  "status-active-first": "Status (Active-Inactive)",
  "status-inactive-first": "Status (Inactive-Active)"
};

function sortEntityRows(rows, sortKey, codeField) {
  const sorted = rows.slice();
  switch (sortKey) {
    case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
    case "code-asc": sorted.sort((a, b) => a[codeField].localeCompare(b[codeField])); break;
    case "code-desc": sorted.sort((a, b) => b[codeField].localeCompare(a[codeField])); break;
    case "status-active-first": sorted.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0)); break;
    case "status-inactive-first": sorted.sort((a, b) => (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0)); break;
    default: sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
  }
  return sorted;
}

// Status filter (Active/Inactive) - same options for Supplier and Customer,
// but kept as separate state/functions per entity (not a shared generic
// dispatcher) to match how every other filter in this app is wired.
function filterEntityRowsByStatus(rows, statusFilter) {
  if (!statusFilter.length) return rows;
  return rows.filter((r) => statusFilter.indexOf(r.is_active ? "Active" : "Inactive") !== -1);
}

function statusFilterCheckboxesHtml(checkClass, currentFilter) {
  return ["Active", "Inactive"].map((o) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="' + checkClass + '" value="' + o + '"' + (currentFilter.indexOf(o) !== -1 ? " checked" : "") + "> " + o +
    "</label>"
  ).join("");
}

async function renderSupplierSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>Supplier List</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="supplierFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openSupplierFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openSupplierModal(null)">+ Add Supplier</button>' +
      "</div>" +
    "</div>" +
    '<div id="supplierPaginationNav" class="pagination-nav"></div>' +
    '<div id="supplierScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Name</th><th>Contact</th><th>Area</th><th>Address</th><th>Notes</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="supplierTbody"><tr><td colspan="7">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  _lastSupplierRows = await api("suppliers");
  if (!document.getElementById("supplierTbody")) return;
  renderSupplierTable();
}

function renderSupplierTable() {
  const badge = document.getElementById("supplierFilterSortBadge");
  if (badge) badge.textContent = (_supplierStatusFilter.length ? _supplierStatusFilter.join(", ") : "All Statuses") + " | " + ENTITY_SORT_LABELS[_supplierSort];

  const tbody = document.getElementById("supplierTbody");
  if (!tbody) return;
  const filtered = filterEntityRowsByStatus(_lastSupplierRows, _supplierStatusFilter);
  const rows = sortEntityRows(filtered, _supplierSort, "supplier_code");
  tbody.innerHTML = rows.length ? rows.map(supplierRowHtml).join("") : '<tr><td colspan="7">No suppliers match this filter.</td></tr>';
  paginateTable("supplierTbody", "supplierPaginationNav", 20);
  enableDragScroll(document.getElementById("supplierScrollWrap"));
}

function openSupplierFilterSortModal() {
  const sortOptions = [
    ["name-asc", "Name (A-Z)"], ["name-desc", "Name (Z-A)"],
    ["code-asc", "Code (small-large)"], ["code-desc", "Code (large-small)"],
    ["status-active-first", "Status (Active-Inactive)"], ["status-inactive-first", "Status (Inactive-Active)"]
  ];
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="supplierSortOption" value="' + val + '"' + (_supplierSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Supplier List</h2>" +
    "<label>Status</label>" +
    "<div>" + statusFilterCheckboxesHtml("supplierStatusFilterCheck", _supplierStatusFilter) + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applySupplierFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applySupplierFilterSort() {
  _supplierStatusFilter = Array.from(document.querySelectorAll(".supplierStatusFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="supplierSortOption"]:checked');
  if (selectedSort) _supplierSort = selectedSort.value;
  closeModal();
  renderSupplierTable();
}

function supplierRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.supplier_code + "</span></td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.area || "") + "</td>" +
      "<td>" + (r.address || "") + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openSupplierModal(\'' + r.supplier_code + '\')">Edit</button> ' +
      '<button class="btn-compact" onclick="deleteSupplier(\'' + r.supplier_code + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function openSupplierModal(code) {
  const row = code ? _lastSupplierRows.find((r) => r.supplier_code === code) : null;

  openModal(
    "<h2>" + (code ? "Edit Supplier - " + code : "Add Supplier") + "</h2>" +
    "<label>Name</label><br>" +
    '<input type="text" id="supplierName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Contact</label><br>" +
    '<input type="text" id="supplierContact" value="' + (row ? (row.contact || "") : "") + '"><br><br>' +
    "<label>Area</label><br>" +
    '<input type="text" id="supplierArea" value="' + (row ? (row.area || "") : "") + '"><br><br>' +
    "<label>Address</label><br>" +
    '<input type="text" id="supplierAddress" value="' + (row ? (row.address || "") : "") + '"><br><br>' +
    "<label>Notes</label><br>" +
    '<input type="text" id="supplierNotes" value="' + (row ? (row.notes || "") : "") + '"><br><br>' +
    (row
      ? ('<label style="font-weight:normal;"><input type="checkbox" id="supplierActive"' + (row.is_active ? " checked" : "") + '> Active</label><br><br>')
      : ""
    ) +
    '<button id="saveSupplierBtn" class="btn-primary" onclick="saveSupplier(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveSupplierStatus" class="save-status"></span>'
  );
}

function saveSupplier(code) {
  const name = document.getElementById("supplierName").value.trim();
  if (!name) { alert("Please enter a supplier name."); return; }

  const body = {
    name: name,
    contact: document.getElementById("supplierContact").value.trim(),
    area: document.getElementById("supplierArea").value.trim(),
    address: document.getElementById("supplierAddress").value.trim(),
    notes: document.getElementById("supplierNotes").value.trim()
  };
  if (code) body.isActive = document.getElementById("supplierActive").checked;

  const btn = document.getElementById("saveSupplierBtn");
  const statusEl = document.getElementById("saveSupplierStatus");

  withSaveStatus(btn, statusEl, "Supplier", async function () {
    if (code) await api("suppliers/" + encodeURIComponent(code), { method: "PATCH", body: body });
    else await api("suppliers", { method: "POST", body: body });
    closeModal();
    await renderSupplierSection(document.getElementById("databaseSectionWrap"));
  });
}

function deleteSupplier(code) {
  openConfirmModal({
    title: "Delete this supplier?",
    body: "This can't be undone.",
    confirmLabel: "Delete Supplier",
    danger: true,
    onConfirm: async function () {
      await api("suppliers/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await renderSupplierSection(document.getElementById("databaseSectionWrap"));
    }
  });
}

// ================================================================
// Customer
// ================================================================

let _lastCustomerRows = [];
let _customerSort = "name-asc";
let _customerStatusFilter = ["Active"]; // defaults to Active only, per explicit request - "All" is still reachable via Filter & Sort

async function renderCustomerSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>Customer List</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="customerFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openCustomerFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openCustomerModal(null)">+ Add Customer</button>' +
      "</div>" +
    "</div>" +
    '<div id="customerPaginationNav" class="pagination-nav"></div>' +
    '<div id="customerScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Name</th><th>Contact</th><th>Area</th><th>Address</th><th>Notes</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="customerTbody"><tr><td colspan="7">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  _lastCustomerRows = await api("customers");
  if (!document.getElementById("customerTbody")) return;
  renderCustomerTable();
}

function renderCustomerTable() {
  const badge = document.getElementById("customerFilterSortBadge");
  if (badge) badge.textContent = (_customerStatusFilter.length ? _customerStatusFilter.join(", ") : "All Statuses") + " | " + ENTITY_SORT_LABELS[_customerSort];

  const tbody = document.getElementById("customerTbody");
  if (!tbody) return;
  const filtered = filterEntityRowsByStatus(_lastCustomerRows, _customerStatusFilter);
  const rows = sortEntityRows(filtered, _customerSort, "customer_code");
  tbody.innerHTML = rows.length ? rows.map(customerRowHtml).join("") : '<tr><td colspan="7">No customers match this filter.</td></tr>';
  paginateTable("customerTbody", "customerPaginationNav", 20);
  enableDragScroll(document.getElementById("customerScrollWrap"));
}

function openCustomerFilterSortModal() {
  const sortOptions = [
    ["name-asc", "Name (A-Z)"], ["name-desc", "Name (Z-A)"],
    ["code-asc", "Code (small-large)"], ["code-desc", "Code (large-small)"],
    ["status-active-first", "Status (Active-Inactive)"], ["status-inactive-first", "Status (Inactive-Active)"]
  ];
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="customerSortOption" value="' + val + '"' + (_customerSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Customer List</h2>" +
    "<label>Status</label>" +
    "<div>" + statusFilterCheckboxesHtml("customerStatusFilterCheck", _customerStatusFilter) + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyCustomerFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyCustomerFilterSort() {
  _customerStatusFilter = Array.from(document.querySelectorAll(".customerStatusFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="customerSortOption"]:checked');
  if (selectedSort) _customerSort = selectedSort.value;
  closeModal();
  renderCustomerTable();
}

function customerRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.customer_code + "</span></td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.area || "") + "</td>" +
      "<td>" + (r.address || "") + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openCustomerModal(\'' + r.customer_code + '\')">Edit</button> ' +
      '<button class="btn-compact" onclick="deleteCustomer(\'' + r.customer_code + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function openCustomerModal(code) {
  const row = code ? _lastCustomerRows.find((r) => r.customer_code === code) : null;

  openModal(
    "<h2>" + (code ? "Edit Customer - " + code : "Add Customer") + "</h2>" +
    "<label>Name</label><br>" +
    '<input type="text" id="customerName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Contact</label><br>" +
    '<input type="text" id="customerContact" value="' + (row ? (row.contact || "") : "") + '"><br><br>' +
    "<label>Area</label><br>" +
    '<input type="text" id="customerArea" value="' + (row ? (row.area || "") : "") + '"><br><br>' +
    "<label>Address</label><br>" +
    '<input type="text" id="customerAddress" value="' + (row ? (row.address || "") : "") + '"><br><br>' +
    "<label>Notes</label><br>" +
    '<input type="text" id="customerNotes" value="' + (row ? (row.notes || "") : "") + '"><br><br>' +
    (row
      ? ('<label style="font-weight:normal;"><input type="checkbox" id="customerActive"' + (row.is_active ? " checked" : "") + '> Active</label><br><br>')
      : ""
    ) +
    '<button id="saveCustomerBtn" class="btn-primary" onclick="saveCustomer(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveCustomerStatus" class="save-status"></span>'
  );
}

function saveCustomer(code) {
  const name = document.getElementById("customerName").value.trim();
  if (!name) { alert("Please enter a customer name."); return; }

  const body = {
    name: name,
    contact: document.getElementById("customerContact").value.trim(),
    area: document.getElementById("customerArea").value.trim(),
    address: document.getElementById("customerAddress").value.trim(),
    notes: document.getElementById("customerNotes").value.trim()
  };
  if (code) body.isActive = document.getElementById("customerActive").checked;

  const btn = document.getElementById("saveCustomerBtn");
  const statusEl = document.getElementById("saveCustomerStatus");

  withSaveStatus(btn, statusEl, "Customer", async function () {
    if (code) await api("customers/" + encodeURIComponent(code), { method: "PATCH", body: body });
    else await api("customers", { method: "POST", body: body });
    closeModal();
    await renderCustomerSection(document.getElementById("databaseSectionWrap"));
  });
}

function deleteCustomer(code) {
  openConfirmModal({
    title: "Delete this customer?",
    body: "This can't be undone.",
    confirmLabel: "Delete Customer",
    danger: true,
    onConfirm: async function () {
      await api("customers/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await renderCustomerSection(document.getElementById("databaseSectionWrap"));
    }
  });
}

// ================================================================
// Staff
// ================================================================

let _lastStaffRows = [];
let _staffRoleOptions = [];
let _staffSort = "role-priority";
let _staffRoleFilter = []; // empty = show every Role (default)
let _staffStatusFilter = ["Active"]; // defaults to Active only, per explicit request - "All" is still reachable via Filter & Sort

const STAFF_SORT_LABELS = {
  "role-priority": "Role Priority (default)",
  "name-asc": "Name (A-Z)",
  "name-desc": "Name (Z-A)"
};

async function renderStaffSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0; flex-wrap:wrap; gap:8px;">' +
      "<h3>Staff List</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="staffFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openStaffFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openStaffModal(null)">+ Add Staff</button>' +
      "</div>" +
    "</div>" +
    '<div id="staffPaginationNav" class="pagination-nav"></div>' +
    '<div id="staffScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Name</th><th>Role(s)</th><th>Contact</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="staffTbody"><tr><td colspan="5">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  const [staffRows, settingsData] = await Promise.all([api("staff"), api("settings")]);
  _lastStaffRows = staffRows;
  _staffRoleOptions = settingsData.lists["Staff Roles"] || [];

  if (!document.getElementById("staffTbody")) return;
  renderStaffTable();
}

function sortStaffRows(rows, sortKey) {
  if (sortKey === "name-asc") return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (sortKey === "name-desc") return rows.slice().sort((a, b) => b.name.localeCompare(a.name));
  return sortStaffRowsByRolePriority(rows);
}

function filterStaffRows(rows) {
  return rows.filter((r) => {
    const matchesRole = !_staffRoleFilter.length || (r.roles || []).some((role) => _staffRoleFilter.indexOf(role) !== -1);
    const matchesStatus = !_staffStatusFilter.length || _staffStatusFilter.indexOf(r.is_active ? "Active" : "Inactive") !== -1;
    return matchesRole && matchesStatus;
  });
}

function renderStaffTable() {
  const badge = document.getElementById("staffFilterSortBadge");
  if (badge) {
    const parts = [].concat(_staffRoleFilter, _staffStatusFilter);
    badge.textContent = (parts.length ? parts.join(", ") : "All") + " | " + STAFF_SORT_LABELS[_staffSort];
  }

  const tbody = document.getElementById("staffTbody");
  if (!tbody) return;
  const rows = sortStaffRows(filterStaffRows(_lastStaffRows), _staffSort);
  tbody.innerHTML = rows.length ? rows.map(staffRowHtml).join("") : '<tr><td colspan="5">No staff match this filter.</td></tr>';
  paginateTable("staffTbody", "staffPaginationNav", 20);
  enableDragScroll(document.getElementById("staffScrollWrap"));
}

function openStaffFilterSortModal() {
  const roleChecks = _staffRoleOptions.map((r) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="staffRoleFilterCheck" value="' + r + '"' + (_staffRoleFilter.indexOf(r) !== -1 ? " checked" : "") + "> " + r + "</label>"
  ).join("");
  const sortOptions = [["role-priority", "Role Priority (default)"], ["name-asc", "Name (A-Z)"], ["name-desc", "Name (Z-A)"]];
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="staffSortOption" value="' + val + '"' + (_staffSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Staff List</h2>" +
    "<label>Role</label>" +
    "<div>" + roleChecks + "</div><br>" +
    "<label>Status</label>" +
    "<div>" + statusFilterCheckboxesHtml("staffStatusFilterCheck", _staffStatusFilter) + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyStaffFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyStaffFilterSort() {
  _staffRoleFilter = Array.from(document.querySelectorAll(".staffRoleFilterCheck:checked")).map((cb) => cb.value);
  _staffStatusFilter = Array.from(document.querySelectorAll(".staffStatusFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="staffSortOption"]:checked');
  if (selectedSort) _staffSort = selectedSort.value;
  closeModal();
  renderStaffTable();
}

// Default (only) Staff order: by role priority, where priority = the
// earliest position of any of a staff's roles within _staffRoleOptions
// (itself ordered by settings_lists.sort_order - see Settings > Staff Roles'
// Arrange feature). Staff with no roles, or roles no longer in the list,
// sort last; ties break alphabetically by name.
function staffRolePriority(roles) {
  if (!roles || !roles.length) return Infinity;
  let min = Infinity;
  roles.forEach((role) => {
    const idx = _staffRoleOptions.indexOf(role);
    if (idx !== -1 && idx < min) min = idx;
  });
  return min;
}

function sortStaffRowsByRolePriority(rows) {
  return rows.slice().sort((a, b) => {
    const diff = staffRolePriority(a.roles) - staffRolePriority(b.roles);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

function staffRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.staff_code + "</span></td>" +
      "<td>" + (r.roles || []).join(", ") + "</td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openStaffModal(\'' + r.staff_code + '\')">Edit</button> ' +
      '<button class="btn-compact" onclick="deleteStaff(\'' + r.staff_code + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function staffRoleCheckboxesHtml(selectedRoles) {
  selectedRoles = selectedRoles || [];
  return _staffRoleOptions.map((role) =>
    '<label style="display:inline-flex; align-items:center; gap:4px; font-weight:normal; margin-right:12px;">' +
      '<input type="checkbox" class="staffRoleCheck" value="' + role + '"' + (selectedRoles.indexOf(role) !== -1 ? " checked" : "") + "> " + role +
    "</label>"
  ).join("");
}

const STAFF_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function staffScheduledDaysCheckboxesHtml(selectedDays) {
  selectedDays = selectedDays && selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6];
  return STAFF_WEEKDAY_LABELS.map((label, idx) =>
    '<label style="display:inline-flex; align-items:center; gap:4px; font-weight:normal; margin-right:12px;">' +
      '<input type="checkbox" class="staffScheduledDayCheck" value="' + idx + '"' + (selectedDays.indexOf(idx) !== -1 ? " checked" : "") + "> " + label +
    "</label>"
  ).join("");
}

function openStaffModal(code) {
  const row = code ? _lastStaffRows.find((r) => r.staff_code === code) : null;

  openModal(
    "<h2>" + (code ? "Edit Staff - " + code : "Add Staff") + "</h2>" +
    "<label>Name</label><br>" +
    '<input type="text" id="staffName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Role(s)</label><br>" +
    '<p style="font-size:12px; color:var(--color-text-muted);">Roles themselves are managed on the Settings page.</p>' +
    '<div id="staffRoleChecks">' + staffRoleCheckboxesHtml(row ? row.roles : []) + "</div><br>" +
    "<label>Contact</label><br>" +
    '<input type="text" id="staffContact" value="' + (row ? (row.contact || "") : "") + '"><br><br>' +
    "<label>Employment Type</label><br>" +
    '<select id="staffEmploymentType">' +
      ["Monthly", "Daily"].map((t) => "<option" + (row && row.employment_type === t ? " selected" : "") + ">" + t + "</option>").join("") +
    "</select><br><br>" +
    "<label>Base Rate</label><br>" +
    '<p style="font-size:12px; color:var(--color-text-muted); margin:0 0 4px;">Monthly salary, or daily rate if Employment Type is Daily.</p>' +
    '<input type="text" id="staffBaseRate" inputmode="numeric" value="' + (row ? formatRupiah(row.base_rate || 0) : "") + '" oninput="formatAmount(this)"><br><br>' +
    "<label>Join Date</label><br>" +
    '<input type="date" id="staffJoinDate" value="' + (row ? (row.join_date || "") : "") + '"><br><br>' +
    "<label>Scheduled Days</label><br>" +
    '<p style="font-size:12px; color:var(--color-text-muted); margin:0 0 4px;">Days this staff is expected to work - used by Attendance/Payroll. Defaults to every day.</p>' +
    '<div id="staffScheduledDayChecks">' + staffScheduledDaysCheckboxesHtml(row ? row.scheduled_days : null) + "</div><br>" +
    (row
      ? ('<label style="font-weight:normal;"><input type="checkbox" id="staffActive"' + (row.is_active ? " checked" : "") + '> Active</label><br><br>')
      : ""
    ) +
    '<button id="saveStaffBtn" class="btn-primary" onclick="saveStaff(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveStaffStatus" class="save-status"></span>'
  );
}

function saveStaff(code) {
  const name = document.getElementById("staffName").value.trim();
  if (!name) { alert("Please enter a staff name."); return; }

  const roles = Array.from(document.querySelectorAll(".staffRoleCheck:checked")).map((cb) => cb.value);
  const scheduledDays = Array.from(document.querySelectorAll(".staffScheduledDayCheck:checked")).map((cb) => Number(cb.value));
  const body = {
    name: name,
    roles: roles,
    contact: document.getElementById("staffContact").value.trim(),
    employmentType: document.getElementById("staffEmploymentType").value,
    baseRate: parseAmount(document.getElementById("staffBaseRate").value),
    joinDate: document.getElementById("staffJoinDate").value || null,
    scheduledDays: scheduledDays
  };
  if (code) body.isActive = document.getElementById("staffActive").checked;

  const btn = document.getElementById("saveStaffBtn");
  const statusEl = document.getElementById("saveStaffStatus");

  withSaveStatus(btn, statusEl, "Staff", async function () {
    if (code) await api("staff/" + encodeURIComponent(code), { method: "PATCH", body: body });
    else await api("staff", { method: "POST", body: body });
    closeModal();
    await renderStaffSection(document.getElementById("databaseSectionWrap"));
  });
}

function deleteStaff(code) {
  openConfirmModal({
    title: "Delete this staff record?",
    body: "This can't be undone.",
    confirmLabel: "Delete Staff",
    danger: true,
    onConfirm: async function () {
      await api("staff/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await renderStaffSection(document.getElementById("databaseSectionWrap"));
    }
  });
}
