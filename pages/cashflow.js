// Finance nav is one page (Cashflow/OpEx/P&L tabs) - matches the main
// nav's own "Finance" dropdown grouping, same pattern as Database/
// Inventory/Menu below their own dropdown groupings. Shell lives here
// (first of the three Finance files) since it needs to be defined
// somewhere; the tab renderers are just the pre-existing per-module page
// functions (their own top-level <h2> stripped - the tab strip already
// marks which section is active, same "no redundant heading" convention
// used throughout the app).
registerPage("finance", renderFinancePage);

let _activeFinanceTab = "cashflow";
const FINANCE_TABS = ["cashflow", "opex", "pnl"];
const FINANCE_TAB_LABELS = { cashflow: "Cashflow", opex: "OpEx", pnl: "P&L" };

async function renderFinancePage(content) {
  const query = location.hash.split("?")[1] || "";
  const tabParam = new URLSearchParams(query).get("tab");
  _activeFinanceTab = FINANCE_TABS.indexOf(tabParam) !== -1 ? tabParam : "cashflow";

  content.innerHTML = "<h2>Finance</h2>" + buildFinanceTabsHtml();
  wireFinanceTabs();
  await loadFinanceTab(_activeFinanceTab);
}

function buildFinanceTabsHtml() {
  return (
    '<div class="tabs">' +
      FINANCE_TABS.map((t) => '<button id="financeTab-' + t + '" onclick="switchFinanceTab(\'' + t + '\')">' + FINANCE_TAB_LABELS[t] + "</button>").join("") +
    "</div>" +
    '<div id="financeTabContent"><p>Loading...</p></div>'
  );
}

function wireFinanceTabs() {
  FINANCE_TABS.forEach((t) => document.getElementById("financeTab-" + t).classList.toggle("tab-active", t === _activeFinanceTab));
}

function switchFinanceTab(tab) {
  if (tab === _activeFinanceTab) return;
  _activeFinanceTab = tab;
  wireFinanceTabs();
  loadFinanceTab(tab);
}

// Dispatches to the pre-existing per-module render function (cashflow.js/
// opex.js/pnl.js each still own their full section logic, just no longer
// registered as their own top-level route) - all three already only touch
// document.getElementById lookups internally, never content.querySelector,
// so calling them with this sub-wrap instead of the top-level #content
// element works with no changes to their own bodies beyond dropping the
// <h2>.
async function loadFinanceTab(tab) {
  const wrap = document.getElementById("financeTabContent");
  wrap.innerHTML = "<p>Loading...</p>";
  if (tab === "opex") return renderOpexPage(wrap);
  if (tab === "pnl") return renderPnlPage(wrap);
  return renderCashflowPage(wrap);
}

// Category -> Type/Flow reference now lives in settings_lists (list_name
// "Cashflow Category", meta = "Type - Flow") instead of being hardcoded
// here and in functions/api/cashflow.js separately - see this app's
// Settings page (Cashflow Category) to manage it. _cashflowCategoryDefs is
// { categoryName: { type, flow } }, built once from api("settings").
let _activeCfAccount = "Bank";
let _cashflowCategoryOptions = null; // ordered array of category names
let _cashflowCategoryDefs = null;

async function ensureCashflowCategoryDefs() {
  if (_cashflowCategoryDefs) return;
  const data = await api("settings");
  _cashflowCategoryOptions = data.lists["Cashflow Category"] || [];
  _cashflowCategoryDefs = {};
  _cashflowCategoryOptions.forEach((name) => {
    const meta = (data.listsMeta["Cashflow Category"] || {})[name] || "";
    const [type, flow] = meta.split(" - ");
    _cashflowCategoryDefs[name] = { type: type || null, flow: flow || null };
  });
}

// Every Description ever used, for the Input Transaction form's free-text
// combobox (pick an existing one for consistency, or type a brand-new one).
let _cashflowDescriptionOptions = null;

async function ensureCashflowDescriptionOptions() {
  if (_cashflowDescriptionOptions) return;
  _cashflowDescriptionOptions = await api("cashflow/descriptions");
}

// ================================================================
// Main page: Title -> Summary -> (Bank/Cash filter + Input
// Transaction button) -> Ledger table
// ================================================================

async function renderCashflowPage(content) {
  content.innerHTML =
    buildCashflowSummaryShellHtml() +
    buildCashflowLedgerShellHtml();
  wireCashflowLedgerTabs();
  enableDragScroll(document.getElementById("cashflowLedgerScrollWrap"));
  await Promise.all([ensureCashflowCategoryDefs(), loadCashflowSummary(), loadCashflowLedger(_activeCfAccount)]);
}

