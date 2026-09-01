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

// ---------- Payroll tab ----------
// One run per month (payroll_runs + payroll_lines) - computed from
// staff_shifts + Settings > Staff Roles' Daily Rate, see
// functions/api/_lib/payroll.js for the actual formula. Draft runs can be
// recalculated (regenerating replaces every line from scratch) and have
// per-staff Bonus editable; Close freezes it and syncs one opex_entries row
// per staff with gross pay > 0.

let _activePayrollMonth = null;
let _lastPayrollRun = null;

async function renderPayrollTab(wrap) {
  if (!_activePayrollMonth) _activePayrollMonth = todayISO().slice(0, 7);
  wrap.innerHTML =
    buildStaffPayShellHtml() +
    '<hr style="margin:24px 0;">' +
    '<div style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">' +
      "<label style=\"font-weight:normal;\">Month</label>" +
      // Matches the page panel's own background instead of the brighter
      // field-bg every other input uses - this one sits directly on the
      // panel (not inside a modal, where field-bg reads fine against the
      // modal's own close-in-tone background), so field-bg's usual
      // brightness stood out too much here.
      '<input type="month" id="payrollMonth" value="' + _activePayrollMonth + '" onchange="switchPayrollMonth(this.value)" style="background-color:var(--color-panel-bg);">' +
      '<button class="btn-compact" onclick="generatePayrollRun()">Calculate</button>' +
    "</div>" +
    '<div id="payrollRunContent"><p>Loading...</p></div>';
  await Promise.all([loadStaffPay(), loadPayrollMonth(_activePayrollMonth)]);
}

// ---------- Staff Pay (Employment Type + Base Rate live here, not
// Database > Staff - that page stays pure identity/contact data) ----------

let _lastStaffPay = [];

function buildStaffPayShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Staff Pay</h3>" +
      '<button onclick="openManageStaffPayModal()">Manage Staff Pay</button>' +
    "</div>" +
    '<div id="staffPayScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Staff</th><th>Employment Type</th><th>Base Rate</th></tr></thead>" +
        '<tbody id="staffPayTbody"><tr><td colspan="3">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>"
  );
}

async function loadStaffPay() {
  const rows = await api("staff");
  _lastStaffPay = rows.filter((r) => r.is_active);
  if (!document.getElementById("staffPayTbody")) return;
  renderStaffPayRows();
}

function renderStaffPayRows() {
  const tbody = document.getElementById("staffPayTbody");
  if (!tbody) return;
  tbody.innerHTML = _lastStaffPay.length
    ? _lastStaffPay.map((r) =>
        "<tr><td>" + r.name + "</td><td>" + r.employment_type + "</td><td>" +
        (r.employment_type === "Monthly" ? '<span class="font-number">' + formatRupiah(r.base_rate || 0) + "</span>" : '<span style="color:var(--color-text-muted); font-size:12px;">Per-role Daily Rate</span>') +
        "</td></tr>"
      ).join("")
    : '<tr><td colspan="3" style="color:var(--color-text-muted); font-size:12px;">No active staff.</td></tr>';
}

function openManageStaffPayModal() {
  openModal(
    "<h2>Manage Staff Pay</h2>" +
    '<table style="width:100%;"><thead><tr><th>Staff</th><th>Employment Type</th><th>Base Rate</th></tr></thead>' +
      '<tbody id="manageStaffPayTbody">' + _lastStaffPay.map(staffPayEditRowHtml).join("") + "</tbody>" +
    "</table><br>" +
    '<button id="saveStaffPayBtn" class="btn-primary" onclick="saveAllStaffPay()">Save</button>' +
    '<span id="saveStaffPayStatus" class="save-status"></span>'
  );
}

function staffPayEditRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.name + "</td>" +
      '<td><select class="staffPayTypeSelect" data-staff="' + r.staff_code + '" onchange="toggleStaffPayRateField(\'' + r.staff_code + '\')">' +
        ["Monthly", "Daily"].map((t) => "<option" + (r.employment_type === t ? " selected" : "") + ">" + t + "</option>").join("") +
      "</select></td>" +
      '<td><input type="text" class="staffPayRateInput" data-staff="' + r.staff_code + '" inputmode="numeric" value="' + formatRupiah(r.base_rate || 0) + '" oninput="formatAmount(this)"' + (r.employment_type === "Daily" ? " disabled" : "") + "></td>" +
    "</tr>"
  );
}

function toggleStaffPayRateField(staffCode) {
  const type = document.querySelector('.staffPayTypeSelect[data-staff="' + staffCode + '"]').value;
  document.querySelector('.staffPayRateInput[data-staff="' + staffCode + '"]').disabled = type === "Daily";
}

function saveAllStaffPay() {
  const rows = _lastStaffPay.map((r) => ({
    staffCode: r.staff_code,
    employmentType: document.querySelector('.staffPayTypeSelect[data-staff="' + r.staff_code + '"]').value,
    baseRate: parseAmount(document.querySelector('.staffPayRateInput[data-staff="' + r.staff_code + '"]').value)
  }));

  const btn = document.getElementById("saveStaffPayBtn");
  const statusEl = document.getElementById("saveStaffPayStatus");

  withSaveStatus(btn, statusEl, "Staff Pay", async function () {
    await Promise.all(rows.map((r) => api("staff/" + encodeURIComponent(r.staffCode), {
      method: "PATCH",
      body: { employmentType: r.employmentType, baseRate: r.employmentType === "Monthly" ? r.baseRate : 0 }
    })));
    await loadStaffPay();
    closeModal();
  });
}

function switchPayrollMonth(month) {
  if (!month) return;
  _activePayrollMonth = month;
  loadPayrollMonth(month);
}

async function loadPayrollMonth(month) {
  const contentEl = document.getElementById("payrollRunContent");
  if (contentEl) contentEl.innerHTML = "<p>Loading...</p>";

  const runs = await api("payroll-runs");
  const match = runs.find((r) => r.month === month);
  if (!match) {
    _lastPayrollRun = null;
    if (contentEl) contentEl.innerHTML = '<p style="color:var(--color-text-muted);">No payroll run for this month yet - click Generate / Recalculate.</p>';
    return;
  }

  _lastPayrollRun = await api("payroll-runs/" + encodeURIComponent(match.runCode));
  renderPayrollRunContent();
}

function generatePayrollRun() {
  const month = document.getElementById("payrollMonth").value;
  if (!month) { alert("Please select a month."); return; }
  _activePayrollMonth = month;

  api("payroll-runs", { method: "POST", body: { month: month } })
    .then(function () { return loadPayrollMonth(month); })
    .catch(function (err) { alert(err.message); });
}

function renderPayrollRunContent() {
  const contentEl = document.getElementById("payrollRunContent");
  if (!contentEl || !_lastPayrollRun) return;
  const run = _lastPayrollRun;

  contentEl.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
      "<span>" + run.runCode + " - <strong>" + run.status + "</strong></span>" +
      (run.status === "Draft" ? '<button class="btn-primary" onclick="closePayrollRun()">Close Payroll</button>' : "") +
    "</div>" +
    '<div style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Staff</th><th>Type</th><th>Base Pay</th><th>Worked Days</th><th>Absent Days</th><th>Deduction</th><th>Bonus</th><th>Gross Pay</th></tr></thead>" +
        "<tbody>" + (run.lines.length ? run.lines.map(payrollLineRowHtml).join("") : '<tr><td colspan="8">No active staff.</td></tr>') + "</tbody>" +
      "</table>" +
    "</div>";
}

// Same icon-only pencil-trigger convention as pages/menu.js's
// btn-icon-edit/ICON_PENCIL (Change Component/Edit Batch Size) - inlined
// here rather than a shared top-level const, since a same-named const in
// two page scripts collides (all page scripts share one global scope; see
// the earlier _lastCalendarEvents duplicate-declaration bug this session).
const PAYROLL_BONUS_PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function payrollBonusViewHtml(l) {
  const pencil = _lastPayrollRun.status === "Draft"
    ? ('<button class="btn-icon-edit" onclick="startEditPayrollBonus(\'' + l.staffId + '\')" title="Edit Bonus">' + PAYROLL_BONUS_PENCIL + "</button>")
    : "";
  return '<span class="font-number">' + formatRupiah(l.bonus) + "</span> " + pencil;
}

