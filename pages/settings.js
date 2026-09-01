// Settings - General (key/value scalars) + option Lists (Payment Method,
// Sales Platform, PnL Categories, Staff Roles). Ported loosely from the old
// app's 08 Settings page: same General keys and mostly the same lists, but
// Add/Edit uses this app's modal pattern (not the old app's inline chip-row
// editing). "Stockable Types" and "Manual Sales Platform Exclude" are
// intentionally not here - see functions/api/settings.js's comment.
//
// Sales Platform and PnL Categories carry a per-item `meta` tag (see
// LIST_META_OPTIONS) instead of being split into separate lists - Sales
// Platform used to have a second "Platforms Using Platform Price" list that
// was just a manually-kept-in-sync subset of this one; PnL Fixed Categories
// used to only ever hold fixed ones. One list per concept, meta on each row
// for the rest, is less to keep in sync than a second list.
registerPage("settings", renderSettingsPage);

let _lastSettingsData = null;

const SETTINGS_LIST_SPECS = ["Payment Method", "Sales Platform", "PnL Categories", "Cashflow Category", "Staff Roles"];

const LIST_META_OPTIONS = {
  "Sales Platform": { label: "Pricing", options: ["Base Pricing", "Platform Pricing"], default: "Base Pricing" },
  "PnL Categories": { label: "Type", options: ["Fixed", "Variable"], default: "Fixed" },
  // Free-number type (not a fixed options list, like every other entry
  // here) - HR > Attendance's staff_shifts.role looks this up per shift to
  // pay Daily-rate staff, since rate now depends on which role they covered
  // that day rather than being one flat number per staff (see staff.js's
  // base_rate, which only Monthly staff still use).
  "Staff Roles": { label: "Daily Rate", type: "number", default: "0" },
  // Type and Flow folded into one tag (settings_lists only has one `meta`
  // column per row) - drives both functions/api/cashflow.js's flow-direction
  // logic (In/Out, parsed back out of this string) and pages/cashflow.js's
  // Input Transaction form (Category -> auto-filled Type display).
  "Cashflow Category": {
    label: "Type / Flow",
    options: ["Operating - IN", "Operating - OUT", "Financing - IN", "Financing - OUT", "Investing - IN", "Investing - OUT"],
    default: "Operating - OUT"
  }
};

async function renderSettingsPage(content) {
  content.innerHTML =
    "<h2>Settings</h2>" +
    "<p>Global config used across the app - Payment Method, Sales Platform, Staff Roles, and similar option lists.</p>" +
    '<div id="settingsGeneralWrap" style="margin-bottom:32px;"><p>Loading...</p></div>' +
    '<div id="manageCalendarWrap" style="margin-bottom:32px;"></div>' +
    '<div id="settingsListsWrap"></div>' +
    '<div id="skuConfigWrap"></div>';

  _lastSettingsData = await api("settings");
  if (!document.getElementById("settingsGeneralWrap")) return;

  renderGeneralSettings();
  renderManageCalendarSection();
  renderAllSettingsLists();
  renderSkuConfigSection();
}

// ---------- Calendar (imports a holiday calendar straight into HR >
// Attendance's Outlet Closures - see functions/api/national-holidays.js).
// Page itself stays read-only, same convention as Outlet Hours (pages/
// hr.js) - editing lives in the Manage Calendar modal only. Only one
// source (Indonesia's national calendar) for now - CALENDAR_SOURCES left
// as a list since a second source is a plausible follow-up. ----------

const CALENDAR_SOURCES = { "id-national": "Indonesia National" };

let _manageCalendarEventsList = [];

function renderManageCalendarSection() {
  const wrap = document.getElementById("manageCalendarWrap");
  if (!wrap) return;

  wrap.innerHTML =
    "<h3>Calendar</h3>" +
    '<table style="max-width:300px;"><thead><tr><th>Source</th></tr></thead><tbody><tr><td>' + CALENDAR_SOURCES["id-national"] + "</td></tr></tbody></table>" +
    '<div style="margin-top:8px;"><button onclick="openManageCalendarModal()">Manage Calendar</button></div>';
}

async function openManageCalendarModal() {
  renderManageCalendarModal();
  _manageCalendarEventsList = await api("calendar-events");
  renderManageCalendarBatchesList();
}