// ---------- Monthly summary (simplified from CashflowSummaryMonthly.html - Type-level net, not per-category/per-account) ----------

function buildCashflowSummaryShellHtml() {
  return (
    "<h3>Cashflow Summary</h3>" +
    '<div id="cashflowSummaryWrap"><p>Loading...</p></div>' +
    '<hr style="margin:24px 0;">'
  );
}

async function loadCashflowSummary() {
  const wrap = document.getElementById("cashflowSummaryWrap");
  const data = await api("cashflow/summary");
  if (!document.getElementById("cashflowSummaryWrap")) return;

  const head =
    "<tr><th>Type</th>" +
    data.months.map((m) => '<th colspan="3">' + m.label + "</th>").join("") +
    "</tr>" +
    "<tr><th></th>" +
    data.months.map(() => "<th>In</th><th>Out</th><th>Net</th>").join("") +
    "</tr>";

  const rows = data.groups
    .map((g) => {
      const cells = g.months
        .map((m) => '<td><span class="font-number">' + formatRupiah(m.in) + '</span></td><td><span class="font-number">' + formatRupiah(m.out) + '</span></td><td><span class="font-number">' + formatRupiah(m.net) + "</span></td>")
        .join("");
      return "<tr><td>" + g.type + "</td>" + cells + "</tr>";
    })
    .join("");

  wrap.innerHTML =
    '<div id="cashflowSummaryScrollWrap" style="overflow-x:auto;">' +
      "<table><thead>" + head + "</thead><tbody>" + rows + "</tbody></table>" +
    "</div>";
  enableDragScroll(document.getElementById("cashflowSummaryScrollWrap"));
}

// ---------- Ledger (ported from CashflowLedger.html + CashflowTable.html, Bank/Cash tabs) ----------

function buildCashflowLedgerShellHtml() {
  return (
    "<h3>Cashflow Ledger</h3>" +
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div class="tabs" style="margin-bottom:0;">' +
        '<button id="cfTab-Bank" class="tab-active" onclick="switchCashflowLedgerTab(\'Bank\')">Bank</button>' +
        '<button id="cfTab-Cash" onclick="switchCashflowLedgerTab(\'Cash\')">Cash</button>' +
      "</div>" +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span id="cashflowFilterSortBadge" style="color:var(--color-text-muted); font-size:12px;"></span>' +
        '<button onclick="openCashflowLogFilterSortModal()">Filter &amp; Sort</button>' +
        '<button class="btn-primary" onclick="openCashflowEntryModal()">+ Input Transaction</button>' +
      "</div>" +
    "</div>" +
    '<div id="cashflowLedgerPaginationNav" class="pagination-nav"></div>' +
    '<div id="cashflowLedgerScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th>" +
        "<th>Cash In</th><th>Cash Out</th><th>Balance</th><th>Notes</th></tr></thead>" +
        '<tbody id="cashflowLedgerTbody"><tr><td colspan="8">Loading...</td></tr></tbody>' +
      "</table>" +
    "</div>"
  );
}

function wireCashflowLedgerTabs() {
  _activeCfAccount = "Bank";
}

function switchCashflowLedgerTab(account) {
  if (account === _activeCfAccount) return;
  _activeCfAccount = account;
  document.getElementById("cfTab-Bank").classList.toggle("tab-active", account === "Bank");
  document.getElementById("cfTab-Cash").classList.toggle("tab-active", account === "Cash");
  loadCashflowLedger(account);
}

let _lastCashflowLedgerRows = [];
let _cashflowLedgerCategoryFilter = []; // empty = show every Category (default)
let _cashflowLedgerDateFrom = "";
let _cashflowLedgerDateTo = "";
let _cashflowLedgerSort = "date-desc";
const CASHFLOW_LEDGER_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function loadCashflowLedger(account) {
  const tbody = document.getElementById("cashflowLedgerTbody");
  // Called after saving a transaction from ANY page now (e.g. Dashboard's
  // Quick Actions, not just the Cashflow page itself) - tbody legitimately
  // won't exist there, same reasoning as every other page's post-save
  // reload guard (see pages/orders.js's loadOrdersData).
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';

  _lastCashflowLedgerRows = await api("cashflow?account=" + encodeURIComponent(account));
  if (!document.getElementById("cashflowLedgerTbody")) return;

  renderCashflowLedgerRows();
}