function payrollLineRowHtml(l) {
  return (
    "<tr>" +
      "<td>" + (l.staffName || "") + "</td>" +
      "<td>" + l.employmentType + "</td>" +
      '<td><span class="font-number">' + formatRupiah(l.basePay) + "</span></td>" +
      "<td>" + l.workedDays + "</td>" +
      "<td>" + l.absentDays + "</td>" +
      '<td><span class="font-number">' + formatRupiah(l.deduction) + "</span></td>" +
      '<td><span id="payrollBonusCell-' + l.staffId + '">' + payrollBonusViewHtml(l) + "</span></td>" +
      '<td><strong><span class="font-number">' + formatRupiah(l.grossPay) + "</span></strong></td>" +
    "</tr>"
  );
}

function startEditPayrollBonus(staffId) {
  const cell = document.getElementById("payrollBonusCell-" + staffId);
  const line = _lastPayrollRun.lines.find((l) => l.staffId === staffId);
  cell.innerHTML =
    '<div style="display:flex; align-items:center; gap:4px;">' +
      '<input type="text" class="payrollBonusInput" value="' + formatRupiah(line.bonus) + '" inputmode="numeric" oninput="formatAmount(this)" style="width:100px;">' +
      '<button class="btn-compact" onclick="savePayrollBonus(\'' + staffId + '\', this)">Save</button>' +
      '<button class="btn-compact" onclick="cancelEditPayrollBonus(\'' + staffId + '\')">Cancel</button>' +
      '<span class="save-status"></span>' +
    "</div>";
}

function cancelEditPayrollBonus(staffId) {
  const cell = document.getElementById("payrollBonusCell-" + staffId);
  const line = _lastPayrollRun.lines.find((l) => l.staffId === staffId);
  cell.innerHTML = payrollBonusViewHtml(line);
}

function savePayrollBonus(staffId, btn) {
  const cell = document.getElementById("payrollBonusCell-" + staffId);
  const input = cell.querySelector(".payrollBonusInput");
  const statusEl = cell.querySelector(".save-status");
  const bonus = parseAmount(input.value);

  withSaveStatus(btn, statusEl, "Bonus", async function () {
    await api("payroll-runs/" + encodeURIComponent(_lastPayrollRun.runCode), { method: "PATCH", body: { action: "updateBonus", staffId: staffId, bonus: bonus } });
    _lastPayrollRun = await api("payroll-runs/" + encodeURIComponent(_lastPayrollRun.runCode));
    renderPayrollRunContent();
  });
}

function closePayrollRun() {
  openConfirmModal({
    title: "Close this payroll run?",
    body: "This creates one OpEx entry per staff with gross pay above zero, and freezes the run - no more edits or regenerating afterward.",
    chip: _lastPayrollRun.runCode,
    confirmLabel: "Close Payroll",
    danger: true,
    onConfirm: async function () {
      await api("payroll-runs/" + encodeURIComponent(_lastPayrollRun.runCode), { method: "PATCH", body: { action: "close" } });
      closeModal();
      await loadPayrollMonth(_activePayrollMonth);
    }
  });
}

// ---------- Attendance tab ----------

let _hrStaffList = null; // active staff, from lookups - {id, name, roles}
let _lastClosures = [];
let _lastShifts = [];
let _lastCalendarEvents = []; // informational only - see functions/api/calendar-events.js
let _activeShiftsSubTab = "calendar";

const SHIFTS_SUBTABS = ["calendar", "log"];
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
  await Promise.all([loadOutletHours(), loadClosures(), loadShifts(), loadCalendarEvents()]);
  wireShiftsSubTabs();
  loadShiftsSubTab(_activeShiftsSubTab);
}