function renderManageCalendarModal() {
  const thisYear = new Date().getFullYear();

  openModal(
    "<h2>Manage Calendar</h2>" +
    "<label>Source</label><br>" +
    '<select id="manageCalendarSource">' +
      Object.entries(CALENDAR_SOURCES).map(([val, label]) => '<option value="' + val + '">' + label + "</option>").join("") +
    "</select><br><br>" +
    "<label>Year</label><br>" +
    '<input type="number" id="nationalHolidaysYear" value="' + thisYear + '" style="width:100px;"><br><br>' +
    '<button id="importNationalHolidaysBtn" class="btn-primary" onclick="importNationalHolidays()">Import</button>' +
    '<span id="importNationalHolidaysStatus" class="save-status"></span><br><br>' +
    "<label>Imported</label>" +
    '<table style="width:100%;"><thead><tr><th>Source</th><th>Year</th><th>Events</th><th></th></tr></thead>' +
      '<tbody id="manageCalendarBatchesTbody"><tr><td colspan="4">Loading...</td></tr></tbody>' +
    "</table>"
  );
}

// Grouped by (source, year) - a whole import run, not individual days -
// per explicit request ("yg imported jadi list si calendarnya, bukan
// hari2nya"). Deleting a batch removes every event that import created.
function calendarBatches() {
  const map = {};
  _manageCalendarEventsList.forEach((e) => {
    const key = e.source + "|" + e.year;
    if (!map[key]) map[key] = { source: e.source, year: e.year, count: 0 };
    map[key].count++;
  });
  return Object.values(map).sort((a, b) => b.year - a.year);
}

function renderManageCalendarBatchesList() {
  const tbody = document.getElementById("manageCalendarBatchesTbody");
  if (!tbody) return;
  const batches = calendarBatches();
  tbody.innerHTML = batches.length
    ? batches.map((b) =>
        "<tr><td>" + (CALENDAR_SOURCES[b.source] || b.source) + "</td><td>" + b.year + "</td><td>" + b.count + "</td>" +
        '<td class="compact-cell">' + calendarBatchActionsHtml(b.source, b.year) + "</td></tr>"
      ).join("")
    : '<tr><td colspan="4" style="color:var(--color-text-muted); font-size:12px;">None imported yet.</td></tr>';
}

// Inline expand-in-place confirm, not openConfirmModal - this row lives
// inside the already-open Manage Calendar modal, and openModal() always
// closes whatever modal is currently open before showing a new one, so a
// stacked confirm modal would discard this one from underneath even on
// Cancel (same reasoning as settingsListActionsHtml above).
function calendarBatchActionsHtml(source, year) {
  return '<button class="btn-compact" onclick="confirmRemoveCalendarBatch(this, \'' + source + "', " + year + ')">Delete</button>';
}

function confirmRemoveCalendarBatch(btn, source, year) {
  btn.closest("td").innerHTML =
    '<span style="color:#b00020; font-size:11px; display:block; margin-bottom:4px;">Remove all ' + year + ' events?</span>' +
    '<button class="btn-compact" style="color:#b00020;" onclick="removeCalendarBatch(\'' + source + "', " + year + ', this)">Yes, Remove</button> ' +
    '<button class="btn-compact" onclick="cancelRemoveCalendarBatch(this, \'' + source + "', " + year + ')">Cancel</button>' +
    '<span class="save-status" style="display:block;"></span>';
}

function cancelRemoveCalendarBatch(btn, source, year) {
  btn.closest("td").innerHTML = calendarBatchActionsHtml(source, year);
}

function removeCalendarBatch(source, year, btn) {
  const statusEl = btn.closest("td").querySelector(".save-status");

  withSaveStatus(btn, statusEl, "Removal", async function () {
    await api("calendar-events?source=" + encodeURIComponent(source) + "&year=" + year, { method: "DELETE" });
    _manageCalendarEventsList = await api("calendar-events");
    renderManageCalendarBatchesList();
  });
}

function importNationalHolidays() {
  const year = Number(document.getElementById("nationalHolidaysYear").value);
  if (!year) { alert("Please enter a year."); return; }

  const btn = document.getElementById("importNationalHolidaysBtn");
  const statusEl = document.getElementById("importNationalHolidaysStatus");

  withSaveStatus(btn, statusEl, "Import", async function () {
    const result = await api("national-holidays", { method: "POST", body: { year: year } });
    alert("Imported " + result.imported + " of " + result.total + " holidays for " + year + (result.skipped ? " (" + result.skipped + " already had a closure)." : "."));
  });
}

// ---------- General ----------

function renderGeneralSettings() {
  const wrap = document.getElementById("settingsGeneralWrap");
  wrap.innerHTML =
    "<h3>General</h3>" +
    "<table style=\"max-width:500px;\">" +
      "<thead><tr><th>Setting</th><th>Value</th></tr></thead>" +
      '<tbody>' + _lastSettingsData.general.map(generalRowHtml).join("") + "</tbody>" +
    "</table>" +
    '<div style="margin-top:8px;"><button onclick="openManageGeneralSettingsModal()">Manage General Settings</button></div>';
}

