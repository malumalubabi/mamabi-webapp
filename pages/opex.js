// OpEx - ported from the old app's 02 Finance/Opex module (Opex_Nav.html:
// Summary/Log/Input Expense). Input Expense is a MODAL here (not a 3rd
// tab), matching this app's established pattern (Input Sales, New Order,
// Input Transaction are all modals) - deviates from the old app's
// page-per-tab layout on purpose, same reasoning as pages/sales.js.
//
// Two kinds of rows show up in the Log: auto-linked (Driver Payout's Mark
// Paid, Sales's Platform/Marketing Fee - already live before this page
// existed, see functions/api/orders.js and functions/api/_lib/sales.js)
// and manual (this page's Add/Edit modal, for categories with no
// automation yet - Payroll/Rent/Utilities/etc.). Auto-linked rows are
// read-only here - functions/api/opex/[code].js rejects direct edit/delete
// server-side, not just hidden client-side, so go edit the source
// (Order/Sales Batch) instead. The old app never guarded this at all.
registerPage("finance-opex", renderOpexPage);

let _activeOpexTab = "summary";
let _lastOpexRows = [];
let _opexCategoryOptions = null;

async function ensureOpexCategoryOptions() {
  if (_opexCategoryOptions) return _opexCategoryOptions;
  const data = await api("settings");
  _opexCategoryOptions = data.lists["PnL Categories"] || [];
  return _opexCategoryOptions;
}

async function renderOpexPage(content) {
  const query = location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const tabParam = params.get("tab");
  _activeOpexTab = ["summary", "log"].indexOf(tabParam) !== -1 ? tabParam : "summary";

  content.innerHTML = "<h2>OpEx</h2>" + buildOpexTabsShellHtml();
  wireOpexTabs();
  await ensureOpexCategoryOptions();
  await loadOpexTab(_activeOpexTab);
}

function buildOpexTabsShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div class="tabs" style="margin-bottom:0;">' +
        '<button id="opexTab-summary" onclick="switchOpexTab(\'summary\')">Summary</button>' +
        '<button id="opexTab-log" onclick="switchOpexTab(\'log\')">Log</button>' +
      "</div>" +
      '<button onclick="openOpexEntryModal()">+ Add Expense</button>' +
    "</div>" +
    '<div id="opexTableWrap"><p>Loading...</p></div>'
  );
}

function wireOpexTabs() {
  document.getElementById("opexTab-summary").classList.toggle("tab-active", _activeOpexTab === "summary");
  document.getElementById("opexTab-log").classList.toggle("tab-active", _activeOpexTab === "log");
}

function switchOpexTab(tab) {
  if (tab === _activeOpexTab) return;
  _activeOpexTab = tab;
  wireOpexTabs();
  loadOpexTab(tab);
}

async function loadOpexTab(tab) {
  const wrap = document.getElementById("opexTableWrap");
  wrap.innerHTML = "<p>Loading...</p>";

  _lastOpexRows = await api("opex");
  if (!document.getElementById("opexTableWrap")) return;

  if (tab === "summary") renderOpexSummary(wrap);
  else renderOpexLog(wrap);
}

// ---------- Summary (current month recap by category, same shape as the
// old app's OpexSummaryTable.html) ----------

function renderOpexSummary(wrap) {
  const now = new Date();
  const monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const monthRows = _lastOpexRows.filter((r) => String(r.date).slice(0, 7) === monthKey);

  const seen = [...new Set(monthRows.map((r) => r.category))];
  const known = _opexCategoryOptions.filter((c) => seen.indexOf(c) !== -1);
  const extra = seen.filter((c) => _opexCategoryOptions.indexOf(c) === -1).sort();
  const categories = known.concat(extra);

  const expenseByCategory = {};
  categories.forEach((c) => {
    expenseByCategory[c] = monthRows.filter((r) => r.category === c).reduce((sum, r) => sum + r.accruedExpense, 0);
  });
  const total = categories.reduce((sum, c) => sum + expenseByCategory[c], 0);
  const monthLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });

  wrap.innerHTML =
    "<h3>OpEx Summary</h3>" +
    '<div id="opexScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>This Month Recap</th>" + categories.map((c) => "<th>" + c + "</th>").join("") + "<th>Total</th></tr></thead>" +
        "<tbody><tr>" +
          "<td>Total Expense - " + monthLabel + "</td>" +
          categories.map((c) => "<td>" + formatRupiah(expenseByCategory[c]) + "</td>").join("") +
          "<td><strong>" + formatRupiah(total) + "</strong></td>" +
        "</tr></tbody>" +
      "</table>" +
    "</div>";
  enableDragScroll(document.getElementById("opexScrollWrap"));
}

// ---------- Log ----------

let _opexCategoryFilter = []; // empty = show every Category (default)
let _opexSort = "date-desc";

