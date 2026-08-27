registerPage("cashflow", renderCashflowPage);

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
    "<h2>Cashflow</h2>" +
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
        .map((m) => "<td>" + formatRupiah(m.in) + "</td><td>" + formatRupiah(m.out) + "</td><td>" + formatRupiah(m.net) + "</td>")
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
        '<span id="cashflowFilterBadge" style="color:var(--color-text-muted); font-size:12px;">' + (_cashflowLedgerCategoryFilter.length ? _cashflowLedgerCategoryFilter.join(", ") : "All") + "</span>" +
        '<button onclick="openCashflowLogFilterModal()">Set Filter</button>' +
        '<span id="cashflowLedgerSortBadge" style="color:var(--color-text-muted); font-size:12px;">Sort: ' + CASHFLOW_LEDGER_SORT_LABELS[_cashflowLedgerSort] + "</span>" +
        '<button onclick="openCashflowLogSortModal()">Sort</button>' +
        '<button onclick="openCashflowEntryModal()">+ Input Transaction</button>' +
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
let _cashflowLedgerSort = "date-desc";
const CASHFLOW_LEDGER_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

async function loadCashflowLedger(account) {
  const tbody = document.getElementById("cashflowLedgerTbody");
  tbody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';

  _lastCashflowLedgerRows = await api("cashflow?account=" + encodeURIComponent(account));
  if (!document.getElementById("cashflowLedgerTbody")) return;

  renderCashflowLedgerRows();
}

function renderCashflowLedgerRows() {
  const tbody = document.getElementById("cashflowLedgerTbody");
  if (!tbody) return;

  const sortBadge = document.getElementById("cashflowLedgerSortBadge");
  if (sortBadge) sortBadge.textContent = "Sort: " + CASHFLOW_LEDGER_SORT_LABELS[_cashflowLedgerSort];

  const filtered = _cashflowLedgerCategoryFilter.length
    ? _lastCashflowLedgerRows.filter((r) => _cashflowLedgerCategoryFilter.indexOf(r.category) !== -1)
    : _lastCashflowLedgerRows;
  const rows = filtered.slice().sort((a, b) => {
    if (a.date === b.date) return 0;
    const cmp = a.date < b.date ? -1 : 1;
    return _cashflowLedgerSort === "date-asc" ? cmp : -cmp;
  });

  tbody.innerHTML = rows.length ? rows.map(cashflowRowHtml).join("") : '<tr><td colspan="8">No transactions match this filter.</td></tr>';
  paginateTable("cashflowLedgerTbody", "cashflowLedgerPaginationNav", 20);
}

function openCashflowLogSortModal() {
  const options = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];
  openModal(
    "<h2>Sort Cashflow Ledger</h2>" +
    options.map(([val, label]) =>
      '<label style="display:block; margin:6px 0;"><input type="radio" name="cashflowLedgerSortOption" value="' + val + '"' + (_cashflowLedgerSort === val ? " checked" : "") + "> " + label + "</label>"
    ).join("") +
    '<br><button onclick="applyCashflowLedgerSort()">Apply</button>'
  );
}

function applyCashflowLedgerSort() {
  const selected = document.querySelector('input[name="cashflowLedgerSortOption"]:checked');
  if (!selected) return;
  _cashflowLedgerSort = selected.value;
  closeModal();
  renderCashflowLedgerRows();
}

function openCashflowLogFilterModal() {
  const checkboxes = (_cashflowCategoryOptions || []).map((c) =>
    '<label style="display:block; margin:4px 0;">' +
      '<input type="checkbox" class="cashflowCategoryFilterCheck" value="' + c + '"' + (_cashflowLedgerCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c +
    "</label>"
  ).join("");

  openModal(
    "<h2>Set Filter - Category</h2>" +
    "<div>" + checkboxes + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button onclick="closeModal()">Cancel</button> ' +
      '<button onclick="applyCashflowLedgerFilter()">Apply Filter</button>' +
    "</div>"
  );
}

function applyCashflowLedgerFilter() {
  _cashflowLedgerCategoryFilter = Array.from(document.querySelectorAll(".cashflowCategoryFilterCheck:checked")).map((cb) => cb.value);
  closeModal();
  const badge = document.getElementById("cashflowFilterBadge");
  if (badge) badge.textContent = _cashflowLedgerCategoryFilter.length ? _cashflowLedgerCategoryFilter.join(", ") : "All";
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
      "<td>" + (r.cashIn ? formatRupiah(r.cashIn) : "") + "</td>" +
      "<td>" + (r.cashOut ? formatRupiah(r.cashOut) : "") + "</td>" +
      "<td>" + formatRupiah(r.balance) + "</td>" +
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
    "</div><br><br>" +

    "<label>Account</label><br>" +
    '<select id="cfAccount"><option>Bank</option><option>Cash</option></select>' +
    "<br><br>" +

    "<label>Entries</label>" +
    '<div id="cashflowRows"></div>' +
    '<button type="button" onclick="addCashflowRow()">+ Add Entry</button>' +
    "<br><br>" +

    '<button id="saveCashflowBtn" onclick="saveCashflow()">Save</button>' +
    '<span id="saveCashflowStatus" class="save-status"></span>'
  );
}

function initCashflowForm() {
  document.getElementById("cfDate").value = todayISO();
  document.getElementById("cashflowRows").innerHTML = "";
  addCashflowRow();
}

function setCfToday() {
  if (document.getElementById("cfToday").checked) document.getElementById("cfDate").value = todayISO();
}

function addCashflowRow() {
  const wrap = document.getElementById("cashflowRows");
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<div><label>Description</label><br><div class="cfDescCombo" style="min-width:200px;"></div></div>' +
    '<div><label>Amount</label><br><input type="text" class="cfAmount" inputmode="numeric" oninput="formatAmount(this)"></div>' +
    '<div><label>Category</label><br><select class="cfCategory" style="min-width:180px;" onchange="onCashflowCategoryChange(this)"></select></div>' +
    '<div><label>Type</label><br><input type="text" class="cfType" readonly style="background:var(--color-disabled-bg);"></div>' +
    '<div><label>Notes</label><br><input type="text" class="cfNotes"></div>' +
    '<button type="button" onclick="removeCashflowRow(this)">Remove</button>';
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
  const rows = document.querySelectorAll("#cashflowRows .item-row");
  if (rows.length <= 1) return;
  btn.closest(".item-row").remove();
}

// Category drives Type now (not the other way around) - Type is a readonly
// display auto-filled from the category's settings_lists meta
// (_cashflowCategoryDefs), never a separate user choice.
function onCashflowCategoryChange(categorySelect) {
  const row = categorySelect.closest(".item-row");
  const def = _cashflowCategoryDefs[categorySelect.value];
  row.querySelector(".cfType").value = def ? def.type : "";
}

function collectCashflowItems() {
  const items = [];
  document.querySelectorAll("#cashflowRows .item-row").forEach((row) => {
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