// ---------- Outlet Hours (regular weekly pattern - Gmaps-style) ----------

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let _lastOutletHours = [];

function buildOutletHoursShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Outlet Hours</h3>" +
      '<button onclick="openManageOutletHoursModal()">Manage Outlet Hours</button>' +
    "</div>" +
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

// The Manage modal's native <input type="time"> already renders AM/PM per
// the browser/OS locale - this formats the read-only page display to match
// instead of showing the raw 24h "HH:MM" the input stores/submits.
function formatTime12h(hhmm) {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  let h = Number(hStr) % 12;
  if (h === 0) h = 12;
  return h + ":" + mStr + " " + (Number(hStr) >= 12 ? "PM" : "AM");
}

function outletHoursDisplayRowHtml(h) {
  return (
    "<tr>" +
      "<td>" + WEEKDAY_LABELS[h.weekday] + "</td>" +
      "<td>" + (h.isOpen ? "Open" : "Closed") + "</td>" +
      "<td>" + (h.isOpen && (h.openTime || h.closeTime) ? ((formatTime12h(h.openTime) || "?") + " - " + (formatTime12h(h.closeTime) || "?")) : "") + "</td>" +
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

async function loadCalendarEvents() {
  _lastCalendarEvents = await api("calendar-events");
}

function calendarEventForDate(dateStr) {
  return _lastCalendarEvents.find((e) => e.date === dateStr) || null;
}

// ---------- Outlet Closures (informational only, same as calendar_events -
// does NOT block shift scheduling or affect the "closed" background; only
// Outlet Hours' weekly pattern does that) ----------

function buildOutletClosuresShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>Outlet Closures</h3>" +
      '<button class="btn-primary" onclick="openClosureModal()">+ Add Closure</button>' +
    "</div>" +
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
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="closureDateFrom">' +
      "<span>to</span>" +
      '<input type="date" id="closureDateTo">' +
    "</div><br><br>" +
    "<label>Reason</label><br>" +
    '<input type="text" id="closureReason" placeholder="e.g. National Holiday"><br><br>' +
    '<button id="saveClosureBtn" class="btn-primary" onclick="saveClosure()">Save</button>' +
    '<span id="saveClosureStatus" class="save-status"></span>'
  );
}