const OPEX_SORT_LABELS = {
  "date-desc": "Date (Newest)",
  "date-asc": "Date (Oldest)",
  "amount-desc": "Amount (High-Low)",
  "amount-asc": "Amount (Low-High)",
  "category-asc": "Category (A-Z)",
  "category-desc": "Category (Z-A)"
};

function sortOpexRows(rows, sortKey) {
  const sorted = rows.slice();
  switch (sortKey) {
    case "date-asc": sorted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); break;
    case "amount-desc": sorted.sort((a, b) => b.grossAmount - a.grossAmount); break;
    case "amount-asc": sorted.sort((a, b) => a.grossAmount - b.grossAmount); break;
    case "category-asc": sorted.sort((a, b) => a.category.localeCompare(b.category)); break;
    case "category-desc": sorted.sort((a, b) => b.category.localeCompare(a.category)); break;
    default: sorted.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); break; // date-desc
  }
  return sorted;
}

function renderOpexLog(wrap) {
  wrap.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>OpEx Log</h3>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="opexSortBadge" style="color:#666; font-size:12px;">Sort: ' + OPEX_SORT_LABELS[_opexSort] + "</span>" +
        '<button onclick="openOpexSortModal()">Sort</button>' +
        '<span id="opexFilterBadge" style="color:#666; font-size:12px;">' + (_opexCategoryFilter.length ? _opexCategoryFilter.join(", ") : "All") + "</span>" +
        '<button onclick="openOpexFilterModal()">Set Filter</button>' +
      "</div>" +
    "</div>" +
    '<div id="opexPaginationNav" class="pagination-nav"></div>' +
    '<div id="opexScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Expense ID</th><th>Date</th><th>Category</th><th>Description</th><th>Gross Amount</th><th>Amort.</th><th>Period</th><th>Accrued Expense</th><th>Payment Method</th><th></th></tr></thead>" +
        '<tbody id="opexTbody"></tbody>' +
      "</table>" +
    "</div>";
  renderOpexLogRows();
  enableDragScroll(document.getElementById("opexScrollWrap"));
}

function renderOpexLogRows() {
  const tbody = document.getElementById("opexTbody");
  if (!tbody) return;

  const filtered = _opexCategoryFilter.length
    ? _lastOpexRows.filter((r) => _opexCategoryFilter.indexOf(r.category) !== -1)
    : _lastOpexRows;
  const rows = sortOpexRows(filtered, _opexSort);

  tbody.innerHTML = rows.length ? rows.map(opexRowHtml).join("") : '<tr><td colspan="10">No expenses match this filter.</td></tr>';
  paginateTable("opexTbody", "opexPaginationNav", 20);
}

function opexRowHtml(r) {
  const actionsCell = r.linkedFrom
    ? ('<td><span style="color:#666; font-size:12px;">Auto-linked (' + r.linkedFrom + " " + r.linkedRef + ")</span></td>")
    : ("<td><button onclick=\"openOpexEntryModal('" + r.opexCode + "')\">Edit</button> " +
       "<button onclick=\"deleteOpexEntry('" + r.opexCode + "')\">Delete</button></td>");

  return (
    "<tr>" +
      "<td>" + r.opexCode + "</td>" +
      "<td>" + r.date + "</td>" +
      "<td>" + r.category + "</td>" +
      "<td>" + (r.desc || "") + "</td>" +
      "<td>" + formatRupiah(r.grossAmount) + "</td>" +
      "<td>" + r.amort + "</td>" +
      "<td>" + r.period + "</td>" +
      "<td>" + formatRupiah(r.accruedExpense) + "</td>" +
      "<td>" + (r.paymentMethod || "") + "</td>" +
      actionsCell +
    "</tr>"
  );
}