function generalRowHtml(row) {
  return "<tr><td>" + row.key + "</td><td>" + row.value + "</td></tr>";
}

function openManageGeneralSettingsModal() {
  openModal(
    "<h2>Manage General Settings</h2>" +
    _lastSettingsData.general.map((row) =>
      "<label>" + row.key + "</label><br>" +
      '<input type="text" class="generalSettingInput" data-key="' + row.key.replace(/"/g, "&quot;") + '" value="' + row.value + '" style="width:100%;"><br><br>'
    ).join("") +
    '<button id="saveGeneralSettingsBtn" class="btn-primary" onclick="saveAllGeneralSettings()">Save</button>' +
    '<span id="saveGeneralSettingsStatus" class="save-status"></span>'
  );
}

function saveAllGeneralSettings() {
  const inputs = Array.from(document.querySelectorAll(".generalSettingInput"));
  for (const input of inputs) {
    if (!input.value.trim()) { alert("Please enter a value for " + input.dataset.key + "."); return; }
  }

  const changed = inputs
    .map((input) => ({ key: input.dataset.key, value: input.value.trim() }))
    .filter((c) => {
      const original = _lastSettingsData.general.find((r) => r.key === c.key);
      return !original || original.value !== c.value;
    });

  const btn = document.getElementById("saveGeneralSettingsBtn");
  const statusEl = document.getElementById("saveGeneralSettingsStatus");

  withSaveStatus(btn, statusEl, "Settings", async function () {
    await Promise.all(changed.map((c) => api("settings/" + encodeURIComponent(c.key), { method: "PATCH", body: { value: c.value } })));
    closeModal();
    _lastSettingsData = await api("settings");
    renderGeneralSettings();
    renderAllSettingsLists();
  });
}

// ---------- Lists ----------

function listSafeId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, "");
}

