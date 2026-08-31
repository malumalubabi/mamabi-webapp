// HR - Attendance (exception-based log + outlet closures) and Payroll
// (Phase 2, not built yet). Hub + tabs, same pattern as Finance/Orders
// (pages/cashflow.js/pages/orders.js) - one nav dropdown, one page, tab
// strip underneath instead of separate top-level routes.
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
  wrap.innerHTML = '<p style="color:var(--color-text-muted);">Payroll is coming soon - runs off Attendance + the Service Charge pool once it ships.</p>';
}

// ---------- Attendance tab ----------

let _hrStaffList = null; // active staff, from lookups - {id, name, roles}
let _lastClosures = [];
let _lastExceptions = [];

async function ensureHrStaffList() {
  if (_hrStaffList) return _hrStaffList;
  const lookups = await api("lookups");
  _hrStaffList = lookups.staff;
  return _hrStaffList;
}

async function renderAttendanceTab(wrap) {
  wrap.innerHTML =
    buildOutletClosuresShellHtml() +
    '<hr style="margin:24px 0;">' +
    buildAttendanceLogShellHtml();
  enableDragScroll(document.getElementById("closuresScrollWrap"));
  enableDragScroll(document.getElementById("attendanceScrollWrap"));

  await ensureHrStaffList();
  await Promise.all([loadClosures(), loadAttendance()]);
}

// ---------- Outlet Closures ----------

function buildOutletClosuresShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Outlet Closures</h3>" +
      '<button class="btn-primary" onclick="openClosureModal()">+ Add Closure</button>' +
    "</div>" +
    '<p style="font-size:12px; color:var(--color-text-muted); max-width:520px;">Dates the outlet itself is closed - doesn\'t count against any staff\'s attendance.</p>' +
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

// ---------- Attendance Exceptions ----------

let _attendanceStaffFilter = []; // empty = show every staff (default)
let _attendanceStatusFilter = []; // empty = show every status (default)
let _attendanceDateFrom = "";
let _attendanceDateTo = "";
let _attendanceSort = "date-desc";

const ATTENDANCE_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

function buildAttendanceLogShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Attendance Exceptions</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="attendanceFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openAttendanceFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openAttendanceModal()">+ Add Exception</button>' +
      "</div>" +
    "</div>" +
    '<p style="font-size:12px; color:var(--color-text-muted); max-width:520px;">Only deviations get logged here - no entry for a staff on a given day means they were present.</p>' +
    '<div id="attendancePaginationNav" class="pagination-nav"></div>' +
    '<div id="attendanceScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>Staff</th><th>Status</th><th>Notes</th><th></th></tr></thead>" +
        '<tbody id="attendanceTbody"></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadAttendance() {
  _lastExceptions = await api("attendance");
  if (!document.getElementById("attendanceTbody")) return;
  renderAttendanceRows();
}

function sortAttendanceRows(rows, sortKey) {
  const sorted = rows.slice();
  if (sortKey === "date-asc") sorted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  else sorted.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // date-desc
  return sorted;
}

function renderAttendanceRows() {
  const tbody = document.getElementById("attendanceTbody");
  if (!tbody) return;

  const badge = document.getElementById("attendanceFilterSortBadge");
  if (badge) {
    const dateParts = [];
    if (_attendanceDateFrom) dateParts.push("from " + _attendanceDateFrom);
    if (_attendanceDateTo) dateParts.push("to " + _attendanceDateTo);
    const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
    const staffText = _attendanceStaffFilter.length ? _attendanceStaffFilter.length + " staff" : "All staff";
    const statusText = _attendanceStatusFilter.length ? _attendanceStatusFilter.join(", ") : "All statuses";
    badge.textContent = dateText + " | " + staffText + " | " + statusText + " | " + ATTENDANCE_SORT_LABELS[_attendanceSort];
  }

  const filtered = _lastExceptions.filter((r) =>
    (!_attendanceStaffFilter.length || _attendanceStaffFilter.indexOf(r.staffId) !== -1) &&
    (!_attendanceStatusFilter.length || _attendanceStatusFilter.indexOf(r.status) !== -1) &&
    (!_attendanceDateFrom || r.date >= _attendanceDateFrom) &&
    (!_attendanceDateTo || r.date <= _attendanceDateTo)
  );
  const rows = sortAttendanceRows(filtered, _attendanceSort);

  tbody.innerHTML = rows.length ? rows.map(attendanceRowHtml).join("") : '<tr><td colspan="5">No exceptions match this filter.</td></tr>';
  paginateTable("attendanceTbody", "attendancePaginationNav", 10);
}

