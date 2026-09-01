// HR - Attendance (outlet closures + staff_shifts roster) and Payroll
// (Phase 2, not built yet). Hub + tabs, same pattern as Finance/Orders
// (pages/cashflow.js/pages/orders.js) - one nav dropdown, one page, tab
// strip underneath instead of separate top-level routes.
//
// Attendance itself nests a second tab level (Log/Calendar), same pattern
// as Inventory/Menu's own hub-inside-a-hub (pages/inventory.js/menu.js) -
// both read off the same staff_shifts data, just two different views of it.
registerPage("hr", renderHrPage);

let _activeHrTab = "attendance";
const HR_TABS = ["attendance", "payroll"];
const HR_TAB_LABELS = { attendance: "Attendance", payroll: "Payroll" };

async function renderHrPage(content) {
  const query = location.hash.split("?")[1] || "";
  const tabParam = new URLSearchParams(query).get("tab");
  _activeHrTab = HR_TABS.indexOf(tabParam) !== -1 ? tabParam : "attendance";

  content.innerHTML = "<h2>HR</h2>" + buildHrTabsHtml();
  wireHrTabs();
  await loadHrTab(_activeHrTab);
}

function buildHrTabsHtml() {
  return (
    '<div class="tabs">' +
      HR_TABS.map((t) => '<button id="hrTab-' + t + '" onclick="switchHrTab(\'' + t + '\')">' + HR_TAB_LABELS[t] + "</button>").join("") +
    "</div>" +
    '<div id="hrTabContent"><p>Loading...</p></div>'
  );
}

function wireHrTabs() {
  HR_TABS.forEach((t) => document.getElementById("hrTab-" + t).classList.toggle("tab-active", t === _activeHrTab));
}

function switchHrTab(tab) {
  if (tab === _activeHrTab) return;
  _activeHrTab = tab;
  wireHrTabs();
  loadHrTab(tab);
}

async function loadHrTab(tab) {
  const wrap = document.getElementById("hrTabContent");
  wrap.innerHTML = "<p>Loading...</p>";
  if (tab === "payroll") return renderPayrollTab(wrap);
  return renderAttendanceTab(wrap);
}

function renderPayrollTab(wrap) {
  wrap.innerHTML = '<p style="color:var(--color-text-muted);">Payroll is coming soon - runs off Attendance (staff_shifts) + per-Role Daily Rate (Settings &gt; Staff Roles) once it ships.</p>';
}

// ---------- Attendance tab ----------

let _hrStaffList = null; // active staff, from lookups - {id, name, roles}
let _lastClosures = [];
let _lastShifts = [];
let _activeShiftsSubTab = "log";

const SHIFTS_SUBTABS = ["log", "calendar"];
const SHIFTS_SUBTAB_LABELS = { log: "Log", calendar: "Calendar" };

async function ensureHrStaffList() {
  if (_hrStaffList) return _hrStaffList;
  const lookups = await api("lookups");
  _hrStaffList = lookups.staff;
  return _hrStaffList;
}

function rolesForStaffId(staffId) {
  const entry = _hrStaffList.find((s) => s.id === staffId);
  return entry ? entry.roles : [];
}

async function renderAttendanceTab(wrap) {
  wrap.innerHTML =
    buildOutletHoursShellHtml() +
    '<hr style="margin:24px 0;">' +
    buildOutletClosuresShellHtml() +
    '<hr style="margin:24px 0;">' +
    buildShiftsSubTabsHtml();
  enableDragScroll(document.getElementById("outletHoursScrollWrap"));
  enableDragScroll(document.getElementById("closuresScrollWrap"));

  await ensureHrStaffList();
  await Promise.all([loadOutletHours(), loadClosures(), loadShifts()]);
  wireShiftsSubTabs();
  loadShiftsSubTab(_activeShiftsSubTab);
}

// ---------- Outlet Hours (regular weekly pattern - Gmaps-style) ----------

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let _lastOutletHours = [];

function buildOutletHoursShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Outlet Hours</h3>" +
      '<button onclick="openManageOutletHoursModal()">Manage Outlet Hours</button>' +
    "</div>" +
    '<p style="font-size:12px; color:var(--color-text-muted); max-width:520px;">Regular weekly operating days/hours. A day marked closed here blocks scheduling shifts on it, same as a one-off closure below.</p>' +
    '<div id="outletHoursScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Day</th><th>Open</th><th>Hours</th></tr></thead>" +
        '<tbody id="outletHoursTbody"><tr><td colspan="3">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadOutletHours() {
  _lastOutletHours = await api("outlet-hours");
  if (!document.getElementById("outletHoursTbody")) return;
  renderOutletHoursRows();
}

