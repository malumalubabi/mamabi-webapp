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
function renderSkuTable(wrap) {
  const rows = _skuArrangeMode ? _skuArrangeRows : _lastSkuRows;

  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>SKU Registry - " + _activeSkuType + "</h3>" +
      '<button onclick="openSkuModal(null)">+ Add SKU</button>' +
    "</div>" +
    '<div id="skuPaginationNav" class="pagination-nav"></div>' +
    '<div id="skuScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr>" +
          (_skuArrangeMode ? "<th></th>" : "") +
          "<th>SKU</th><th>Category</th><th>Name</th><th>Unit</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="skuTbody">' + rows.map((r, i) => skuRowHtml(r, i === 0, i === rows.length - 1)).join("") + "</tbody>" +
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

function skuRowHtml(r, isFirst, isLast) {
  const moveCell = _skuArrangeMode
    ? "<td>" +
        '<button style="font-size:11px;" onclick="moveSkuOrder(\'' + r.sku + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:11px;" onclick="moveSkuOrder(\'' + r.sku + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  return (
    "<tr>" +
      moveCell +
      "<td>" + r.sku + "</td>" +
      "<td>" + (r.category || "") + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + r.unit + "</td>" +
      "<td>" + r.status + "</td>" +
      (_skuArrangeMode ? "" :
        ('<td><button onclick="openSkuModal(\'' + r.sku + '\')">Edit</button> ' +
        '<button onclick="deleteSku(\'' + r.sku + '\')">Delete</button></td>')
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

// SKU code/Type/Category are only enterable at Add time (free text, per
// explicit decision - no auto-generation/config system) and locked after
// that (matches the old app's updateSkuItem, which never touched them either).
function openSkuModal(sku) {
  const row = sku ? _lastSkuRows.find((r) => r.sku === sku) : null;

  openModal(
    "<h2>" + (sku ? "Edit SKU - " + sku : "Add SKU - " + _activeSkuType) + "</h2>" +
    (row
      ? ('<p><strong>SKU:</strong> ' + row.sku + ' &nbsp; <strong>Type:</strong> ' + row.item_type + ' &nbsp; <strong>Category:</strong> ' + (row.category || "-") + "</p>")
      : (
          "<label>SKU Code</label><br>" +
          '<input type="text" id="skuCode" placeholder="e.g. IN-PROT-0016" style="text-transform:uppercase;"><br><br>' +
          "<label>Category</label><br>" +
          '<input type="text" id="skuCategory"><br><br>'
        )
    ) +
    "<label>Item Name</label><br>" +
    '<input type="text" id="skuName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Unit</label><br>" +
    '<input type="text" id="skuUnit" value="' + (row ? row.unit : "") + '" style="width:100px;"><br><br>' +
    "<label>Status</label><br>" +
    '<select id="skuStatus">' +
      '<option' + (!row || row.status === "Available" ? " selected" : "") + '>Available</option>' +
      '<option' + (row && row.status === "Unavailable" ? " selected" : "") + '>Unavailable</option>' +
    "</select><br><br>" +
    '<button id="saveSkuBtn" onclick="saveSku(' + (sku ? "'" + sku + "'" : "null") + ')">Save</button>' +
    '<span id="saveSkuStatus" class="save-status"></span>'
  );
}

function saveSku(existingSku) {
  const name = document.getElementById("skuName").value.trim();
  const unit = document.getElementById("skuUnit").value.trim();
  const status = document.getElementById("skuStatus").value;

  if (!name) { alert("Please enter an Item Name."); return; }
  if (!unit) { alert("Please enter a Unit."); return; }

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

  const sku = document.getElementById("skuCode").value.trim().toUpperCase();
  const category = document.getElementById("skuCategory").value.trim();
  if (!sku) { alert("Please enter a SKU code."); return; }

  withSaveStatus(btn, statusEl, "SKU", async function () {
    await api("sku-items", { method: "POST", body: { sku: sku, itemType: _activeSkuType, category: category, name: name, unit: unit, status: status } });
    closeModal();
    await loadSkuType(_activeSkuType);
  });
}

function deleteSku(sku) {
  if (!confirm("Delete SKU " + sku + "? This can't be undone.")) return;

  api("sku-items/" + encodeURIComponent(sku), { method: "DELETE" })
    .then(() => loadSkuType(_activeSkuType))
    .catch((err) => alert(err.message));
}

// ================================================================
// Supplier
// ================================================================

let _lastSupplierRows = [];
let _supplierSort = "name-asc";

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

async function renderSupplierSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>Supplier List</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="supplierSortBadge" style="color:#666; font-size:12px;">Sort: ' + ENTITY_SORT_LABELS[_supplierSort] + "</span>" +
        '<button onclick="openSupplierSortModal()">Sort</button>' +
        '<button onclick="openSupplierModal(null)">+ Add Supplier</button>' +
      "</div>" +
    "</div>" +
    '<div id="supplierPaginationNav" class="pagination-nav"></div>' +
    '<div id="supplierScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Area</th><th>Address</th><th>Notes</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="supplierTbody"><tr><td colspan="8">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  _lastSupplierRows = await api("suppliers");
  if (!document.getElementById("supplierTbody")) return;
  renderSupplierTable();
}

function renderSupplierTable() {
  const badge = document.getElementById("supplierSortBadge");
  if (badge) badge.textContent = "Sort: " + ENTITY_SORT_LABELS[_supplierSort];

  const tbody = document.getElementById("supplierTbody");
  if (!tbody) return;
  const rows = sortEntityRows(_lastSupplierRows, _supplierSort, "supplier_code");
  tbody.innerHTML = rows.map(supplierRowHtml).join("");
  paginateTable("supplierTbody", "supplierPaginationNav", 20);
  enableDragScroll(document.getElementById("supplierScrollWrap"));
}

function openSupplierSortModal() {
  const options = [
    ["name-asc", "Name (A-Z)"], ["name-desc", "Name (Z-A)"],
    ["code-asc", "Code (small-large)"], ["code-desc", "Code (large-small)"],
    ["status-active-first", "Status (Active-Inactive)"], ["status-inactive-first", "Status (Inactive-Active)"]
  ];
  openModal(
    "<h2>Sort Supplier List</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="supplierSortOption" value="' + val + '"' + (_supplierSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applySupplierSort()">Apply</button>'
  );
}

function applySupplierSort() {
  const selected = document.querySelector('input[name="supplierSortOption"]:checked');
  if (!selected) return;
  _supplierSort = selected.value;
  closeModal();
  renderSupplierTable();
}

function supplierRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.supplier_code + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.area || "") + "</td>" +
      "<td>" + (r.address || "") + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td><button onclick="openSupplierModal(\'' + r.supplier_code + '\')">Edit</button> ' +
      '<button onclick="deleteSupplier(\'' + r.supplier_code + '\')">Delete</button></td>' +
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
    '<button id="saveSupplierBtn" onclick="saveSupplier(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
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
  if (!confirm("Delete this supplier? This can't be undone.")) return;

  api("suppliers/" + encodeURIComponent(code), { method: "DELETE" })
    .then(() => renderSupplierSection(document.getElementById("databaseSectionWrap")))
    .catch((err) => alert(err.message));
}

// ================================================================
// Customer
// ================================================================

let _lastCustomerRows = [];
let _customerSort = "name-asc";

async function renderCustomerSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>Customer List</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="customerSortBadge" style="color:#666; font-size:12px;">Sort: ' + ENTITY_SORT_LABELS[_customerSort] + "</span>" +
        '<button onclick="openCustomerSortModal()">Sort</button>' +
        '<button onclick="openCustomerModal(null)">+ Add Customer</button>' +
      "</div>" +
    "</div>" +
    '<div id="customerPaginationNav" class="pagination-nav"></div>' +
    '<div id="customerScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Area</th><th>Address</th><th>Notes</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="customerTbody"><tr><td colspan="8">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  _lastCustomerRows = await api("customers");
  if (!document.getElementById("customerTbody")) return;
  renderCustomerTable();
}

function renderCustomerTable() {
  const badge = document.getElementById("customerSortBadge");
  if (badge) badge.textContent = "Sort: " + ENTITY_SORT_LABELS[_customerSort];

  const tbody = document.getElementById("customerTbody");
  if (!tbody) return;
  const rows = sortEntityRows(_lastCustomerRows, _customerSort, "customer_code");
  tbody.innerHTML = rows.map(customerRowHtml).join("");
  paginateTable("customerTbody", "customerPaginationNav", 20);
  enableDragScroll(document.getElementById("customerScrollWrap"));
}

function openCustomerSortModal() {
  const options = [
    ["name-asc", "Name (A-Z)"], ["name-desc", "Name (Z-A)"],
    ["code-asc", "Code (small-large)"], ["code-desc", "Code (large-small)"],
    ["status-active-first", "Status (Active-Inactive)"], ["status-inactive-first", "Status (Inactive-Active)"]
  ];
  openModal(
    "<h2>Sort Customer List</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="customerSortOption" value="' + val + '"' + (_customerSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyCustomerSort()">Apply</button>'
  );
}

function applyCustomerSort() {
  const selected = document.querySelector('input[name="customerSortOption"]:checked');
  if (!selected) return;
  _customerSort = selected.value;
  closeModal();
  renderCustomerTable();
}

function customerRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.customer_code + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.area || "") + "</td>" +
      "<td>" + (r.address || "") + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td><button onclick="openCustomerModal(\'' + r.customer_code + '\')">Edit</button> ' +
      '<button onclick="deleteCustomer(\'' + r.customer_code + '\')">Delete</button></td>' +
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
    '<button id="saveCustomerBtn" onclick="saveCustomer(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
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
  if (!confirm("Delete this customer? This can't be undone.")) return;

  api("customers/" + encodeURIComponent(code), { method: "DELETE" })
    .then(() => renderCustomerSection(document.getElementById("databaseSectionWrap")))
    .catch((err) => alert(err.message));
}