function openOpexFilterModal() {
  const checkboxes = _opexCategoryOptions.map((c) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="opexCategoryFilterCheck" value="' + c + '"' + (_opexCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c +
    "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Category</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyOpexFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyOpexFilter() {
  _opexCategoryFilter = Array.from(document.querySelectorAll(".opexCategoryFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  const badge = document.getElementById("opexFilterBadge");
  if (badge) badge.textContent = _opexCategoryFilter.length ? _opexCategoryFilter.join(", ") : "All";
  renderOpexLogRows();
}

function openOpexSortModal() {
  const options = [
    ["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"],
    ["amount-desc", "Amount (High-Low)"], ["amount-asc", "Amount (Low-High)"],
    ["category-asc", "Category (A-Z)"], ["category-desc", "Category (Z-A)"]
  ];
  openModal(
    "<h2>Sort OpEx Log</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="opexSortOption" value="' + val + '"' + (_opexSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyOpexSort()">Apply</button>'
  );
}

function applyOpexSort() {
  const selected = document.querySelector('input[name="opexSortOption"]:checked');
  if (!selected) return;
  _opexSort = selected.value;
  closeModal();
  const badge = document.getElementById("opexSortBadge");
  if (badge) badge.textContent = "Sort: " + OPEX_SORT_LABELS[_opexSort];
  renderOpexLogRows();
}

// ---------- Add/Edit Expense modal ----------

function openOpexEntryModal(opexCode) {
  const row = opexCode ? _lastOpexRows.find((r) => r.opexCode === opexCode) : null;
  if (row && row.linkedFrom) {
    alert("This expense is auto-linked from " + row.linkedFrom + " (" + row.linkedRef + ") - edit it from there instead.");
    return;
  }

  openModal(
    "<h2>" + (opexCode ? "Edit Expense - " + opexCode : "Add Expense") + "</h2>" +
    "<label>Date</label><br>" +
    (row
      ? ('<input type="date" id="opexDate" value="' + row.date + '"><br><br>')
      : ('<div style="display:flex; align-items:center; gap:8px;">' +
          '<input type="checkbox" id="opexToday" checked onchange="setOpexToday()">' +
          '<label for="opexToday">Today</label>' +
          '<input type="date" id="opexDate">' +
        "</div><br><br>")
    ) +
    "<label>Category</label><br>" +
    '<select id="opexCategory">' +
      _opexCategoryOptions.map((c) => "<option" + (row && row.category === c ? " selected" : "") + ">" + c + "</option>").join("") +
    "</select>" +
    '<p style="font-size:12px; color:#666; margin:4px 0 0;">New category? Add it on the Settings page (PnL Categories) first.</p><br>' +
    "<label>Description</label><br>" +
    '<input type="text" id="opexDesc" value="' + (row ? (row.desc || "") : "") + '"><br><br>' +
    "<label>Gross Amount</label><br>" +
    '<input type="text" id="opexGrossAmount" inputmode="numeric" value="' + (row ? formatRupiah(row.grossAmount) : "") + '" oninput="formatAmount(this)"><br><br>' +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="opexAmort"' + (row && row.amort === "Yes" ? " checked" : "") + ' onchange="toggleOpexAmort()">' +
      '<label for="opexAmort">Amortized over multiple months</label>' +
    "</div><br>" +
    '<div id="opexPeriodField" style="display:' + (row && row.amort === "Yes" ? "block" : "none") + ';">' +
      "<label>Period (months)</label><br>" +
      '<input type="number" id="opexPeriod" min="1" value="' + (row ? row.period : 1) + '"><br><br>' +
    "</div>" +
    '<button id="saveOpexBtn" onclick="saveOpexEntry(' + (opexCode ? "'" + opexCode + "'" : "null") + ')">Save</button>' +
    '<span id="saveOpexStatus" class="save-status"></span>'
  );

  if (!row) setOpexToday();
}

function setOpexToday() {
  const today = document.getElementById("opexToday");
  const date = document.getElementById("opexDate");
  if (today.checked) { date.valueAsDate = new Date(); date.disabled = true; }
  else { date.value = ""; date.disabled = false; }
}

function toggleOpexAmort() {
  const amort = document.getElementById("opexAmort");
  const field = document.getElementById("opexPeriodField");
  field.style.display = amort.checked ? "block" : "none";
  if (!amort.checked) document.getElementById("opexPeriod").value = 1;
}

function saveOpexEntry(existingCode) {
  const date = document.getElementById("opexDate").value;
  const category = document.getElementById("opexCategory").value;
  const desc = document.getElementById("opexDesc").value.trim();
  const grossAmount = parseAmount(document.getElementById("opexGrossAmount").value);
  const amort = document.getElementById("opexAmort").checked;
  const period = document.getElementById("opexPeriod").value;

  if (!date) { alert("Please select a date."); return; }
  if (!category) { alert("Please select a category."); return; }
  if (!desc) { alert("Please enter a description."); return; }
  if (!grossAmount || grossAmount <= 0) { alert("Please enter a valid gross amount."); return; }
  if (amort && (!period || Number(period) <= 0)) { alert("Please enter a valid period."); return; }

  const body = { date: date, category: category, desc: desc, grossAmount: grossAmount, amort: amort ? "Yes" : "No", period: period };

  const btn = document.getElementById("saveOpexBtn");
  const statusEl = document.getElementById("saveOpexStatus");

  withSaveStatus(btn, statusEl, "Expense", async function () {
    if (existingCode) await api("opex/" + encodeURIComponent(existingCode), { method: "PATCH", body: body });
    else await api("opex", { method: "POST", body: body });
    closeModal();
    await loadOpexTab(_activeOpexTab);
  });
}

function deleteOpexEntry(code) {
  if (!confirm("Delete this expense entirely? This can't be undone.")) return;

  api("opex/" + encodeURIComponent(code), { method: "DELETE" })
    .then(() => loadOpexTab(_activeOpexTab))
    .catch((err) => alert(err.message));
}