function renderOutletHoursRows() {
  const tbody = document.getElementById("outletHoursTbody");
  if (!tbody) return;
  tbody.innerHTML = _lastOutletHours.map(outletHoursDisplayRowHtml).join("");
}

function outletHoursDisplayRowHtml(h) {
  return (
    "<tr>" +
      "<td>" + WEEKDAY_LABELS[h.weekday] + "</td>" +
      "<td>" + (h.isOpen ? "Open" : "Closed") + "</td>" +
      "<td>" + (h.isOpen && (h.openTime || h.closeTime) ? ((h.openTime || "?") + " - " + (h.closeTime || "?")) : "") + "</td>" +
    "</tr>"
  );
}

// ---------- Manage Outlet Hours modal (editable rows live here only - the
// page itself stays a read-only display, per explicit request) ----------

function openManageOutletHoursModal() {
  openModal(
    "<h2>Manage Outlet Hours</h2>" +
    '<table style="width:100%;"><thead><tr><th>Day</th><th>Open</th><th>Opens</th><th>Closes</th></tr></thead>' +
      '<tbody id="manageOutletHoursTbody">' + _lastOutletHours.map(outletHoursEditRowHtml).join("") + "</tbody>" +
    "</table><br>" +
    '<button id="saveOutletHoursBtn" class="btn-primary" onclick="saveAllOutletHours()">Save</button>' +
    '<span id="saveOutletHoursStatus" class="save-status"></span>'
  );
}

function outletHoursEditRowHtml(h) {
  return (
    "<tr>" +
      "<td>" + WEEKDAY_LABELS[h.weekday] + "</td>" +
      '<td><input type="checkbox" class="outletHoursOpenCheck" data-weekday="' + h.weekday + '"' + (h.isOpen ? " checked" : "") + ' onchange="toggleOutletHoursRowTimes(' + h.weekday + ')"></td>' +
      // step=1800s (30 min) - snaps the native time picker's minute spinner
      // to 30-minute increments, per explicit request.
      '<td><input type="time" step="1800" id="outletHoursOpen-' + h.weekday + '" value="' + (h.openTime || "") + '"' + (h.isOpen ? "" : " disabled") + "></td>" +
      '<td><input type="time" step="1800" id="outletHoursClose-' + h.weekday + '" value="' + (h.closeTime || "") + '"' + (h.isOpen ? "" : " disabled") + "></td>" +
    "</tr>"
  );
}

function toggleOutletHoursRowTimes(weekday) {
  const isOpen = document.querySelector('.outletHoursOpenCheck[data-weekday="' + weekday + '"]').checked;
  document.getElementById("outletHoursOpen-" + weekday).disabled = !isOpen;
  document.getElementById("outletHoursClose-" + weekday).disabled = !isOpen;
}

function saveAllOutletHours() {
  const rows = _lastOutletHours.map((h) => ({
    weekday: h.weekday,
    isOpen: document.querySelector('.outletHoursOpenCheck[data-weekday="' + h.weekday + '"]').checked,
    openTime: document.getElementById("outletHoursOpen-" + h.weekday).value || null,
    closeTime: document.getElementById("outletHoursClose-" + h.weekday).value || null
  }));

  const btn = document.getElementById("saveOutletHoursBtn");
  const statusEl = document.getElementById("saveOutletHoursStatus");

  withSaveStatus(btn, statusEl, "Hours", async function () {
    await Promise.all(rows.map((r) => api("outlet-hours/" + r.weekday, { method: "PATCH", body: { isOpen: r.isOpen, openTime: r.openTime, closeTime: r.closeTime } })));
    await loadOutletHours();
    closeModal();
  });
}

// ---------- Outlet Closures (ad-hoc exceptions on top of Outlet Hours) ----------

function buildOutletClosuresShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Outlet Closures</h3>" +
      '<button class="btn-primary" onclick="openClosureModal()">+ Add Closure</button>' +
    "</div>" +
    '<p style="font-size:12px; color:var(--color-text-muted); max-width:520px;">Dates the outlet itself is closed - doesn\'t count against any staff, and blocks scheduling a shift that day.</p>' +
    '<div id="closuresPaginationNav" class="pagination-nav"></div>' +
    '<div id="closuresScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>Reason</th><th></th></tr></thead>" +
        '<tbody id="closuresTbody"></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadClosures() {
  _lastClosures = await api("outlet-closures");
  if (!document.getElementById("closuresTbody")) return;
  renderClosuresRows();
}

function renderClosuresRows() {
  const tbody = document.getElementById("closuresTbody");
  if (!tbody) return;
  const rows = _lastClosures.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  tbody.innerHTML = rows.length ? rows.map(closureRowHtml).join("") : '<tr><td colspan="3">No closures recorded.</td></tr>';
  paginateTable("closuresTbody", "closuresPaginationNav", 10);
}

function closureRowHtml(r) {
  return (
    "<tr>" +
      '<td style="white-space:nowrap; width:1%;">' + r.date +
        '<span style="display:block; color:var(--color-text-muted); font-size:12px;">' + r.closureCode + "</span>" +
      "</td>" +
      "<td>" + (r.reason || "") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="deleteClosure(\'' + r.closureCode + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function openClosureModal() {
  openModal(
    "<h2>Add Closure</h2>" +
    "<label>Date</label><br>" +
    '<input type="date" id="closureDate"><br><br>' +
    "<label>Reason</label><br>" +
    '<input type="text" id="closureReason" placeholder="e.g. National Holiday"><br><br>' +
    '<button id="saveClosureBtn" class="btn-primary" onclick="saveClosure()">Save</button>' +
    '<span id="saveClosureStatus" class="save-status"></span>'
  );
}

function saveClosure() {
  const date = document.getElementById("closureDate").value;
  const reason = document.getElementById("closureReason").value.trim();
  if (!date) { alert("Please select a date."); return; }

  const btn = document.getElementById("saveClosureBtn");
  const statusEl = document.getElementById("saveClosureStatus");

  withSaveStatus(btn, statusEl, "Closure", async function () {
    await api("outlet-closures", { method: "POST", body: { date: date, reason: reason } });
    closeModal();
    await loadClosures();
  });
}

function deleteClosure(code) {
  openConfirmModal({
    title: "Delete this closure?",
    body: "This can't be undone.",
    chip: code,
    confirmLabel: "Delete Closure",
    danger: true,
    onConfirm: async function () {
      await api("outlet-closures/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await loadClosures();
    }
  });
}

// ---------- Shifts (Log / Calendar sub-tabs) ----------

function buildShiftsSubTabsHtml() {
  return (
    '<div class="tabs">' +
      SHIFTS_SUBTABS.map((t) => '<button id="shiftsSubTab-' + t + '" onclick="switchShiftsSubTab(\'' + t + '\')">' + SHIFTS_SUBTAB_LABELS[t] + "</button>").join("") +
    "</div>" +
    '<div id="shiftsSubTabContent"><p>Loading...</p></div>'
  );
}

function wireShiftsSubTabs() {
  SHIFTS_SUBTABS.forEach((t) => document.getElementById("shiftsSubTab-" + t).classList.toggle("tab-active", t === _activeShiftsSubTab));
}

function switchShiftsSubTab(tab) {
  if (tab === _activeShiftsSubTab) return;
  _activeShiftsSubTab = tab;
  wireShiftsSubTabs();
  loadShiftsSubTab(tab);
}

function loadShiftsSubTab(tab) {
  const wrap = document.getElementById("shiftsSubTabContent");
  if (!wrap) return;
  if (tab === "calendar") return renderShiftsCalendar(wrap);
  return renderShiftsLog(wrap);
}

async function loadShifts() {
  _lastShifts = await api("staff-shifts");
}

async function reloadShiftsAndRefresh() {
  await loadShifts();
  loadShiftsSubTab(_activeShiftsSubTab);
}

// ---------- Log sub-tab ----------

let _shiftStaffFilter = []; // empty = show every staff (default)
let _shiftStatusFilter = []; // empty = show every status (default)
let _shiftDateFrom = "";
let _shiftDateTo = "";
let _shiftSort = "date-desc";

const SHIFT_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };
const SHIFT_STATUSES = ["Scheduled", "Absent", "Leave", "Sick", "Cancelled"];

function renderShiftsLog(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="shiftsFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openShiftsFilterSortModal()">Filter &amp; Sort</button>' +
      "</div>" +
      '<button class="btn-primary" onclick="openShiftModal(null)">+ Add Shift</button>' +
    "</div>" +
    '<div id="shiftsPaginationNav" class="pagination-nav"></div>' +
    '<div id="shiftsScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>Staff</th><th>Role</th><th>Status</th><th>Notes</th><th></th></tr></thead>" +
        '<tbody id="shiftsTbody"></tbody>' +
      "</table>" +
    "</div>";
  enableDragScroll(document.getElementById("shiftsScrollWrap"));
  renderShiftsRows();
}

function sortShiftRows(rows, sortKey) {
  const sorted = rows.slice();
  if (sortKey === "date-asc") sorted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  else sorted.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // date-desc
  return sorted;
}

function renderShiftsRows() {
  const tbody = document.getElementById("shiftsTbody");
  if (!tbody) return;

  const badge = document.getElementById("shiftsFilterSortBadge");
  if (badge) {
    const dateParts = [];
    if (_shiftDateFrom) dateParts.push("from " + _shiftDateFrom);
    if (_shiftDateTo) dateParts.push("to " + _shiftDateTo);
    const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
    const staffText = _shiftStaffFilter.length ? _shiftStaffFilter.length + " staff" : "All staff";
    const statusText = _shiftStatusFilter.length ? _shiftStatusFilter.join(", ") : "All statuses";
    badge.textContent = dateText + " | " + staffText + " | " + statusText + " | " + SHIFT_SORT_LABELS[_shiftSort];
  }

  const filtered = _lastShifts.filter((r) =>
    (!_shiftStaffFilter.length || _shiftStaffFilter.indexOf(r.staffId) !== -1) &&
    (!_shiftStatusFilter.length || _shiftStatusFilter.indexOf(r.status) !== -1) &&
    (!_shiftDateFrom || r.date >= _shiftDateFrom) &&
    (!_shiftDateTo || r.date <= _shiftDateTo)
  );
  const rows = sortShiftRows(filtered, _shiftSort);

  tbody.innerHTML = rows.length ? rows.map(shiftRowHtml).join("") : '<tr><td colspan="6">No shifts match this filter.</td></tr>';
  paginateTable("shiftsTbody", "shiftsPaginationNav", 10);
}

function shiftRowHtml(r) {
  return (
    "<tr>" +
      '<td style="white-space:nowrap; width:1%;">' + r.date +
        '<span style="display:block; color:var(--color-text-muted); font-size:12px;">' + r.shiftCode + "</span>" +
      "</td>" +
      "<td>" + (r.staffName || "") + "</td>" +
      "<td>" + r.role + "</td>" +
      "<td>" + r.status + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openShiftModal(\'' + r.shiftCode + '\')">Edit</button> ' +
      '<button class="btn-compact" onclick="deleteShift(\'' + r.shiftCode + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function openShiftsFilterSortModal() {
  const staffChecks = _hrStaffList.map((s) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="shiftStaffFilterCheck" value="' + s.id + '"' + (_shiftStaffFilter.indexOf(s.id) !== -1 ? " checked" : "") + "> " + s.name + "</label>"
  ).join("");
  const statusChecks = SHIFT_STATUSES.map((st) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="shiftStatusFilterCheck" value="' + st + '"' + (_shiftStatusFilter.indexOf(st) !== -1 ? " checked" : "") + "> " + st + "</label>"
  ).join("");
  const sortRadios = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]].map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="shiftSortOption" value="' + val + '"' + (_shiftSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Shifts Log</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="shiftDateFrom" value="' + _shiftDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="shiftDateTo" value="' + _shiftDateTo + '">' +
    "</div><br><br>" +
    "<label>Staff</label>" +
    "<div>" + staffChecks + "</div><br>" +
    "<label>Status</label>" +
    "<div>" + statusChecks + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyShiftsFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyShiftsFilterSort() {
  _shiftDateFrom = document.getElementById("shiftDateFrom").value || "";
  _shiftDateTo = document.getElementById("shiftDateTo").value || "";
  _shiftStaffFilter = Array.from(document.querySelectorAll(".shiftStaffFilterCheck:checked")).map((cb) => cb.value);
  _shiftStatusFilter = Array.from(document.querySelectorAll(".shiftStatusFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="shiftSortOption"]:checked');
  if (selectedSort) _shiftSort = selectedSort.value;
  closeModal();
  renderShiftsRows();
}

// ---------- Calendar sub-tab ----------

let _calendarMonth = null; // "YYYY-MM", set lazily off todayISO() (timezone-aware, see shared.js)

function renderShiftsCalendar(wrap) {
  if (!_calendarMonth) _calendarMonth = todayISO().slice(0, 7);

  const [y, m] = _calendarMonth.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startWeekday = firstOfMonth.getUTCDay();
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const today = todayISO();

  let cells = "";
  for (let i = 0; i < startWeekday; i++) cells += '<div class="hr-cal-cell" style="visibility:hidden;"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = _calendarMonth + "-" + String(d).padStart(2, "0");
    cells += shiftsCalendarCellHtml(dateStr, d, dateStr === today);
  }
  const trailing = (7 - ((startWeekday + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i++) cells += '<div class="hr-cal-cell" style="visibility:hidden;"></div>';

  wrap.innerHTML =
    '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">' +
      '<button onclick="shiftCalendarMonthNav(-1)">&laquo; Prev</button>' +
      "<strong>" + monthLabel + "</strong>" +
      '<button onclick="shiftCalendarMonthNav(1)">Next &raquo;</button>' +
    "</div>" +
    '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; font-size:11px; color:var(--color-text-muted); margin-bottom:4px; text-align:center;">' +
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => "<div>" + d + "</div>").join("") +
    "</div>" +
    '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px;">' + cells + "</div>";
}

// Two independent reasons a date can be closed - the regular weekly
// pattern (Outlet Hours) or a one-off exception on top of it (Outlet
// Closures) - same pair the backend checks in staff-shifts.js's POST.
function isDateClosed(dateStr) {
  const weekday = new Date(dateStr + "T00:00:00Z").getUTCDay();
  const hoursRow = _lastOutletHours.find((h) => h.weekday === weekday);
  if (hoursRow && hoursRow.isOpen === false) return { closed: true, reason: "Regularly closed on " + WEEKDAY_LABELS[weekday] + "s" };
  const closure = _lastClosures.find((c) => c.date === dateStr);
  if (closure) return { closed: true, reason: closure.reason || null };
  return { closed: false, reason: null };
}

function shiftsCalendarCellHtml(dateStr, dayNum, isToday) {
  const closedInfo = isDateClosed(dateStr);
  const dayShifts = _lastShifts.filter((s) => s.date === dateStr && s.status !== "Cancelled");
  const border = isToday ? "border:2px solid var(--color-primary, #333);" : "border:1px solid var(--color-border, #ddd);";

  return (
    '<div style="' + border + ' border-radius:6px; padding:6px; min-height:60px; cursor:pointer;' + (closedInfo.closed ? " background:var(--color-surface-muted, #f2f2f2);" : "") + '" onclick="openDayShiftsModal(\'' + dateStr + '\')">' +
      '<div style="font-size:12px; font-weight:600;">' + dayNum + "</div>" +
      (closedInfo.closed
        ? '<div style="font-size:11px; color:var(--color-text-muted);">Closed</div>'
        : ('<div style="font-size:11px; color:var(--color-text-muted);">' + (dayShifts.length ? dayShifts.length + " staff" : "-") + "</div>")
      ) +
    "</div>"
  );
}

function shiftCalendarMonthNav(delta) {
  const [y, m] = _calendarMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  _calendarMonth = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  renderShiftsCalendar(document.getElementById("shiftsSubTabContent"));
}

function openDayShiftsModal(dateStr) {
  const closedInfo = isDateClosed(dateStr);
  const dayShifts = _lastShifts.filter((s) => s.date === dateStr);

  openModal(
    "<h2>" + dateStr + "</h2>" +
    (closedInfo.closed ? ('<p style="color:var(--color-text-muted); font-size:13px;">Outlet closed' + (closedInfo.reason ? " - " + closedInfo.reason : "") + "</p>") : "") +
    (dayShifts.length
      ? ('<table style="width:100%;"><thead><tr><th>Staff</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
          dayShifts.map((s) =>
            "<tr><td>" + (s.staffName || "") + "</td><td>" + s.role + "</td><td>" + s.status + "</td>" +
            '<td class="compact-cell"><button class="btn-compact" onclick="openShiftModal(\'' + s.shiftCode + '\')">Edit</button> ' +
            '<button class="btn-compact" onclick="deleteShift(\'' + s.shiftCode + '\')">Delete</button></td></tr>'
          ).join("") +
        "</tbody></table><br>")
      : '<p style="color:var(--color-text-muted); font-size:13px;">No shifts yet.</p>'
    ) +
    (closedInfo.closed ? "" : ('<button class="btn-primary" onclick="openShiftModal(null, \'' + dateStr + '\')">+ Add Shift</button>'))
  );
}

// ---------- Add/Edit Shift modal (shared by Log and Calendar) ----------

function openShiftModal(code, prefillDate) {
  const row = code ? _lastShifts.find((s) => s.shiftCode === code) : null;
  const staffOptions = _hrStaffList.map((s) => '<option value="' + s.id + '">' + s.name + "</option>").join("");

  openModal(
    "<h2>" + (code ? "Edit Shift - " + code : "Add Shift") + "</h2>" +
    "<label>Staff</label><br>" +
    (row
      // Staff isn't editable on an existing shift - delete + re-add if it
      // was logged against the wrong person, same convention as other logs
      // here treat their "who/what" field as fixed once saved.
      ? ('<input type="text" value="' + row.staffName + '" disabled><br><br>')
      : ('<select id="shiftStaffId" onchange="updateShiftRoleOptions()"><option value="">Select staff...</option>' + staffOptions + "</select><br><br>")
    ) +
    "<label>Date</label><br>" +
    '<input type="date" id="shiftDate" value="' + (row ? row.date : (prefillDate || "")) + '"><br><br>' +
    "<label>Role</label><br>" +
    '<select id="shiftRole"></select><br><br>' +
    "<label>Status</label><br>" +
    '<select id="shiftStatus">' +
      SHIFT_STATUSES.map((st) => "<option" + ((row ? row.status : "Scheduled") === st ? " selected" : "") + ">" + st + "</option>").join("") +
    "</select><br><br>" +
    "<label>Notes</label><br>" +
    '<input type="text" id="shiftNotes" value="' + (row ? (row.notes || "") : "") + '"><br><br>' +
    '<button id="saveShiftBtn" class="btn-primary" onclick="saveShift(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveShiftStatus" class="save-status"></span>'
  );

  if (row) populateShiftRoleOptions(rolesForStaffId(row.staffId), row.role);
  else updateShiftRoleOptions();
}

function populateShiftRoleOptions(roles, selected) {
  const roleSelect = document.getElementById("shiftRole");
  if (!roleSelect) return;
  roleSelect.innerHTML = (roles || []).map((r) => "<option" + (r === selected ? " selected" : "") + ">" + r + "</option>").join("");
}

function updateShiftRoleOptions() {
  const staffSelect = document.getElementById("shiftStaffId");
  const staffId = staffSelect ? staffSelect.value : null;
  populateShiftRoleOptions(staffId ? rolesForStaffId(staffId) : []);
}

function saveShift(existingCode) {
  const date = document.getElementById("shiftDate").value;
  const role = document.getElementById("shiftRole").value;
  const status = document.getElementById("shiftStatus").value;
  const notes = document.getElementById("shiftNotes").value.trim();
  if (!date) { alert("Please select a date."); return; }
  if (!role) { alert("Please select a role."); return; }

  const body = { date: date, role: role, status: status, notes: notes };
  if (!existingCode) {
    const staffId = document.getElementById("shiftStaffId").value;
    if (!staffId) { alert("Please select a staff member."); return; }
    body.staffId = staffId;
  }

  const btn = document.getElementById("saveShiftBtn");
  const statusEl = document.getElementById("saveShiftStatus");

  withSaveStatus(btn, statusEl, "Shift", async function () {
    if (existingCode) await api("staff-shifts/" + encodeURIComponent(existingCode), { method: "PATCH", body: body });
    else await api("staff-shifts", { method: "POST", body: body });
    closeModal();
    await reloadShiftsAndRefresh();
  });
}

function deleteShift(code) {
  openConfirmModal({
    title: "Delete this shift?",
    body: "This can't be undone.",
    chip: code,
    confirmLabel: "Delete Shift",
    danger: true,
    onConfirm: async function () {
      await api("staff-shifts/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await reloadShiftsAndRefresh();
    }
  });
}