function renderAllSettingsLists() {
  const wrap = document.getElementById("settingsListsWrap");
  wrap.innerHTML = SETTINGS_LIST_SPECS.map((listName) => {
    const metaSpec = LIST_META_OPTIONS[listName];
    return (
      '<div class="settings-list-section" style="margin-bottom:28px;">' +
        "<h3>" + listName + "</h3>" +
        '<table style="max-width:420px;"><thead><tr><th>Value</th>' + (metaSpec ? ("<th>" + metaSpec.label + "</th>") : "") + "</tr></thead>" +
          '<tbody id="settingsList-' + listSafeId(listName) + '"></tbody>' +
        "</table>" +
        '<div style="margin-top:8px;"><button onclick="openManageSettingsListModal(\'' + listName.replace(/'/g, "\\'") + '\')">Manage ' + listName + "</button></div>" +
      "</div>"
    );
  }).join("");

  SETTINGS_LIST_SPECS.forEach((listName) => renderSettingsListBody(listName));
}

function renderSettingsListBody(listName) {
  const tbody = document.getElementById("settingsList-" + listSafeId(listName));
  if (!tbody) return;

  const items = _lastSettingsData.lists[listName] || [];
  const metaMap = _lastSettingsData.listsMeta[listName] || {};
  const metaSpec = LIST_META_OPTIONS[listName];

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="' + (metaSpec ? 2 : 1) + '" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((value) =>
    "<tr><td>" + value + "</td>" + (metaSpec ? ('<td style="color:var(--color-text-muted); font-size:12px;">' + metaDisplayHtml(metaSpec, metaMap[value]) + "</td>") : "") + "</tr>"
  ).join("");
}

// ---------- Manage-list modal (add/rename/remove, all in one place - see
// point 5: per-row page buttons were replaced by this single modal per
// list), plus an Arrange control for every list (all four drive real
// dropdown/row order elsewhere via sort_order: Database > Staff's role-
// priority sort for Staff Roles, and every Payment Method/Sales Platform/
// PnL Categories dropdown app-wide, since lookups.js/settings.js both read
// these lists via .order("sort_order")). ----------

let _manageListName = null;
let _manageListArrangeMode = false;
let _manageListArrangeRows = [];

const ARRANGEABLE_LISTS = ["Staff Roles", "Payment Method", "Sales Platform", "PnL Categories"];

function openManageSettingsListModal(listName) {
  _manageListName = listName;
  _manageListArrangeMode = false;
  renderManageSettingsListModal();
}

function renderManageSettingsListModal() {
  const listName = _manageListName;
  const items = _lastSettingsData.lists[listName] || [];
  const metaMap = _lastSettingsData.listsMeta[listName] || {};
  const metaSpec = LIST_META_OPTIONS[listName];
  const canArrange = ARRANGEABLE_LISTS.indexOf(listName) !== -1;
  const arranging = _manageListArrangeMode;
  const rows = arranging ? _manageListArrangeRows : items;

  const addFieldHtml =
    '<input type="text" id="newSettingsListValue" placeholder="New value"> ' +
    (metaSpec ? (metaFieldInputHtml(metaSpec, "newSettingsListMeta", metaSpec.default) + " ") : "");

  const rowsHtml = rows.length
    ? rows.map((value, i) => manageListRowHtml(value, i, arranging, rows.length, metaMap, metaSpec)).join("")
    : '<tr><td colspan="4" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>';

  openModal(
    "<h2>Manage " + listName + "</h2>" +
    (arranging ? "" :
      ('<div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">' +
        addFieldHtml +
        '<button id="addSettingsListItemBtn" class="btn-primary" onclick="addSettingsListItem()">+ Add</button>' +
        '<span id="addSettingsListItemStatus" class="save-status"></span>' +
      "</div>")
    ) +
    '<table style="max-width:480px; width:100%;"><tbody id="manageSettingsListTbody">' + rowsHtml + "</tbody></table>" +
    (canArrange
      ? ('<div style="margin-top:12px;">' +
          (arranging
            ? '<button onclick="cancelArrangeSettingsList()">Cancel</button> <button onclick="saveArrangeSettingsList()">Save Order</button> <span id="arrangeSettingsListStatus" class="save-status"></span>'
            : '<button onclick="startArrangeSettingsList()">Arrange</button>') +
        "</div>")
      : ""
    )
  );
}

// Free-number meta (Staff Roles' Daily Rate) vs. the original fixed-options
// dropdown (Sales Platform/PnL Categories/Cashflow Category) - same `meta`
// text column either way, just a different input widget and (for display)
// Rupiah formatting instead of the raw string.
function metaFieldInputHtml(metaSpec, id, currentValue) {
  if (metaSpec.type === "number") {
    return '<input type="number" id="' + id + '" value="' + (currentValue || metaSpec.default || "0") + '" style="width:120px;">';
  }
  return '<select id="' + id + '">' + metaSpec.options.map((o) => "<option" + (o === currentValue ? " selected" : "") + ">" + o + "</option>").join("") + "</select>";
}

function metaDisplayHtml(metaSpec, rawValue) {
  if (metaSpec.type === "number") return formatRupiah(Number(rawValue || 0));
  return rawValue || "";
}

function manageListRowHtml(value, index, arranging, total, metaMap, metaSpec) {
  const escaped = value.replace(/'/g, "\\'");

  const moveCell = arranging
    ? ("<td>" +
        '<button style="font-size:12px;" onclick="moveSettingsListOrder(' + index + ', \'up\')"' + (index === 0 ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:12px;" onclick="moveSettingsListOrder(' + index + ', \'down\')"' + (index === total - 1 ? " disabled" : "") + '>&#9660;</button>' +
      "</td>")
    : "";

  const metaCell = metaSpec ? ('<td style="color:var(--color-text-muted); font-size:12px;">' + metaDisplayHtml(metaSpec, metaMap[value]) + "</td>") : "";

  const actionsCell = arranging
    ? ""
    : ('<td class="compact-cell">' + settingsListActionsHtml(escaped) + "</td>");

  return "<tr>" + moveCell + "<td>" + value + "</td>" + metaCell + actionsCell + "</tr>";
}

// Inline expand-in-place confirm, not openConfirmModal - this row lives
// inside the already-open Manage List modal, and openModal() always closes
// whatever modal is currently open before showing a new one, so a stacked
// confirm modal would discard this one from underneath even on Cancel.
// Same reasoning as sales.js's batchDeleteTriggerHtml.
function settingsListActionsHtml(escaped) {
  return (
    '<button class="btn-compact" onclick="openEditSettingsListItem(\'' + escaped + '\')">Edit</button> ' +
    '<button class="btn-compact" onclick="confirmRemoveSettingsListItem(this, \'' + escaped + '\')">Remove</button>'
  );
}

function confirmRemoveSettingsListItem(btn, escaped) {
  btn.closest("td").innerHTML =
    '<span style="color:#b00020; font-size:11px; display:block; margin-bottom:4px;">Remove? Won\'t affect existing records.</span>' +
    '<button class="btn-compact" style="color:#b00020;" onclick="removeSettingsListItem(\'' + escaped + '\', this)">Yes, Remove</button> ' +
    '<button class="btn-compact" onclick="cancelRemoveSettingsListItem(this, \'' + escaped + '\')">Cancel</button>' +
    '<span class="save-status" style="display:block;"></span>';
}

function cancelRemoveSettingsListItem(btn, escaped) {
  btn.closest("td").innerHTML = settingsListActionsHtml(escaped);
}

// Takes the same (unescaped-quote) string openEditSettingsListItem above
// does - matches its existing convention rather than introducing a new one.
function removeSettingsListItem(value, btn) {
  const listName = _manageListName;
  const statusEl = btn.closest("td").querySelector(".save-status");

  withSaveStatus(btn, statusEl, "Removal", async function () {
    await api("settings-lists", { method: "DELETE", body: { listName: listName, value: value } });
    _lastSettingsData = await api("settings");
    renderManageSettingsListModal();
    renderAllSettingsLists();
  });
}

function addSettingsListItem() {
  const listName = _manageListName;
  const metaSpec = LIST_META_OPTIONS[listName];
  const value = document.getElementById("newSettingsListValue").value.trim();
  if (!value) { alert("Please enter a value."); return; }

  const body = { listName: listName, value: value };
  if (metaSpec) body.meta = document.getElementById("newSettingsListMeta").value;

  const btn = document.getElementById("addSettingsListItemBtn");
  const statusEl = document.getElementById("addSettingsListItemStatus");

  withSaveStatus(btn, statusEl, listName, async function () {
    await api("settings-lists", { method: "POST", body: body });
    _lastSettingsData = await api("settings");
    renderManageSettingsListModal();
    renderAllSettingsLists();
  });
}

function openEditSettingsListItem(oldValue) {
  const listName = _manageListName;
  const metaSpec = LIST_META_OPTIONS[listName];
  const currentMeta = (_lastSettingsData.listsMeta[listName] || {})[oldValue] || (metaSpec ? metaSpec.default : null);

  openModal(
    "<h2>Edit " + listName + "</h2>" +
    "<label>Value</label><br>" +
    '<input type="text" id="editSettingsListValue" value="' + oldValue + '"><br><br>' +
    (metaSpec
      ? ("<label>" + metaSpec.label + "</label><br>" + metaFieldInputHtml(metaSpec, "editSettingsListMeta", currentMeta) + "<br><br>")
      : ""
    ) +
    '<button id="editSettingsListItemBtn" onclick="saveEditSettingsListItem(\'' + oldValue.replace(/'/g, "\\'") + '\')">Save</button> ' +
    '<button onclick="renderManageSettingsListModal()">Cancel</button>' +
    '<span id="editSettingsListItemStatus" class="save-status"></span>'
  );
}

function saveEditSettingsListItem(oldValue) {
  const listName = _manageListName;
  const metaSpec = LIST_META_OPTIONS[listName];
  const newValue = document.getElementById("editSettingsListValue").value.trim();
  if (!newValue) { alert("Please enter a value."); return; }

  const body = { listName: listName, oldValue: oldValue, newValue: newValue };
  if (metaSpec) body.meta = document.getElementById("editSettingsListMeta").value;

  const btn = document.getElementById("editSettingsListItemBtn");
  const statusEl = document.getElementById("editSettingsListItemStatus");

  withSaveStatus(btn, statusEl, listName, async function () {
    await api("settings-lists", { method: "PATCH", body: body });
    _lastSettingsData = await api("settings");
    renderManageSettingsListModal();
    renderAllSettingsLists();
  });
}

// ---------- Arrange (Staff Roles only) - same "stage moves locally, save
// once" pattern as Menu Engineering > Pricing / Database > SKU. ----------

function startArrangeSettingsList() {
  _manageListArrangeMode = true;
  _manageListArrangeRows = (_lastSettingsData.lists[_manageListName] || []).slice();
  renderManageSettingsListModal();
}

function cancelArrangeSettingsList() {
  _manageListArrangeMode = false;
  renderManageSettingsListModal();
}

function moveSettingsListOrder(index, direction) {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= _manageListArrangeRows.length) return;

  const tmp = _manageListArrangeRows[index];
  _manageListArrangeRows[index] = _manageListArrangeRows[targetIndex];
  _manageListArrangeRows[targetIndex] = tmp;

  renderManageSettingsListModal();
}

function saveArrangeSettingsList() {
  const listName = _manageListName;
  const btn = document.querySelector('button[onclick="saveArrangeSettingsList()"]');
  const statusEl = document.getElementById("arrangeSettingsListStatus");

  withSaveStatus(btn, statusEl, "Order", async function () {
    await api("settings-lists-order", { method: "POST", body: { listName: listName, values: _manageListArrangeRows } });
    _manageListArrangeMode = false;
    _lastSettingsData = await api("settings");
    renderManageSettingsListModal();
    renderAllSettingsLists();
  });
}

// ---------- SKU Configuration ----------
// Type Codes + per-Type Category Codes + Unit Codes - these three settings_
// lists are what Database > SKU > Add SKU actually reads to auto-generate a
// new SKU's code (TYPE-CATEGORY-NNNN, see functions/api/sku-items.js), not
// derived from existing SKUs. SKU_TYPES is database.js's constant (loaded
// before this file - see index.html's script order), not redefined here to
// avoid the two drifting apart.
// Type Codes is edit-only (PATCH, no add/remove) - the 6 types themselves
// are a fixed set hardcoded across the app (Database > SKU's own tabs), so
// "adding a 7th type" here wouldn't do anything useful; Category/Unit Codes
// are freely addable/removable since their values aren't fixed.

let _skuConfigCategoryType = SKU_TYPES[0];

function renderSkuConfigSection() {
  const wrap = document.getElementById("skuConfigWrap");
  if (!wrap) return;
  const typeMeta = _lastSettingsData.listsMeta["SKU Type Code"] || {};
  const unitItems = _lastSettingsData.lists["SKU Unit Code"] || [];
  const unitMeta = _lastSettingsData.listsMeta["SKU Unit Code"] || {};

  // Category rows flattened across every Type into one Type/Category/Code
  // table (each Type's own list stays separate in settings_lists/the Manage
  // modal - this is just a combined read-only preview).
  const categoryRows = [];
  SKU_TYPES.forEach((t) => {
    const items = _lastSettingsData.lists["SKU Category Code - " + t] || [];
    const meta = _lastSettingsData.listsMeta["SKU Category Code - " + t] || {};
    items.forEach((c) => categoryRows.push({ type: t, category: c, code: meta[c] || "" }));
  });

  wrap.innerHTML =
    '<div class="settings-list-section" style="margin-bottom:28px;">' +
      "<h3>SKU Configuration</h3>" +
      '<p style="font-size:12px; color:var(--color-text-muted); max-width:600px;">Type/Category/Unit codes used to auto-generate new SKU codes in Database &gt; SKU &gt; Add SKU.</p>' +

      // Indented so these three read as sub-parts of SKU Configuration,
      // not as their own top-level sections at the same visual rank as
      // General/Calendar/each list/SKU Configuration itself.
      '<div style="padding-left:16px;">' +
        "<h4>Type Codes</h4>" +
        '<table style="max-width:300px;"><thead><tr><th>Type</th><th>Code</th></tr></thead><tbody>' +
          SKU_TYPES.map((t) => "<tr><td>" + t + "</td><td style=\"color:var(--color-text-muted); font-size:12px;\">" + (typeMeta[t] || "-") + "</td></tr>").join("") +
        "</tbody></table>" +

        "<h4 style=\"margin-top:16px;\">Category Codes</h4>" +
        '<table style="max-width:420px;"><thead><tr><th>Type</th><th>Category</th><th>Code</th></tr></thead><tbody>' +
          (categoryRows.length
            ? categoryRows.map((r) => "<tr><td>" + r.type + "</td><td>" + r.category + "</td><td style=\"color:var(--color-text-muted); font-size:12px;\">" + (r.code || "-") + "</td></tr>").join("")
            : '<tr><td colspan="3" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>') +
        "</tbody></table>" +

        "<h4 style=\"margin-top:16px;\">Unit Codes</h4>" +
        '<table style="max-width:300px;"><thead><tr><th>Unit</th><th>Code</th></tr></thead><tbody>' +
          (unitItems.length
            ? unitItems.map((u) => "<tr><td>" + u + "</td><td style=\"color:var(--color-text-muted); font-size:12px;\">" + (unitMeta[u] || "-") + "</td></tr>").join("")
            : '<tr><td colspan="2" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>') +
        "</tbody></table>" +
      "</div>" +

      '<div style="margin-top:8px;"><button onclick="openSkuConfigModal()">Manage SKU Config</button></div>' +
    "</div>";
}

function openSkuConfigModal() {
  renderSkuConfigModal();
}

function renderSkuConfigModal() {
  const typeMeta = _lastSettingsData.listsMeta["SKU Type Code"] || {};

  const catType = _skuConfigCategoryType;
  const catListName = "SKU Category Code - " + catType;
  const catItems = _lastSettingsData.lists[catListName] || [];
  const catMeta = _lastSettingsData.listsMeta[catListName] || {};

  const unitItems = _lastSettingsData.lists["SKU Unit Code"] || [];
  const unitMeta = _lastSettingsData.listsMeta["SKU Unit Code"] || {};

  openModal(
    "<h2>Manage SKU Config</h2>" +

    "<h3>Type Codes</h3>" +
    '<table style="max-width:400px;"><thead><tr><th>Type</th><th>Code</th><th></th></tr></thead><tbody>' +
      SKU_TYPES.map(skuTypeCodeRowHtml).join("") +
    "</tbody></table><br>" +

    "<h3>Category Codes</h3>" +
    "<label>Type</label><br>" +
    '<select id="skuConfigCategoryType" onchange="switchSkuConfigCategoryType(this.value)">' +
      SKU_TYPES.map((t) => "<option" + (t === catType ? " selected" : "") + ">" + t + "</option>").join("") +
    "</select><br><br>" +
    '<div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">' +
      '<input type="text" id="newSkuCategoryValue" placeholder="New category"> ' +
      '<input type="text" id="newSkuCategoryCode" placeholder="Code (e.g. AROM)" style="width:110px; text-transform:uppercase;"> ' +
      '<button id="addSkuCategoryBtn" class="btn-primary" onclick="addSkuConfigItem(\'' + catListName.replace(/'/g, "\\'") + '\', \'newSkuCategoryValue\', \'newSkuCategoryCode\', \'addSkuCategoryBtn\', \'addSkuCategoryStatus\')">+ Add</button>' +
      '<span id="addSkuCategoryStatus" class="save-status"></span>' +
    "</div>" +
    '<table style="max-width:400px;"><thead><tr><th>Category</th><th>Code</th><th></th></tr></thead><tbody>' +
      (catItems.length ? catItems.map((v) => skuConfigItemRowHtml(catListName, v, catMeta[v])).join("") : '<tr><td colspan="3" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>') +
    "</tbody></table><br>" +

    "<h3>Unit Codes</h3>" +
    '<div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">' +
      '<input type="text" id="newSkuUnitValue" placeholder="New unit"> ' +
      '<input type="text" id="newSkuUnitCode" placeholder="Code (e.g. g)" style="width:110px;"> ' +
      '<button id="addSkuUnitBtn" class="btn-primary" onclick="addSkuConfigItem(\'SKU Unit Code\', \'newSkuUnitValue\', \'newSkuUnitCode\', \'addSkuUnitBtn\', \'addSkuUnitStatus\')">+ Add</button>' +
      '<span id="addSkuUnitStatus" class="save-status"></span>' +
    "</div>" +
    '<table style="max-width:400px;"><thead><tr><th>Unit</th><th>Code</th><th></th></tr></thead><tbody>' +
      (unitItems.length ? unitItems.map((v) => skuConfigItemRowHtml("SKU Unit Code", v, unitMeta[v])).join("") : '<tr><td colspan="3" style="color:var(--color-text-muted); font-size:12px;">None configured yet.</td></tr>') +
    "</tbody></table>"
  );
}

function skuTypeCodeRowHtml(type) {
  const code = (_lastSettingsData.listsMeta["SKU Type Code"] || {})[type] || "";
  return (
    "<tr><td>" + type + "</td>" +
    '<td><input type="text" class="skuTypeCodeInput" value="' + code + '" style="width:80px; text-transform:uppercase;"></td>' +
    '<td class="compact-cell"><button class="btn-compact" onclick="saveSkuTypeCode(\'' + type + '\', this)">Save</button></td></tr>'
  );
}

function saveSkuTypeCode(type, btn) {
  const code = btn.closest("tr").querySelector(".skuTypeCodeInput").value.trim().toUpperCase();
  if (!code) { alert("Please enter a code."); return; }

  withInlineSaveStatus(btn, "Code", async function () {
    await api("settings-lists", { method: "PATCH", body: { listName: "SKU Type Code", oldValue: type, newValue: type, meta: code } });
    _lastSettingsData = await api("settings");
    renderSkuConfigModal();
    renderSkuConfigSection();
  });
}

function switchSkuConfigCategoryType(type) {
  _skuConfigCategoryType = type;
  renderSkuConfigModal();
}

function skuConfigItemRowHtml(listName, value, code) {
  const escapedValue = value.replace(/'/g, "\\'");
  const escapedList = listName.replace(/'/g, "\\'");
  return (
    "<tr><td>" + value + "</td>" +
    '<td style="color:var(--color-text-muted); font-size:12px;">' + (code || "") + "</td>" +
    '<td class="compact-cell">' + skuConfigActionsHtml(escapedList, escapedValue) + "</td></tr>"
  );
}

// Inline expand-in-place confirm, not openConfirmModal - same reasoning as
// settingsListActionsHtml above (this row lives inside the already-open
// Manage SKU Config modal, and openModal() would discard it from
// underneath even on Cancel).
function skuConfigActionsHtml(escapedList, escapedValue) {
  return (
    '<button class="btn-compact" onclick="openEditSkuConfigItem(\'' + escapedList + '\', \'' + escapedValue + '\')">Edit</button> ' +
    '<button class="btn-compact" onclick="confirmRemoveSkuConfigItem(this, \'' + escapedList + '\', \'' + escapedValue + '\')">Remove</button>'
  );
}

function confirmRemoveSkuConfigItem(btn, escapedList, escapedValue) {
  btn.closest("td").innerHTML =
    '<span style="color:#b00020; font-size:11px; display:block; margin-bottom:4px;">Remove? Add SKU won\'t auto-generate a code for it anymore.</span>' +
    '<button class="btn-compact" style="color:#b00020;" onclick="removeSkuConfigItem(\'' + escapedList + '\', \'' + escapedValue + '\', this)">Yes, Remove</button> ' +
    '<button class="btn-compact" onclick="cancelRemoveSkuConfigItem(this, \'' + escapedList + '\', \'' + escapedValue + '\')">Cancel</button>' +
    '<span class="save-status" style="display:block;"></span>';
}

function cancelRemoveSkuConfigItem(btn, escapedList, escapedValue) {
  btn.closest("td").innerHTML = skuConfigActionsHtml(escapedList, escapedValue);
}

function addSkuConfigItem(listName, valueInputId, codeInputId, btnId, statusId) {
  const value = document.getElementById(valueInputId).value.trim();
  // Category/Type codes are always uppercase (AROM, IN, ...) by convention -
  // Unit codes aren't (a gram's code is "g", not "G"), so only force case
  // for the ones that actually follow that convention.
  const rawCode = document.getElementById(codeInputId).value.trim();
  const code = listName === "SKU Unit Code" ? rawCode : rawCode.toUpperCase();
  if (!value) { alert("Please enter a name."); return; }
  if (!code) { alert("Please enter a code."); return; }

  const btn = document.getElementById(btnId);
  const statusEl = document.getElementById(statusId);

  withSaveStatus(btn, statusEl, "Item", async function () {
    await api("settings-lists", { method: "POST", body: { listName: listName, value: value, meta: code } });
    _lastSettingsData = await api("settings");
    renderSkuConfigModal();
    renderSkuConfigSection();
  });
}

function skuConfigModalTitle(listName) {
  if (listName === "SKU Unit Code") return "Unit";
  return "Category (" + listName.replace("SKU Category Code - ", "") + ")";
}

function openEditSkuConfigItem(listName, oldValue) {
  const meta = (_lastSettingsData.listsMeta[listName] || {})[oldValue] || "";

  openModal(
    "<h2>Edit " + skuConfigModalTitle(listName) + "</h2>" +
    "<label>Name</label><br>" +
    '<input type="text" id="editSkuConfigValue" value="' + oldValue + '"><br><br>' +
    "<label>Code</label><br>" +
    '<input type="text" id="editSkuConfigCode" value="' + meta + '" style="width:110px;' + (listName === "SKU Unit Code" ? "" : " text-transform:uppercase;") + '"><br><br>' +
    '<button id="editSkuConfigBtn" onclick="saveEditSkuConfigItem(\'' + listName.replace(/'/g, "\\'") + '\', \'' + oldValue.replace(/'/g, "\\'") + '\')">Save</button> ' +
    '<button onclick="renderSkuConfigModal()">Cancel</button>' +
    '<span id="editSkuConfigStatus" class="save-status"></span>'
  );
}

function saveEditSkuConfigItem(listName, oldValue) {
  const newValue = document.getElementById("editSkuConfigValue").value.trim();
  const rawCode = document.getElementById("editSkuConfigCode").value.trim();
  const code = listName === "SKU Unit Code" ? rawCode : rawCode.toUpperCase();
  if (!newValue) { alert("Please enter a name."); return; }
  if (!code) { alert("Please enter a code."); return; }

  const btn = document.getElementById("editSkuConfigBtn");
  const statusEl = document.getElementById("editSkuConfigStatus");

  withSaveStatus(btn, statusEl, "Item", async function () {
    await api("settings-lists", { method: "PATCH", body: { listName: listName, oldValue: oldValue, newValue: newValue, meta: code } });
    _lastSettingsData = await api("settings");
    renderSkuConfigModal();
    renderSkuConfigSection();
  });
}

function removeSkuConfigItem(listName, value, btn) {
  const statusEl = btn.closest("td").querySelector(".save-status");

  withSaveStatus(btn, statusEl, "Removal", async function () {
    await api("settings-lists", { method: "DELETE", body: { listName: listName, value: value } });
    _lastSettingsData = await api("settings");
    renderSkuConfigModal();
    renderSkuConfigSection();
  });
}