function saveClosure() {
  const dateFrom = document.getElementById("closureDateFrom").value;
  const dateTo = document.getElementById("closureDateTo").value || dateFrom;
  const reason = document.getElementById("closureReason").value.trim();
  if (!dateFrom) { alert("Please select a date."); return; }
  if (dateTo < dateFrom) { alert("The end date can't be before the start date."); return; }

  const dates = dateRangeArray(dateFrom, dateTo);

  const btn = document.getElementById("saveClosureBtn");
  const statusEl = document.getElementById("saveClosureStatus");

  withSaveStatus(btn, statusEl, "Closure", async function () {
    // One at a time, not Promise.all - see saveShift()'s same comment on
    // why concurrent POSTs to a nextCode()-coded table produce duplicate
    // codes (fixed there after it actually happened with staff_shifts).
    const failed = [];
    for (const date of dates) {
      try {
        await api("outlet-closures", { method: "POST", body: { date: date, reason: reason } });
      } catch (err) {
        failed.push({ date: date, message: err.message });
      }
    }
    closeModal();
    await loadClosures();
    if (failed.length) {
      alert(
        (dates.length - failed.length) + " of " + dates.length + " closure(s) created. Skipped:\n" +
        failed.map((f) => f.date + " - " + f.message).join("\n")
      );
    }
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
let _shiftFiltersInitialized = false;

const SHIFT_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };
const SHIFT_STATUSES = ["Scheduled", "Absent", "Leave", "Sick", "Cancelled"];

function renderShiftsLog(wrap) {
  // Lazy one-time default (not a plain initializer above - todayISO() isn't
  // safe to call until Settings > General has loaded, see index.html's
  // ensureGeneralSettings().then(renderCurrentPage)). Scoped to run once so
  // it never clobbers a filter the user deliberately cleared afterwards.
  if (!_shiftFiltersInitialized) {
    _shiftFiltersInitialized = true;
    const monthKey = todayISO().slice(0, 7);
    _shiftDateFrom = monthKey + "-01";
    _shiftDateTo = monthKey + "-31"; // safe upper bound even on shorter months - plain string comparison
    // Scheduled = went as planned, already visible at a glance on the
    // Calendar - the Log defaults to just what actually needs reviewing.
    _shiftStatusFilter = ["Absent", "Leave", "Sick", "Cancelled"];
  }

  wrap.innerHTML =
    '<div style="display:flex; justify-content:flex-end; align-items:center; gap:10px;">' +
      '<span id="shiftsFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
      '<button onclick="openShiftsFilterSortModal()">Filter &amp; Sort</button>' +
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
      // Fixed-width month label slot, same "flex:0 0 <width>" trick as
      // .pagination-info - keeps Prev/Next from shifting position as the
      // label's own text width changes month to month.
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<button onclick="shiftCalendarMonthNav(-1)">&laquo; Prev</button>' +
        '<strong style="flex:0 0 160px; text-align:center;">' + monthLabel + "</strong>" +
        '<button onclick="shiftCalendarMonthNav(1)">Next &raquo;</button>' +
      "</div>" +
      '<button class="btn-primary" onclick="openShiftModal(null)">+ Add Shift</button>' +
    "</div>" +
    '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; font-size:11px; margin-bottom:4px; text-align:center;">' +
      // Sunday's header label in red, matching the wall-calendar convention
      // (also carried through to Sunday's own day number below) - not
      // conditional on Outlet Hours, unlike the closed/gray background.
      WEEKDAY_SHORT_LABELS.map((d, idx) => '<div style="color:' + (idx === 0 ? "#c0392b" : "var(--color-text-muted)") + ';">' + d + "</div>").join("") +
    "</div>" +
    '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px;">' + cells + "</div>";
}

// Only Outlet Hours' weekly pattern actually blocks shift scheduling/drives
// the gray "closed" background - Outlet Closures and calendar_events are
// both purely informational (a reason/description shown on the day, not an
// operational block) - same distinction the backend enforces in
// staff-shifts.js's POST.
function isDateClosed(dateStr) {
  const weekday = new Date(dateStr + "T00:00:00Z").getUTCDay();
  const hoursRow = _lastOutletHours.find((h) => h.weekday === weekday);
  if (hoursRow && hoursRow.isOpen === false) return { closed: true, reason: "Regularly closed on " + WEEKDAY_LABELS[weekday] + "s" };
  return { closed: false, reason: null };
}

function outletClosureForDate(dateStr) {
  return _lastClosures.find((c) => c.date === dateStr) || null;
}

function shiftsCalendarCellHtml(dateStr, dayNum, isToday) {
  const closedInfo = isDateClosed(dateStr);
  // Same alphabetical order as the day-shifts modal this cell opens (see
  // openDayShiftsModal) - consistent regardless of which one someone looks at.
  const dayShifts = _lastShifts
    .filter((s) => s.date === dateStr && s.status !== "Cancelled")
    .sort((a, b) => (a.staffName || "").localeCompare(b.staffName || ""));
  const border = isToday ? "border:2px solid var(--color-primary, #333);" : "border:1px solid var(--color-border, #ddd);";
  const calendarEvent = calendarEventForDate(dateStr);
  const outletClosure = outletClosureForDate(dateStr);
  // Red day number = wall-calendar "tanggal merah" - Sunday (always), an
  // ad-hoc Outlet Closures date, or an imported calendar event (holiday).
  // Deliberately NOT the same as closedInfo.closed below, which only
  // reflects Outlet Hours' weekly pattern - a business's regular off day
  // isn't a "tanggal merah" (that one still gets the gray background, just
  // not the red number), and neither Outlet Closures nor a calendar event
  // affects closedInfo at all - both are informational only.
  const isSunday = new Date(dateStr + "T00:00:00Z").getUTCDay() === 0;
  const dayNumColor = (isSunday || outletClosure || calendarEvent) ? "#c0392b" : "inherit";

  // Separate signal from both of the above - purely "does Outlet Hours'
  // weekly pattern say this weekday is open or closed", as a small fixed-
  // position dot so it never shifts with the day number's own digit count
  // (1 vs 28) the way plain inline text next to it would.
  const weekday = new Date(dateStr + "T00:00:00Z").getUTCDay();
  const hoursRow = _lastOutletHours.find((h) => h.weekday === weekday);
  const weeklyOpen = !hoursRow || hoursRow.isOpen !== false;
  // Same pastel treatment as Dashboard/Stock Overview's status colors -
  // 55% the semantic token blended with 45% white (see shared.css's
  // .status-Safe/.status-Low/.status-Out) - keep new status-style
  // indicators on this formula going forward instead of a plain flat color.
  const hoursDotColor = weeklyOpen
    ? "color-mix(in srgb, var(--color-success) 55%, white 45%)"
    : "var(--color-text-muted)";
  const hoursDot = '<span title="' + (weeklyOpen ? "Open" : "Closed") + ' (Outlet Hours)" style="width:8px; height:8px; border-radius:50%; flex:0 0 8px; background:' + hoursDotColor + ';"></span>';

  const namesHtml = dayShifts.length
    ? dayShifts.map((s) => '<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (s.staffName || "?") + "</div>").join("")
    : '<div style="color:var(--color-text-muted);">-</div>';

  return (
    '<div style="' + border + ' border-radius:6px; padding:6px; min-height:60px; cursor:pointer;' + (closedInfo.closed ? " background:var(--color-surface-muted, #f2f2f2);" : "") + '" onclick="openDayShiftsModal(\'' + dateStr + '\')">' +
      '<div style="display:flex; align-items:center; justify-content:space-between;">' +
        '<span style="font-size:12px; font-weight:600; color:' + dayNumColor + ';">' + dayNum + "</span>" +
        hoursDot +
      "</div>" +
      // Calendar event description and/or Outlet Closure reason (either,
      // neither, or both - purely informational, not a state that hides
      // the other) shown above staff names, never instead of them - none
      // of this implies the outlet is actually closed, so staff can very
      // well still be scheduled that day.
      (calendarEvent
        ? ('<div style="font-size:11px; color:var(--color-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + calendarEvent.name + '">' + calendarEvent.name + "</div>")
        : ""
      ) +
      (outletClosure && outletClosure.reason
        ? ('<div style="font-size:11px; color:var(--color-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + outletClosure.reason + '">' + outletClosure.reason + "</div>")
        : ""
      ) +
      '<div style="font-size:11px;">' + namesHtml + "</div>" +
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
  const calendarEvent = calendarEventForDate(dateStr);
  const outletClosure = outletClosureForDate(dateStr);
  const dayShifts = _lastShifts
    .filter((s) => s.date === dateStr)
    .sort((a, b) => (a.staffName || "").localeCompare(b.staffName || ""));

  openModal(
    "<h2>" + dateStr + "</h2>" +
    (calendarEvent ? ('<p style="color:var(--color-text-muted); font-size:13px;">' + calendarEvent.name + "</p>") : "") +
    (outletClosure && outletClosure.reason ? ('<p style="color:var(--color-text-muted); font-size:13px;">' + outletClosure.reason + "</p>") : "") +
    (closedInfo.closed ? ('<p style="color:var(--color-text-muted); font-size:13px;">Outlet regularly closed' + (closedInfo.reason ? " - " + closedInfo.reason : "") + "</p>") : "") +
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
    (row
      ? ('<label>Date</label><br>' +
          '<input type="date" id="shiftDate" value="' + row.date + '"><br><br>')
      // New shift only - a range creates one shift per date in it (skipping
      // whichever ones fail their own guard, e.g. already-scheduled/outlet
      // closed that day), rather than forcing one Add per day.
      : ('<label>Date Range</label><br>' +
          '<div style="display:flex; align-items:center; gap:8px;">' +
            '<input type="date" id="shiftDateFrom" value="' + (prefillDate || "") + '">' +
            "<span>to</span>" +
            '<input type="date" id="shiftDateTo" value="' + (prefillDate || "") + '">' +
          "</div><br><br>" +
          "<label>Days</label><br>" +
          '<p style="font-size:12px; color:var(--color-text-muted); margin:0 0 4px;">Only these weekdays within the range get a shift - uncheck to skip a day (e.g. a weekly off day).</p>' +
          '<div>' + WEEKDAY_SHORT_LABELS.map((label, idx) =>
            '<label style="display:inline-flex; align-items:center; gap:4px; font-weight:normal; margin-right:12px;">' +
              '<input type="checkbox" class="shiftWeekdayCheck" value="' + idx + '" checked> ' + label +
            "</label>"
          ).join("") + "</div><br>")
    ) +
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

// Inclusive list of "YYYY-MM-DD" strings from fromStr to toStr - UTC to
// match the rest of this file's date-math (renderShiftsCalendar etc.).
function dateRangeArray(fromStr, toStr) {
  const dates = [];
  const from = new Date(fromStr + "T00:00:00Z");
  const to = new Date(toStr + "T00:00:00Z");
  for (let d = from; d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function saveShift(existingCode) {
  const role = document.getElementById("shiftRole").value;
  const status = document.getElementById("shiftStatus").value;
  const notes = document.getElementById("shiftNotes").value.trim();
  if (!role) { alert("Please select a role."); return; }

  const btn = document.getElementById("saveShiftBtn");
  const statusEl = document.getElementById("saveShiftStatus");

  if (existingCode) {
    const date = document.getElementById("shiftDate").value;
    if (!date) { alert("Please select a date."); return; }
    const body = { date: date, role: role, status: status, notes: notes };

    withSaveStatus(btn, statusEl, "Shift", async function () {
      await api("staff-shifts/" + encodeURIComponent(existingCode), { method: "PATCH", body: body });
      closeModal();
      await reloadShiftsAndRefresh();
    });
    return;
  }

  const staffId = document.getElementById("shiftStaffId").value;
  if (!staffId) { alert("Please select a staff member."); return; }
  const dateFrom = document.getElementById("shiftDateFrom").value;
  const dateTo = document.getElementById("shiftDateTo").value;
  if (!dateFrom || !dateTo) { alert("Please select a date range."); return; }
  if (dateTo < dateFrom) { alert("The end date can't be before the start date."); return; }

  const selectedWeekdays = Array.from(document.querySelectorAll(".shiftWeekdayCheck:checked")).map((cb) => Number(cb.value));
  if (!selectedWeekdays.length) { alert("Please select at least one day."); return; }

  const dates = dateRangeArray(dateFrom, dateTo).filter((d) => selectedWeekdays.indexOf(new Date(d + "T00:00:00Z").getUTCDay()) !== -1);
  if (!dates.length) { alert("No dates in this range match the selected days."); return; }

  withSaveStatus(btn, statusEl, "Shift", async function () {
    // One at a time, not Promise.all - staff-shifts.js's nextCode() reads
    // the current max code then inserts as two separate steps, so firing
    // every date's POST concurrently let several of them read the same
    // "next" code before any had inserted yet, producing duplicate
    // shift_codes (fixed for existing data via a migration - this loop is
    // the actual prevention).
    const failed = [];
    for (const date of dates) {
      try {
        await api("staff-shifts", { method: "POST", body: { staffId: staffId, date: date, role: role, status: status, notes: notes } });
      } catch (err) {
        failed.push({ date: date, message: err.message });
      }
    }
    closeModal();
    await reloadShiftsAndRefresh();
    if (failed.length) {
      alert(
        (dates.length - failed.length) + " of " + dates.length + " shift(s) created. Skipped:\n" +
        failed.map((f) => f.date + " - " + f.message).join("\n")
      );
    }
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