function renderCashflowLedgerRows() {
  const tbody = document.getElementById("cashflowLedgerTbody");
  if (!tbody) return;

  const badge = document.getElementById("cashflowFilterSortBadge");
  if (badge) {
    const dateParts = [];
    if (_cashflowLedgerDateFrom) dateParts.push("from " + _cashflowLedgerDateFrom);
    if (_cashflowLedgerDateTo) dateParts.push("to " + _cashflowLedgerDateTo);
    const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
    badge.textContent = dateText + " | " + (_cashflowLedgerCategoryFilter.length ? _cashflowLedgerCategoryFilter.join(", ") : "All") + " | " + CASHFLOW_LEDGER_SORT_LABELS[_cashflowLedgerSort];
  }

  const filtered = _lastCashflowLedgerRows.filter((r) =>
    (!_cashflowLedgerCategoryFilter.length || _cashflowLedgerCategoryFilter.indexOf(r.category) !== -1) &&
    (!_cashflowLedgerDateFrom || r.date >= _cashflowLedgerDateFrom) &&
    (!_cashflowLedgerDateTo || r.date <= _cashflowLedgerDateTo)
  );
  const rows = filtered.slice().sort((a, b) => {
    if (a.date === b.date) return 0;
    const cmp = a.date < b.date ? -1 : 1;
    return _cashflowLedgerSort === "date-asc" ? cmp : -cmp;
  });

  tbody.innerHTML = rows.length ? rows.map(cashflowRowHtml).join("") : '<tr><td colspan="8">No transactions match this filter.</td></tr>';
  paginateTable("cashflowLedgerTbody", "cashflowLedgerPaginationNav", 10);
}