function attendanceRowHtml(r) {
  return (
    "<tr>" +
      '<td style="white-space:nowrap; width:1%;">' + r.date +
        '<span style="display:block; color:var(--color-text-muted); font-size:12px;">' + r.exceptionCode + "</span>" +
      "</td>" +
      "<td>" + (r.staffName || "") + "</td>" +
      "<td>" + r.status + "</td>" +
      "<td>" + (r.notes || "") + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openAttendanceModal(\'' + r.exceptionCode + '\')">Edit</button> ' +
      '<button class="btn-compact" onclick="deleteAttendanceException(\'' + r.exceptionCode + '\')">Delete</button></td>' +
    "</tr>"
  );
}

function openAttendanceFilterSortModal() {
  const staffChecks = _hrStaffList.map((s) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="attendanceStaffFilterCheck" value="' + s.id + '"' + (_attendanceStaffFilter.indexOf(s.id) !== -1 ? " checked" : "") + "> " + s.name + "</label>"
  ).join("");
  const statusChecks = ["Absent", "Leave", "Sick", "Holiday"].map((st) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="attendanceStatusFilterCheck" value="' + st + '"' + (_attendanceStatusFilter.indexOf(st) !== -1 ? " checked" : "") + "> " + st + "</label>"
  ).join("");
  const sortRadios = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]].map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="attendanceSortOption" value="' + val + '"' + (_attendanceSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Attendance Exceptions</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="attendanceDateFrom" value="' + _attendanceDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="attendanceDateTo" value="' + _attendanceDateTo + '">' +
    "</div><br><br>" +
    "<label>Staff</label>" +
    "<div>" + staffChecks + "</div><br>" +
    "<label>Status</label>" +
    "<div>" + statusChecks + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyAttendanceFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyAttendanceFilterSort() {
  _attendanceDateFrom = document.getElementById("attendanceDateFrom").value || "";
  _attendanceDateTo = document.getElementById("attendanceDateTo").value || "";
  _attendanceStaffFilter = Array.from(document.querySelectorAll(".attendanceStaffFilterCheck:checked")).map((cb) => cb.value);
  _attendanceStatusFilter = Array.from(document.querySelectorAll(".attendanceStatusFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="attendanceSortOption"]:checked');
  if (selectedSort) _attendanceSort = selectedSort.value;
  closeModal();
  renderAttendanceRows();
}

function openAttendanceModal(code) {
  const row = code ? _lastExceptions.find((r) => r.exceptionCode === code) : null;
  const staffOptions = _hrStaffList.map((s) => "<option value=\"" + s.id + "\">" + s.name + "</option>").join("");

  openModal(
    "<h2>" + (code ? "Edit Exception - " + code : "Add Exception") + "</h2>" +
    "<label>Staff</label><br>" +
    (row
      // Staff isn't editable on an existing exception - delete + re-add if
      // it was logged against the wrong person, same as most other logs
      // here treat their "who/what" field as fixed once saved.
      ? ('<input type="text" value="' + row.staffName + '" disabled><br><br>')
      : ('<select id="attendanceStaffId"><option value="">Select staff...</option>' + staffOptions + "</select><br><br>")
    ) +
    "<label>Date</label><br>" +
    '<input type="date" id="attendanceDate" value="' + (row ? row.date : "") + '"><br><br>' +
    "<label>Status</label><br>" +
    '<select id="attendanceStatus">' +
      ["Absent", "Leave", "Sick", "Holiday"].map((st) => "<option" + (row && row.status === st ? " selected" : "") + ">" + st + "</option>").join("") +
    "</select><br><br>" +
    "<label>Notes</label><br>" +
    '<input type="text" id="attendanceNotes" value="' + (row ? (row.notes || "") : "") + '"><br><br>' +
    '<button id="saveAttendanceBtn" class="btn-primary" onclick="saveAttendanceException(' + (code ? "'" + code + "'" : "null") + ')">Save</button>' +
    '<span id="saveAttendanceStatus" class="save-status"></span>'
  );
}

function saveAttendanceException(existingCode) {
  const date = document.getElementById("attendanceDate").value;
  const status = document.getElementById("attendanceStatus").value;
  const notes = document.getElementById("attendanceNotes").value.trim();
  if (!date) { alert("Please select a date."); return; }

  const body = { date: date, status: status, notes: notes };
  if (!existingCode) {
    const staffId = document.getElementById("attendanceStaffId").value;
    if (!staffId) { alert("Please select a staff member."); return; }
    body.staffId = staffId;
  }

  const btn = document.getElementById("saveAttendanceBtn");
  const statusEl = document.getElementById("saveAttendanceStatus");

  withSaveStatus(btn, statusEl, "Exception", async function () {
    if (existingCode) await api("attendance/" + encodeURIComponent(existingCode), { method: "PATCH", body: body });
    else await api("attendance", { method: "POST", body: body });
    closeModal();
    await loadAttendance();
  });
}

function deleteAttendanceException(code) {
  openConfirmModal({
    title: "Delete this exception?",
    body: "This can't be undone.",
    chip: code,
    confirmLabel: "Delete Exception",
    danger: true,
    onConfirm: async function () {
      await api("attendance/" + encodeURIComponent(code), { method: "DELETE" });
      closeModal();
      await loadAttendance();
    }
  });
}