// ================================================================
// Staff
// ================================================================

let _lastStaffRows = [];
let _staffRoleOptions = [];

async function renderStaffSection(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin:8px 0;">' +
      "<h3>Staff List</h3>" +
      '<button onclick="openStaffModal(null)">+ Add Staff</button>' +
    "</div>" +
    '<div id="staffPaginationNav" class="pagination-nav"></div>' +
    '<div id="staffScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Code</th><th>Name</th><th>Role(s)</th><th>Contact</th><th>Status</th><th></th></tr></thead>" +
        '<tbody id="staffTbody"><tr><td colspan="6">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>";

  const [staffRows, settingsData] = await Promise.all([api("staff"), api("settings")]);
  _lastStaffRows = staffRows;
  _staffRoleOptions = settingsData.lists["Staff Roles"] || [];

  const tbody = document.getElementById("staffTbody");
  if (!tbody) return;
  tbody.innerHTML = sortStaffRowsByRolePriority(_lastStaffRows).map(staffRowHtml).join("");
  paginateTable("staffTbody", "staffPaginationNav", 20);
  enableDragScroll(document.getElementById("staffScrollWrap"));
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
      "<td>" + r.staff_code + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + (r.roles || []).join(", ") + "</td>" +
      "<td>" + formatPhoneDisplay(r.contact) + "</td>" +
      "<td>" + (r.is_active ? "Active" : "Inactive") + "</td>" +
      '<td><button onclick="openStaffModal(\'' + r.staff_code + '\')">Edit</button> ' +
      '<button onclick="deleteStaff(\'' + r.staff_code + '\')">Delete</button></td>' +
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

function openStaffModal(code) {
  const row = code ? _lastStaffRows.find((r) => r.staff_code === code) : null;

  openModal(
    "<h2>" + (code ? "Edit Staff - " + code : "Add Staff") + "</h2>" +
    "<label>Name</label><br>" +
    '<input type="text" id="staffName" value="' + (row ? row.name : "") + '"><br><br>' +
    "<label>Role(s)</label><br>" +
    '<p style="font-size:12px; color:#666;">Roles themselves are managed on the Settings page.</p>' +
    '<div id="staffRoleChecks">' + staffRoleCheckboxesHtml(row ? row.roles : []) + "</div><br>" +
    "<label>Contact</label><br>" +
    '<input type="text" id="staffContact" value="' + (row ? (row.contact || "") : "") + '"><br><br>' +
    (row
      ? ('<label style="font-weight:normal;"><input type="checkbox" id="staffActive"' + (row.is_active ? " checked" : "") + '> Active</label><br><br>')
      : ""
    ) +
    '<button id="saveStaffBtn" onclick="saveStaff(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveStaffStatus" class="save-status"></span>'
  );
}

function saveStaff(code) {
  const name = document.getElementById("staffName").value.trim();
  if (!name) { alert("Please enter a staff name."); return; }

  const roles = Array.from(document.querySelectorAll(".staffRoleCheck:checked")).map((cb) => cb.value);
  const body = {
    name: name,
    roles: roles,
    contact: document.getElementById("staffContact").value.trim()
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
  if (!confirm("Delete this staff record? This can't be undone.")) return;

  api("staff/" + encodeURIComponent(code), { method: "DELETE" })
    .then(() => renderStaffSection(document.getElementById("databaseSectionWrap")))
    .catch((err) => alert(err.message));
}
