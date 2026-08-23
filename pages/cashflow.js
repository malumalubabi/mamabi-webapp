registerPage("cashflow", renderCashflowPage);

// Mirrors functions/api/cashflow.js's CATEGORY_DEFS - cross-checked against
// the "Category | Type | Flow" reference table in the original Google
// Sheets migration source ("01. Cashflow"), not just what's already been
// used in migrated data.
const CASHFLOW_CATEGORY_DEFS = [
  { name: "Sales Revenue", type: "Operating", flow: "IN" },
  { name: "Other Income", type: "Operating", flow: "IN" },
  { name: "Food Cost", type: "Operating", flow: "OUT" },
  { name: "Packaging", type: "Operating", flow: "OUT" },
  { name: "Operating Expenses", type: "Operating", flow: "OUT" },
  { name: "Payroll", type: "Operating", flow: "OUT" },
  { name: "Rent", type: "Operating", flow: "OUT" },
  { name: "Utilities", type: "Operating", flow: "OUT" },
  { name: "Marketing", type: "Operating", flow: "OUT" },
  { name: "Logistics", type: "Operating", flow: "OUT" },
  { name: "Maintenance", type: "Operating", flow: "OUT" },
  { name: "Licenses", type: "Operating", flow: "OUT" },
  { name: "Miscellaneous Expenses", type: "Operating", flow: "OUT" },
  { name: "Capital Contribution", type: "Financing", flow: "IN" },
  { name: "Loan Proceeds", type: "Financing", flow: "IN" },
  { name: "Loan Repayment", type: "Financing", flow: "OUT" },
  { name: "Capital Expenditure", type: "Investing", flow: "OUT" }
];
const CASHFLOW_TYPES = ["Operating", "Financing", "Investing"];

let _activeCfAccount = "Bank";

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
  await Promise.all([loadCashflowSummary(), loadCashflowLedger(_activeCfAccount)]);
}

// ---------- Monthly summary (simplified from CashflowSummaryMonthly.html - Type-level net, not per-category/per-account) ----------

function buildCashflowSummaryShellHtml() {
  return (
    "<h3>Summary</h3>" +
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
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div class="tabs" style="margin-bottom:0;">' +
        '<button id="cfTab-Bank" class="tab-active" onclick="switchCashflowLedgerTab(\'Bank\')">Bank</button>' +
        '<button id="cfTab-Cash" onclick="switchCashflowLedgerTab(\'Cash\')">Cash</button>' +
      "</div>" +
      '<button onclick="openCashflowEntryModal()">+ Input Transaction</button>' +
    "</div>" +
    '<div id="cashflowLedgerPaginationNav" class="pagination-nav"></div>' +
    '<div id="cashflowLedgerScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>Transaction ID</th><th>Date</th><th>Type</th><th>Category</th><th>Description</th>" +
        "<th>Cash In</th><th>Cash Out</th><th>Balance</th><th>Notes</th></tr></thead>" +
        '<tbody id="cashflowLedgerTbody"><tr><td colspan="9">Loading...</td></tr></tbody>' +
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

async function loadCashflowLedger(account) {
  const tbody = document.getElementById("cashflowLedgerTbody");
  tbody.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';

  const rows = await api("cashflow?account=" + encodeURIComponent(account));
  if (!document.getElementById("cashflowLedgerTbody")) return;

  tbody.innerHTML = rows.length ? rows.map(cashflowRowHtml).join("") : '<tr><td colspan="9">No transactions yet.</td></tr>';
  paginateTable("cashflowLedgerTbody", "cashflowLedgerPaginationNav", 20);
}

function cashflowRowHtml(r) {
  return (
    "<tr>" +
      "<td>" + r.txnCode + "</td>" +
      "<td>" + r.date + "</td>" +
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

function openCashflowEntryModal() {
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
    '<div><label>Type</label><br><select class="cfType" onchange="loadCategoriesForRow(this)"></select></div>' +
    '<div><label>Category</label><br><select class="cfCategory" style="min-width:160px;"></select></div>' +
    '<div><label>Description</label><br><input type="text" class="cfDesc"></div>' +
    '<div><label>Amount</label><br><input type="text" class="cfAmount" inputmode="numeric" oninput="formatAmount(this)"></div>' +
    '<div><label>Notes</label><br><input type="text" class="cfNotes"></div>' +
    '<button type="button" onclick="removeCashflowRow(this)">Remove</button>';
  wrap.appendChild(row);

  const typeSelect = row.querySelector(".cfType");
  typeSelect.innerHTML = CASHFLOW_TYPES.map((t) => "<option>" + t + "</option>").join("");
  loadCategoriesForRow(typeSelect);
}

function removeCashflowRow(btn) {
  const rows = document.querySelectorAll("#cashflowRows .item-row");
  if (rows.length <= 1) return;
  btn.closest(".item-row").remove();
}

function loadCategoriesForRow(typeSelect) {
  const row = typeSelect.closest(".item-row");
  const categorySelect = row.querySelector(".cfCategory");
  const type = typeSelect.value;

  const options = CASHFLOW_CATEGORY_DEFS.filter((c) => c.type === type);
  categorySelect.innerHTML = options.map((c) => "<option>" + c.name + "</option>").join("");
}

function collectCashflowItems() {
  const items = [];
  document.querySelectorAll("#cashflowRows .item-row").forEach((row) => {
    const type = row.querySelector(".cfType").value;
    const category = row.querySelector(".cfCategory").value;
    const desc = row.querySelector(".cfDesc").value;
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
