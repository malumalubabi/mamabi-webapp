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

const SETTINGS_LIST_SPECS = ["Payment Method", "Sales Platform", "PnL Categories", "Staff Roles"];

const LIST_META_OPTIONS = {
  "Sales Platform": { label: "Pricing", options: ["Base Pricing", "Platform Pricing"], default: "Base Pricing" },
  "PnL Categories": { label: "Type", options: ["Fixed", "Variable"], default: "Fixed" }
};

async function renderSettingsPage(content) {
  content.innerHTML =
    "<h2>Settings</h2>" +
    "<p>Global config used across the app - Payment Method, Sales Platform, Staff Roles, and similar option lists.</p>" +
    '<div id="settingsGeneralWrap" style="margin-bottom:32px;"><p>Loading...</p></div>' +
    '<div id="settingsListsWrap"></div>';

  _lastSettingsData = await api("settings");
  if (!document.getElementById("settingsGeneralWrap")) return;

  renderGeneralSettings();
  renderAllSettingsLists();
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
    '<button id="saveGeneralSettingsBtn" onclick="saveAllGeneralSettings()">Save</button>' +
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
    tbody.innerHTML = '<tr><td colspan="' + (metaSpec ? 2 : 1) + '" style="color:#999; font-size:13px;">None configured yet.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map((value) =>
    "<tr><td>" + value + "</td>" + (metaSpec ? ('<td style="color:#666; font-size:13px;">' + (metaMap[value] || "") + "</td>") : "") + "</tr>"
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
    (metaSpec
      ? ('<select id="newSettingsListMeta">' + metaSpec.options.map((o) => "<option" + (o === metaSpec.default ? " selected" : "") + ">" + o + "</option>").join("") + "</select> ")
      : ""
    );

  const rowsHtml = rows.length
    ? rows.map((value, i) => manageListRowHtml(value, i, arranging, rows.length, metaMap, metaSpec)).join("")
    : '<tr><td colspan="4" style="color:#999; font-size:13px;">None configured yet.</td></tr>';

  openModal(
    "<h2>Manage " + listName + "</h2>" +
    (arranging ? "" :
      ('<div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">' +
        addFieldHtml +
        '<button id="addSettingsListItemBtn" onclick="addSettingsListItem()">+ Add</button>' +
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

function manageListRowHtml(value, index, arranging, total, metaMap, metaSpec) {
  const escaped = value.replace(/'/g, "\\'");

  const moveCell = arranging
    ? ("<td>" +
        '<button style="font-size:11px;" onclick="moveSettingsListOrder(' + index + ', \'up\')"' + (index === 0 ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:11px;" onclick="moveSettingsListOrder(' + index + ', \'down\')"' + (index === total - 1 ? " disabled" : "") + '>&#9660;</button>' +
      "</td>")
    : "";

  const metaCell = metaSpec ? ('<td style="color:#666; font-size:13px;">' + (metaMap[value] || "") + "</td>") : "";

  const actionsCell = arranging
    ? ""
    : ("<td>" +
        '<button onclick="openEditSettingsListItem(\'' + escaped + '\')">Edit</button> ' +
        '<button onclick="removeSettingsListItem(\'' + escaped + '\')">Remove</button>' +
      "</td>");

  return "<tr>" + moveCell + "<td>" + value + "</td>" + metaCell + actionsCell + "</tr>";
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
      ? ("<label>" + metaSpec.label + "</label><br>" +
          '<select id="editSettingsListMeta">' + metaSpec.options.map((o) => "<option" + (o === currentMeta ? " selected" : "") + ">" + o + "</option>").join("") + "</select><br><br>")
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

function removeSettingsListItem(value) {
  const listName = _manageListName;
  if (!confirm('Remove "' + value + '" from ' + listName + '? Existing records already using it won\'t change, but it won\'t be selectable anymore.')) return;

  api("settings-lists", { method: "DELETE", body: { listName: listName, value: value } })
    .then(async () => {
      _lastSettingsData = await api("settings");
      renderManageSettingsListModal();
      renderAllSettingsLists();
    })
    .catch((err) => alert(err.message));
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