function openCashflowLogFilterSortModal() {
  const sortOptions = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  const checkboxes = (_cashflowCategoryOptions || []).map((c) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="cashflowCategoryFilterCheck" value="' + c + '"' + (_cashflowLedgerCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c +
    "</label>"
  ).join("");
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="cashflowLedgerSortOption" value="' + val + '"' + (_cashflowLedgerSort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Cashflow Ledger</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="cashflowLedgerDateFrom" value="' + _cashflowLedgerDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="cashflowLedgerDateTo" value="' + _cashflowLedgerDateTo + '">' +
    "</div><br><br>" +
    "<label>Category</label>" +
    "<div>" + checkboxes + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyCashflowLedgerFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyCashflowLedgerFilterSort() {
  _cashflowLedgerDateFrom = document.getElementById("cashflowLedgerDateFrom").value || "";
  _cashflowLedgerDateTo = document.getElementById("cashflowLedgerDateTo").value || "";
  _cashflowLedgerCategoryFilter = Array.from(document.querySelectorAll(".cashflowCategoryFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="cashflowLedgerSortOption"]:checked');
  if (selectedSort) _cashflowLedgerSort = selectedSort.value;
  closeModal();
  renderCashflowLedgerRows();
}

// Transaction ID rides muted underneath Date now (not its own column),
// same "shared context lives under Date" pattern as pages/sales.js's
// dateCell (Channel/Order ID underneath).
function cashflowRowHtml(r) {
  return (
    "<tr>" +
      '<td style="white-space:nowrap;">' + r.date + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + r.txnCode + "</span></td>" +
      "<td>" + r.type + "</td>" +
      "<td>" + r.category + "</td>" +
      "<td>" + (r.description || "") + "</td>" +
      '<td><span class="font-number">' + (r.cashIn ? formatRupiah(r.cashIn) : "") + "</span></td>" +
      '<td><span class="font-number">' + (r.cashOut ? formatRupiah(r.cashOut) : "") + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.balance) + "</span></td>" +
      "<td>" + (r.notes || "") + "</td>" +
    "</tr>"
  );
}

// ================================================================
// Entry modal (opened over the Cashflow page via "Input Transaction" -
// the page behind it never navigates away, so it stays mounted and the
// navbar's active-page state is untouched). Form itself is unchanged
// from before, just no longer a separate route. Ported from
// 02 Finance/Cashflow/CashflowEntry.html + CashflowEntry_JS.html.
// ================================================================

async function openCashflowEntryModal() {
  await Promise.all([ensureCashflowCategoryDefs(), ensureCashflowDescriptionOptions()]);
  openModal(buildCashflowFormHtml());
  initCashflowForm();
}

function buildCashflowFormHtml() {
  return (
    "<h2>Input Transaction</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="cfToday" onchange="setCfToday()">' +
      '<label for="cfToday">Today</label>' +
      '<input type="date" id="cfDate">' +
    "</div><br>" +

    "<label>Account</label><br>" +
    '<select id="cfAccount"><option>Bank</option><option>Cash</option></select>' +
    "<br><br>" +

    // One header row for the whole list (not per-item field labels), same
    // table/colgroup pattern as Input Sales - Notes now rides in its own
    // column aligned with every other field instead of trailing below.
    '<table style="table-layout:fixed; width:auto;">' +
      '<colgroup><col style="width:230px;"><col style="width:160px;"><col style="width:160px;"><col style="width:120px;"><col style="width:74px;"></colgroup>' +
      "<thead><tr><th>Description</th><th>Amount</th><th>Category</th><th>Notes</th><th></th></tr></thead>" +
      '<tbody id="cashflowRows"></tbody>' +
    "</table>" +
    '<button type="button" onclick="addCashflowRow()">+ Add Entry</button>' +
    "<br><br>" +

    '<button id="saveCashflowBtn" class="btn-primary" onclick="saveCashflow()">Save</button>' +
    '<span id="saveCashflowStatus" class="save-status"></span>'
  );
}

function initCashflowForm() {
  // Date starts empty - pick a date explicitly (Today included) rather
  // than silently defaulting to today, per explicit request (same pattern
  // applied across every other modal - Orders, Purchase, OpEx, ...).
  document.getElementById("cashflowRows").innerHTML = "";
  addCashflowRow();
}

function setCfToday() {
  if (document.getElementById("cfToday").checked) document.getElementById("cfDate").value = todayISO();
}

function addCashflowRow() {
  const wrap = document.getElementById("cashflowRows");
  const row = document.createElement("tr");
  row.className = "cashflow-item-row";
  row.innerHTML =
    '<td><div class="cfDescCombo"></div></td>' +
    '<td><input type="text" class="cfAmount" inputmode="numeric" style="width:100%; box-sizing:border-box;" oninput="formatAmount(this)"></td>' +
    '<td><select class="cfCategory" style="width:100%; box-sizing:border-box;" onchange="onCashflowCategoryChange(this)"></select><input type="hidden" class="cfType"></td>' +
    '<td><input type="text" class="cfNotes" style="width:100%; box-sizing:border-box;"></td>' +
    '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeCashflowRow(this)">Remove</button></td>';
  wrap.appendChild(row);

  // Free-text combobox - pick a Description used before (for consistency
  // across repeated entries, per explicit request) or type a brand-new one.
  row._descCombo = createCombobox(
    row.querySelector(".cfDescCombo"),
    _cashflowDescriptionOptions.map((d) => ({ value: d, label: d })),
    { placeholder: "Type or pick a description...", allowFreeText: true, commitValue: true }
  );

  const categorySelect = row.querySelector(".cfCategory");
  categorySelect.innerHTML = _cashflowCategoryOptions.map((c) => "<option>" + c + "</option>").join("");
  onCashflowCategoryChange(categorySelect);
}

function removeCashflowRow(btn) {
  const rows = document.querySelectorAll("#cashflowRows .cashflow-item-row");
  if (rows.length <= 1) return;
  btn.closest(".cashflow-item-row").remove();
}

// Category drives Type now (not the other way around) - Type is a readonly
// display auto-filled from the category's settings_lists meta
// (_cashflowCategoryDefs), never a separate user choice.
function onCashflowCategoryChange(categorySelect) {
  const row = categorySelect.closest(".cashflow-item-row");
  const def = _cashflowCategoryDefs[categorySelect.value];
  row.querySelector(".cfType").value = def ? def.type : "";
}

function collectCashflowItems() {
  const items = [];
  document.querySelectorAll("#cashflowRows .cashflow-item-row").forEach((row) => {
    const category = row.querySelector(".cfCategory").value;
    const type = row.querySelector(".cfType").value;
    const desc = row._descCombo ? row._descCombo.getValue() : "";
    const amount = parseAmount(row.querySelector(".cfAmount").value);
    const notes = row.querySelector(".cfNotes").value;

    if (!type && !category && !desc.trim() && !amount) return; // skip a fully-empty row
    items.push({ type: type, category: category, desc: desc, amount: amount, notes: notes });
  });
  return items;
}

async function saveCashflow() {
  const date = document.getElementById("cfDate").value;
  const account = document.getElementById("cfAccount").value;
  const items = collectCashflowItems();

  if (!date) { alert("Please select a date."); return; }
  if (!items.length) { alert("Please add at least one entry."); return; }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.category) { alert("Please select a category for row " + (i + 1) + "."); return; }
    if (!it.desc.trim()) { alert("Please enter a description for row " + (i + 1) + "."); return; }
    if (!it.amount || it.amount <= 0) { alert("Please enter a valid amount for row " + (i + 1) + "."); return; }
  }

  const btn = document.getElementById("saveCashflowBtn");
  const statusEl = document.getElementById("saveCashflowStatus");

  withSaveStatus(btn, statusEl, "Transaction", async function () {
    const created = await api("cashflow", { method: "POST", body: { date: date, account: account, items: items } });
    closeModal();
    await Promise.all([loadCashflowSummary(), loadCashflowLedger(_activeCfAccount)]);
    return created;
  });
}
