registerPage("batch-production", renderBatchProductionPage);
registerPage("menu-engineering", renderMenuEngineeringPage);

// Simplified stand-in for the old app's recipe/BOM-driven Batch Production
// (06 Menu/MenuBatchProduction.html - startBatch/markBatchDone, scaled off
// recipe_lines). recipe_lines is now populated (see the Menu Engineering
// section below), but consumption entry here is still manual (approved
// substitute) - only Base Yield reads from it so far: pick the output SKU,
// batch size, yield, and manually list what was consumed. See
// functions/api/batches.js for the backend.
const BATCH_STOCKABLE_TYPES = ["Ingredient", "Packaging", "Operating", "Semi-Finished", "Component"];
const BATCH_OUTPUT_TYPES = ["Semi-Finished", "Component"];

let _batchLookups = null;
let _batchOutputCombo = null;
let _activeBatchScope = "ongoing";
let _lastBatchesData = [];

async function renderBatchProductionPage(content) {
  content.innerHTML = "<h2>Batch Production</h2>" + buildBatchTabsShellHtml();
  await ensureBatchLookups();
  wireBatchTabs();
  await loadBatchTable(_activeBatchScope);
}

async function ensureBatchLookups() {
  if (!_batchLookups) _batchLookups = await api("lookups");
  return _batchLookups;
}

function batchStockableSkus() {
  return _batchLookups.skus.filter((s) => BATCH_STOCKABLE_TYPES.indexOf(s.item_type) !== -1);
}

// ================================================================
// Ongoing Batches / Batch History - tab pattern ported from
// pages/orders.js (Ongoing Orders / Order History): one shared table
// wrap + pagination nav, swapped per active tab. "Ongoing Batches"
// concept (live list + Mark Done) is from MenuBatchProduction.html;
// the recipe-detail/change-component/edit-scaled-qty actions there are
// tied to the BOM system we don't have, so not ported. "Batch History"
// (full log, all statuses) is from 06 Menu/BatchHistoryTable.html.
// ================================================================

function buildBatchTabsShellHtml() {
  return (
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div class="tabs" style="margin-bottom:0;">' +
        '<button id="batchTab-ongoing" class="tab-active" onclick="switchBatchTab(\'ongoing\')">Ongoing Batches</button>' +
        '<button id="batchTab-history" onclick="switchBatchTab(\'history\')">Batch History</button>' +
      "</div>" +
      '<button onclick="openBatchModal()">+ Start New Batch</button>' +
    "</div>" +
    '<div id="batchTableWrap"><p>Loading...</p></div>'
  );
}

function wireBatchTabs() {
  _activeBatchScope = "ongoing";
}

function switchBatchTab(scope) {
  if (scope === _activeBatchScope) return;
  _activeBatchScope = scope;
  document.getElementById("batchTab-ongoing").classList.toggle("tab-active", scope === "ongoing");
  document.getElementById("batchTab-history").classList.toggle("tab-active", scope === "history");
  loadBatchTable(scope);
}

async function loadBatchTable(scope) {
  const wrap = document.getElementById("batchTableWrap");
  wrap.innerHTML = "<p>Loading...</p>";

  const rows = await api("batches?scope=" + scope);
  if (!document.getElementById("batchTableWrap")) return;

  _lastBatchesData = rows;
  renderBatchTable(wrap, rows, scope);
}

function renderBatchTable(wrap, rows, scope) {
  const title = scope === "ongoing" ? "Ongoing Batches" : "Batch History";

  if (!rows.length) {
    wrap.innerHTML = "<h3>" + title + "</h3>" + (scope === "ongoing" ? "<p>No ongoing batches.</p>" : "<p>No batches yet.</p>");
    return;
  }

  // Ongoing Batches columns match the old app's MenuBatchProduction.html
  // table exactly (Batch ID/Date/Recipe/Base Yield (g)/Scaled Qty/Scaled
  // Yield (g)/actions) - Base Yield now reads sku_items.base_yield_qty (via
  // lookups, see baseYieldFor()). Batch History keeps its own separate
  // column set (unaffected by this - see batchHistoryRowHtml).
  const head = scope === "ongoing"
    ? "<tr><th>Batch ID</th><th>Date</th><th>Category</th><th>Recipe</th><th>Batch Size</th><th>Base Yield (g)</th><th>Scaled Yield (g)</th><th></th></tr>"
    : "<tr><th>Batch ID</th><th>Date</th><th>Category</th><th>Item Name</th><th>Batch Size</th><th>Yield</th><th>Status</th><th>Notes</th></tr>";

  const bodyRows = scope === "ongoing" ? rows.map(ongoingBatchRowHtml).join("") : rows.map(batchHistoryRowHtml).join("");

  wrap.innerHTML =
    "<h3>" + title + "</h3>" +
    '<div id="batchPaginationNav" class="pagination-nav"></div>' +
    '<div id="batchScrollWrap" style="overflow-x:auto;">' +
      "<table><thead>" + head + "</thead>" +
      '<tbody id="batchTbody">' + bodyRows + "</tbody></table>" +
    "</div>";

  paginateTable("batchTbody", "batchPaginationNav", 20);
  enableDragScroll(document.getElementById("batchScrollWrap"));
}

// Item Name + SKU (small, gray, underneath) + Open Recipe - used by Batch
// History only now (Ongoing Batches has its own "Recipe" cell below, with
// Change Component alongside Open Recipe, matching the old app).
function itemNameCell(b) {
  return (
    b.itemName +
    '<br><span style="color:#666; font-size:12px;">' + b.sku + "</span>" +
    '<br><button onclick="openBatchRecipeModal(\'' + b.batchCode + '\')">Open Recipe</button>'
  );
}

// "Recipe" cell - ported from MenuBatchProduction_JS.html's recipeViewHtml().
// Change Component there swaps in a live combobox to re-point the batch at
// a different recipe SKU; without a BOM to re-scale from, it's a "Coming
// soon" placeholder here.
function recipeCell(b) {
  return (
    b.itemName +
    '<br><span style="color:#666; font-size:12px;">' + b.sku + "</span>" +
    '<br><button onclick="openBatchRecipeModal(\'' + b.batchCode + '\')">Open Recipe</button> ' +
    '<button onclick="changeComponentPlaceholder()">Change Component</button>'
  );
}

function changeComponentPlaceholder() {
  alert("Coming soon");
}

// Batch Size cell - view/edit toggle ported from MenuBatchProduction_JS.html's
// scaledQtyViewHtml()/enterEditScaledQtyMode(), inline in the row (separate
// from - but backed by the same PATCH as - the Open Recipe modal's own Edit
// Batch Size).
function scaledQtyViewHtml(raw) {
  return (raw === "" ? "" : raw) + ' <button onclick="startEditScaledQty(this)">Edit</button>';
}

function startEditScaledQty(btn) {
  const cell = btn.closest(".scaledQty");
  cell.innerHTML =
    '<input type="number" class="scaledQtyInput" min="0" step="any" value="' + cell.dataset.raw + '" style="width:70px;"> ' +
    '<button onclick="saveScaledQty(this)">Save</button> ' +
    '<button onclick="cancelEditScaledQty(this)">Cancel</button>';
}

function cancelEditScaledQty(btn) {
  const cell = btn.closest(".scaledQty");
  cell.innerHTML = scaledQtyViewHtml(cell.dataset.raw);
}

function saveScaledQty(btn) {
  const cell = btn.closest(".scaledQty");
  const batchCode = cell.dataset.batchCode;
  const newQty = cell.querySelector(".scaledQtyInput").value;
  if (newQty === "" || Number(newQty) < 0) { alert("Please enter a valid Batch Size."); return; }

  withInlineSaveStatus(btn, "Batch Size", async function () {
    await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { batchSize: Number(newQty) } });
    await loadBatchTable(_activeBatchScope);
  });
}

// From lookups.skus (recipe_lines' base_yield_qty, filled in from the
// imported recipe data) - the expected yield of ONE batch run at this
// item's base recipe, before this batch's own Batch Size multiplier.
function baseYieldFor(sku) {
  const item = _batchLookups.skus.find((s) => s.sku === sku);
  return item && item.base_yield_qty !== null && item.base_yield_qty !== undefined ? item.base_yield_qty : "";
}

function ongoingBatchRowHtml(b) {
  const raw = b.batchSize === null ? "" : b.batchSize;
  return (
    "<tr>" +
      "<td>" + b.batchCode + "</td>" +
      "<td>" + b.date + "</td>" +
      "<td>" + (b.category || "") + "</td>" +
      "<td>" + recipeCell(b) + "</td>" +
      '<td class="scaledQty" data-batch-code="' + b.batchCode + '" data-raw="' + raw + '">' + scaledQtyViewHtml(raw) + "</td>" +
      "<td>" + baseYieldFor(b.sku) + "</td>" +
      "<td>" + (b.yieldQty === null ? "" : b.yieldQty) + "</td>" +
      "<td>" +
        '<button onclick="markBatchDone(this, \'' + b.batchCode + '\')">Mark Done</button> ' +
        '<button onclick="cancelBatch(\'' + b.batchCode + '\')">Cancel Batch</button>' +
      "</td>" +
    "</tr>"
  );
}

function batchHistoryRowHtml(b) {
  return (
    "<tr>" +
      "<td>" + b.batchCode + "</td>" +
      "<td>" + b.date + "</td>" +
      "<td>" + (b.category || "") + "</td>" +
      "<td>" + itemNameCell(b) + "</td>" +
      "<td>" + (b.batchSize === null ? "" : b.batchSize) + "</td>" +
      "<td>" + (b.yieldQty === null ? "" : b.yieldQty) + "</td>" +
      "<td>" + b.status + "</td>" +
      "<td>" + (b.notes || "") + "</td>" +
    "</tr>"
  );
}

function markBatchDone(btn, batchCode) {
  if (!confirm("Mark batch " + batchCode + " as Done? This will count its yield into stock.")) return;

  withInlineSaveStatus(btn, "Batch", async function () {
    await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { status: "Done" } });
    await loadBatchTable(_activeBatchScope);
  });
}

// Ported from MenuBatchProduction_JS.html's cancelBatch() - same confirm
// wording. Sets status to Cancelled, which moves it out of Ongoing Batches
// and into Batch History (see the scope filter in functions/api/batches.js).
function cancelBatch(batchCode) {
  if (!confirm("Cancel batch " + batchCode + "? This will remove it from Ongoing Batches and move it to Batch History with status Cancelled.")) return;

  api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { status: "Cancelled" } })
    .then(() => loadBatchTable(_activeBatchScope))
    .catch((err) => alert(err.message));
}

// Ported concept from MenuBatchProduction_JS.html's showBatchRecipeDetail()
// / BatchRecipeDetailTable.html ("Recipe Detail" panel) - shown there as an
// inline expand area with recipe-scaled cost columns (Base Qty/Scaled Qty/
// Unit Cost/Line Cost). Base Qty now reads recipe_lines (via
// GET /api/costing?sku=<batch output SKU>, matched back to each consumption
// row by component SKU) - a row consumed but not in the recipe (or the
// recipe not covering this combination yet) just shows "-", not an error.
// Scaled Qty is real, from production_consumption (already present in the
// batches list response - no extra fetch needed for that column). "Edit
// Batch Size" (production_batches.batch_size) lives in this same modal,
// mirroring the old app's updateBatchScaledQty() being reachable from the
// same recipe-detail context - starts as a plain value + Edit button (not
// an already-open input) so it's not accidentally typed into, same
// view/edit-toggle pattern as Stock Overview's editMinStock/saveMinStock.
async function openBatchRecipeModal(batchCode) {
  const batch = _lastBatchesData.find((b) => b.batchCode === batchCode);
  const items = batch ? batch.consumption || [] : [];

  let baseQtyBySku = {};
  if (batch && batch.sku) {
    try {
      const recipe = await api("costing?sku=" + encodeURIComponent(batch.sku));
      recipe.items.forEach((it) => { baseQtyBySku[it.sku] = it; });
    } catch (err) {
      baseQtyBySku = {}; // recipe lookup failing shouldn't block showing the modal at all
    }
  }

  const rows = items.length
    ? items.map((c) => {
        const line = baseQtyBySku[c.sku];
        const baseQty = line ? line.qty + " " + line.unit : "-";
        return "<tr><td>" + c.name + "</td><td>" + baseQty + "</td><td>" + c.qty + "</td></tr>";
      }).join("")
    : '<tr><td colspan="3">No consumption recorded.</td></tr>';

  const title = batch
    ? "Recipe Detail — " + batch.itemName + ' <span style="font-size:12px; color:#666; font-weight:normal;">(' + batch.sku + ")</span>"
    : "Recipe Detail";

  const raw = batch && batch.batchSize !== null ? batch.batchSize : "";

  openModal(
    "<h2>" + title + "</h2>" +
    '<div id="batchQtySection" data-batch-code="' + batchCode + '" data-raw="' + raw + '" style="margin-bottom:16px;">' +
      batchQtyViewHtml(raw) +
    "</div>" +
    "<table><thead><tr><th>Item Name</th><th>Base Qty</th><th>Scaled Qty</th></tr></thead>" +
    "<tbody>" + rows + "</tbody></table>"
  );
}

function batchQtyViewHtml(raw) {
  return (
    "<label>Batch Size</label><br>" +
    (raw === "" ? "-" : raw) + " " +
    '<button onclick="startEditBatchQty()">Edit</button>'
  );
}

function startEditBatchQty() {
  const section = document.getElementById("batchQtySection");
  section.innerHTML =
    "<label>Batch Size</label><br>" +
    '<input type="number" class="batchQtyInput" min="0" step="any" value="' + section.dataset.raw + '" style="width:100px;"> ' +
    '<button class="saveBatchQtyBtn" onclick="saveBatchQty(this)">Save</button> ' +
    '<button onclick="cancelEditBatchQty()">Cancel</button>' +
    '<span class="save-status"></span>';
}

function cancelEditBatchQty() {
  const section = document.getElementById("batchQtySection");
  section.innerHTML = batchQtyViewHtml(section.dataset.raw);
}

function saveBatchQty(btn) {
  const section = document.getElementById("batchQtySection");
  const batchCode = section.dataset.batchCode;
  const newQty = section.querySelector(".batchQtyInput").value;
  if (newQty === "" || Number(newQty) < 0) { alert("Please enter a valid Batch Size."); return; }

  const statusEl = section.querySelector(".save-status");
  withSaveStatus(btn, statusEl, "Batch Size", async function () {
    await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { batchSize: Number(newQty) } });
    closeModal();
    await loadBatchTable(_activeBatchScope);
  });
}

// ================================================================
// Start New Batch modal - form itself unchanged from before.
// ================================================================

function openBatchModal() {
  openModal(buildBatchFormHtml());
  initBatchForm();
}

function buildBatchFormHtml() {
  return (
    "<h2>Start New Batch</h2>" +
    "<label>Date</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="checkbox" id="batchToday" onchange="setBatchToday()">' +
      '<label for="batchToday">Today</label>' +
      '<input type="date" id="batchDate">' +
    "</div><br><br>" +

    "<label>Output SKU</label><br>" +
    '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
      '<div id="batchOutputCombo" style="min-width:260px;"></div>' +
      '<input type="text" id="batchOutputCategory" disabled placeholder="Category" style="background:#f5f5f5; width:120px;">' +
      '<input type="text" id="batchOutputUnit" disabled placeholder="Unit" style="background:#f5f5f5; width:70px;">' +
    "</div><br><br>" +

    '<div style="display:flex; gap:20px;">' +
      "<div><label>Batch Size</label><br><input type=\"number\" id=\"batchSize\" min=\"0\" step=\"any\"></div>" +
      "<div><label>Yield</label><br><input type=\"number\" id=\"batchYield\" min=\"0\" step=\"any\"></div>" +
      "<div><label>Status</label><br><select id=\"batchStatus\"><option>Ongoing</option><option>Done</option></select></div>" +
    "</div><br><br>" +

    "<label>Consumption</label>" +
    '<div id="batchConsumptionRows"></div>' +
    '<button type="button" onclick="addBatchConsumptionRow()">+ Add Consumed Item</button><br><br>' +

    "<label>Notes</label><br>" +
    '<input type="text" id="batchNotes"><br><br>' +

    '<button id="saveBatchBtn" onclick="saveBatch()">Save Batch</button>' +
    '<span id="saveBatchStatus" class="save-status"></span>'
  );
}

function initBatchForm() {
  document.getElementById("batchDate").value = todayISO();

  _batchOutputCombo = createCombobox(
    document.getElementById("batchOutputCombo"),
    _batchLookups.skus.filter((s) => BATCH_OUTPUT_TYPES.indexOf(s.item_type) !== -1).map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select output SKU...",
      onSelect: function (skuId) {
        const item = _batchLookups.skus.find((s) => s.id === skuId);
        document.getElementById("batchOutputCategory").value = item ? item.category || "" : "";
        document.getElementById("batchOutputUnit").value = item ? item.unit : "";
      }
    }
  );

  document.getElementById("batchConsumptionRows").innerHTML = "";
  addBatchConsumptionRow();
}

function setBatchToday() {
  if (document.getElementById("batchToday").checked) document.getElementById("batchDate").value = todayISO();
}

function addBatchConsumptionRow() {
  const wrap = document.getElementById("batchConsumptionRows");
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML =
    '<div><label>Item</label><br><div class="sku-combo" style="min-width:220px;"></div></div>' +
    '<div><label>Unit</label><br><input type="text" class="unit" disabled style="background:#f5f5f5; width:55px;"></div>' +
    '<div><label>Qty</label><br><input type="number" class="qty" min="0" step="any"></div>' +
    '<button type="button" onclick="removeBatchConsumptionRow(this)">Remove</button>';
  wrap.appendChild(row);

  const combo = createCombobox(
    row.querySelector(".sku-combo"),
    batchStockableSkus().map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select item...",
      allowFreeText: false,
      onSelect: function (skuId) {
        const item = _batchLookups.skus.find((s) => s.id === skuId);
        row.querySelector(".unit").value = item ? item.unit : "";
      }
    }
  );
  row._combo = combo;
}

function removeBatchConsumptionRow(btn) {
  const rows = document.querySelectorAll("#batchConsumptionRows .item-row");
  if (rows.length <= 1) return;
  btn.closest(".item-row").remove();
}

function collectBatchConsumption() {
  const items = [];
  document.querySelectorAll("#batchConsumptionRows .item-row").forEach((row) => {
    const skuId = row._combo.getValue();
    const qty = Number(row.querySelector(".qty").value) || 0;
    if (skuId && qty > 0) items.push({ skuId: skuId, qty: qty });
  });
  return items;
}

async function saveBatch() {
  const outputSkuId = _batchOutputCombo.getValue();
  if (!document.getElementById("batchDate").value) { alert("Please select a date."); return; }
  if (!outputSkuId) { alert("Please select an output SKU."); return; }

  const btn = document.getElementById("saveBatchBtn");
  const statusEl = document.getElementById("saveBatchStatus");

  withSaveStatus(btn, statusEl, "Batch", async function () {
    const outputItem = _batchLookups.skus.find((s) => s.id === outputSkuId);
    const payload = {
      date: document.getElementById("batchDate").value,
      outputSkuId: outputSkuId,
      category: outputItem ? outputItem.category || null : null,
      batchSize: Number(document.getElementById("batchSize").value) || null,
      yieldQty: Number(document.getElementById("batchYield").value) || null,
      status: document.getElementById("batchStatus").value,
      notes: document.getElementById("batchNotes").value || null,
      consumption: collectBatchConsumption()
    };

    const created = await api("batches", { method: "POST", body: payload });
    closeModal();
    await loadBatchTable(_activeBatchScope);
    return created;
  });
}

// ================================================================
// Menu Engineering - Pricing / Platform Pricing / Costing. All three tabs
// live on one page ("menu-engineering" - see index.html's nav, all three
// buttons route here with a different ?tab= query param, read back out of
// location.hash below). Ported structurally from the old app's
// MenuPricingTable.html / PlatformPricingTable.html / MenuCosting.html +
// ComponentCogsTable.html, but the numbers themselves are computed live
// server-side (functions/api/pricing.js, platform-pricing.js, costing.js -
// all built on the recipe_lines BOM data imported from the recipe sheet)
// instead of read from a saved Pricing/COGS-* sheet that needs a manual
// "Refresh" pass when ingredient costs move.
// ================================================================

let _menuEngLookups = null;
let _activeMenuEngTab = "pricing";
let _costingMode = "component";
let _costingCombo = null;

async function renderMenuEngineeringPage(content) {
  if (!_menuEngLookups) _menuEngLookups = await api("lookups");

  const query = location.hash.split("?")[1] || "";
  const tabParam = new URLSearchParams(query).get("tab");
  _activeMenuEngTab = ["pricing", "platform", "costing"].indexOf(tabParam) !== -1 ? tabParam : "pricing";

  content.innerHTML = "<h2>Menu Engineering</h2>" + buildMenuEngTabsShellHtml();
  wireMenuEngTabs();
  await loadMenuEngTab(_activeMenuEngTab);
}

function buildMenuEngTabsShellHtml() {
  return (
    '<div class="tabs">' +
      '<button id="menuEngTab-pricing" onclick="switchMenuEngTab(\'pricing\')">Pricing</button>' +
      '<button id="menuEngTab-platform" onclick="switchMenuEngTab(\'platform\')">Platform Pricing</button>' +
      '<button id="menuEngTab-costing" onclick="switchMenuEngTab(\'costing\')">Costing</button>' +
    "</div>" +
    '<div id="menuEngTableWrap"><p>Loading...</p></div>'
  );
}

function wireMenuEngTabs() {
  document.getElementById("menuEngTab-pricing").classList.toggle("tab-active", _activeMenuEngTab === "pricing");
  document.getElementById("menuEngTab-platform").classList.toggle("tab-active", _activeMenuEngTab === "platform");
  document.getElementById("menuEngTab-costing").classList.toggle("tab-active", _activeMenuEngTab === "costing");
}

function switchMenuEngTab(tab) {
  if (tab === _activeMenuEngTab) return;
  _activeMenuEngTab = tab;
  wireMenuEngTabs();
  loadMenuEngTab(tab);
}

async function loadMenuEngTab(tab) {
  const wrap = document.getElementById("menuEngTableWrap");
  wrap.innerHTML = "<p>Loading...</p>";

  if (tab === "pricing") return renderPricingTab(wrap);
  if (tab === "platform") return renderPlatformPricingTab(wrap);
  return renderCostingTab(wrap);
}

// ---------- Pricing ----------

let _lastPricingRows = [];
let _pricingArrangeMode = false;
let _pricingArrangeRows = [];

async function renderPricingTab(wrap) {
  const rows = await api("pricing");
  _lastPricingRows = rows;
  _pricingArrangeMode = false;
  renderPricingTable(wrap);
}

// Draws from _pricingArrangeRows while arranging (local, unsaved order) or
// _lastPricingRows otherwise (last-loaded, saved order) - same table either
// way, just with the move column + a Save/Cancel bar swapped in for the
// bottom-right "Arrange" toggle while active.
function renderPricingTable(wrap) {
  const rows = _pricingArrangeMode ? _pricingArrangeRows : _lastPricingRows;

  wrap.innerHTML =
    '<div id="pricingScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr>" +
          (_pricingArrangeMode ? "<th></th>" : "") +
          "<th>SKU</th><th>Product</th><th>Selling Price</th><th></th><th>Food Cost</th><th>Packaging Cost</th>" +
          "<th>Total COGS</th><th>Food Cost %</th><th>COGS %</th><th>Gross Profit</th><th>Gross Margin %</th>" +
        "</tr></thead>" +
        "<tbody>" + rows.map((r, i) => pricingRowHtml(r, i === 0, i === rows.length - 1)).join("") + "</tbody>" +
      "</table>" +
    "</div>" +
    '<div style="display:flex; justify-content:flex-start; gap:8px; margin-top:8px;">' +
      (_pricingArrangeMode
        ? '<button onclick="cancelArrangePricing()">Cancel</button><button onclick="saveArrangePricing()">Save Order</button><span id="arrangePricingStatus" class="save-status"></span>'
        : '<button onclick="startArrangePricing()">Arrange</button>') +
    "</div>";
  enableDragScroll(document.getElementById("pricingScrollWrap"));
}

function pricingRowHtml(r, isFirst, isLast) {
  const moveCell = _pricingArrangeMode
    ? "<td>" +
        '<button style="font-size:11px;" onclick="moveProductOrder(\'' + r.sku + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:11px;" onclick="moveProductOrder(\'' + r.sku + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  return (
    "<tr>" +
      moveCell +
      "<td>" + r.sku + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + formatRupiah(r.sellingPrice) + "</td>" +
      '<td><button onclick="openSellingPriceModal(\'' + r.sku + '\')">Edit</button></td>' +
      "<td>" + formatRupiah(r.foodCost) + "</td>" +
      "<td>" + formatRupiah(r.packagingCost) + "</td>" +
      "<td>" + formatRupiah(r.totalCogs) + "</td>" +
      "<td>" + formatPercent(r.foodCostPct) + "</td>" +
      "<td>" + formatPercent(r.cogsPct) + "</td>" +
      "<td>" + formatRupiah(r.grossProfit) + "</td>" +
      "<td>" + formatPercent(r.grossMarginPct) + "</td>" +
    "</tr>"
  );
}

function startArrangePricing() {
  _pricingArrangeMode = true;
  _pricingArrangeRows = _lastPricingRows.slice();
  renderPricingTable(document.getElementById("menuEngTableWrap"));
}

function cancelArrangePricing() {
  _pricingArrangeMode = false;
  renderPricingTable(document.getElementById("menuEngTableWrap"));
}

// Local-only swap (no API call) - just re-renders _pricingArrangeRows in its
// new order. Nothing is persisted until Save Order.
function moveProductOrder(sku, direction) {
  const index = _pricingArrangeRows.findIndex((r) => r.sku === sku);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= _pricingArrangeRows.length) return;

  const tmp = _pricingArrangeRows[index];
  _pricingArrangeRows[index] = _pricingArrangeRows[targetIndex];
  _pricingArrangeRows[targetIndex] = tmp;

  renderPricingTable(document.getElementById("menuEngTableWrap"));
}

function saveArrangePricing() {
  const btn = document.querySelector('button[onclick="saveArrangePricing()"]');
  const statusEl = document.getElementById("arrangePricingStatus");

  withSaveStatus(btn, statusEl, "Order", async function () {
    await api("pricing-order", { method: "POST", body: { skus: _pricingArrangeRows.map((r) => r.sku) } });
    await loadMenuEngTab("pricing");
  });
}

function openSellingPriceModal(sku) {
  const row = _lastPricingRows.find((r) => r.sku === sku);
  openModal(
    "<h2>Edit Selling Price - " + sku + "</h2>" +
    "<p>" + (row ? row.name : "") + "</p>" +
    "<label>Selling Price</label><br>" +
    '<input type="text" id="editSellingPrice" inputmode="numeric" value="' + (row ? formatRupiah(row.sellingPrice) : "") + '" oninput="formatAmount(this)"><br><br>' +
    '<button id="saveSellingPriceBtn" onclick="saveSellingPrice(\'' + sku + '\')">Save</button>' +
    '<span id="saveSellingPriceStatus" class="save-status"></span>'
  );
}

function saveSellingPrice(sku) {
  const price = parseAmount(document.getElementById("editSellingPrice").value);
  const btn = document.getElementById("saveSellingPriceBtn");
  const statusEl = document.getElementById("saveSellingPriceStatus");

  withSaveStatus(btn, statusEl, "Price", async function () {
    await api("pricing/" + encodeURIComponent(sku), { method: "PATCH", body: { sellingPrice: price } });
    closeModal();
    await loadMenuEngTab("pricing");
  });
}

// ---------- Platform Pricing ----------

let _lastPlatformPricingRows = [];

let _lastPlatformFee = 0;

async function renderPlatformPricingTab(wrap) {
  const data = await api("platform-pricing");
  _lastPlatformPricingRows = data.rows;
  _lastPlatformFee = data.fee;
  wrap.innerHTML =
    '<p><strong>Platform Fee:</strong> ' + formatPercent(data.fee) + " " +
    '<button onclick="openPlatformFeeModal()">Edit</button></p>' +
    '<div id="platformPricingScrollWrap" style="overflow-x:auto;">' +
      "<table>" +
        "<thead><tr><th>SKU</th><th>Product</th><th>Base Selling Price</th><th>Platform Fee %</th><th>Markup Price</th>" +
        "<th>Platform Selling Price</th><th></th><th>Base Gross Margin</th><th>Platform Gross Margin</th></tr></thead>" +
        "<tbody>" + data.rows.map((r) => platformPricingRowHtml(r, data.fee)).join("") + "</tbody>" +
      "</table>" +
    "</div>";
  enableDragScroll(document.getElementById("platformPricingScrollWrap"));
}

function platformPricingRowHtml(r, fee) {
  const trendHtml = r.marginTrend === "up"
    ? '<span style="color:#16a34a;">&#9650;</span>'
    : r.marginTrend === "down"
      ? '<span style="color:#dc2626;">&#9660;</span>'
      : '<span style="color:#888;">-</span>';

  return (
    "<tr>" +
      "<td>" + r.sku + "</td>" +
      "<td>" + r.name + "</td>" +
      "<td>" + formatRupiah(r.sellingPrice) + "</td>" +
      "<td>" + formatPercent(fee) + "</td>" +
      "<td>" + formatRupiah(r.markupPrice) + "</td>" +
      "<td>" + formatRupiah(r.platformSellingPrice) + "</td>" +
      '<td><button onclick="openPlatformPriceModal(\'' + r.sku + '\')">Edit</button></td>' +
      "<td>" + formatPercent(r.baseGrossMarginPct) + "</td>" +
      "<td>" + formatPercent(r.platformGrossMarginPct) + " " + trendHtml + "</td>" +
    "</tr>"
  );
}

function openPlatformPriceModal(sku) {
  const row = _lastPlatformPricingRows.find((r) => r.sku === sku);
  openModal(
    "<h2>Edit Platform Selling Price - " + sku + "</h2>" +
    "<p>" + (row ? row.name : "") + "</p>" +
    "<label>Platform Selling Price</label><br>" +
    '<input type="text" id="editPlatformPrice" inputmode="numeric" value="' + (row ? formatRupiah(row.platformSellingPrice) : "") + '" oninput="formatAmount(this)"><br><br>' +
    '<button id="savePlatformPriceBtn" onclick="savePlatformPrice(\'' + sku + '\')">Save</button>' +
    '<span id="savePlatformPriceStatus" class="save-status"></span>'
  );
}

function savePlatformPrice(sku) {
  const price = parseAmount(document.getElementById("editPlatformPrice").value);
  const btn = document.getElementById("savePlatformPriceBtn");
  const statusEl = document.getElementById("savePlatformPriceStatus");

  withSaveStatus(btn, statusEl, "Price", async function () {
    await api("platform-pricing/" + encodeURIComponent(sku), { method: "PATCH", body: { platformSellingPrice: price } });
    closeModal();
    await loadMenuEngTab("platform");
  });
}

// Fee is a settings row ("Platform Fee %", a plain percent number e.g.
// "20"), not per-SKU - editing it re-derives Markup Price and both Gross
// Margin columns for every row on reload (functions/api/platform-pricing.js
// reads it fresh every request, nothing cached).
function openPlatformFeeModal() {
  openModal(
    "<h2>Edit Platform Fee</h2>" +
    "<label>Platform Fee (%)</label><br>" +
    '<input type="number" id="editPlatformFee" min="0" max="99" step="any" value="' + (_lastPlatformFee * 100) + '"><br><br>' +
    '<button id="savePlatformFeeBtn" onclick="savePlatformFee()">Save</button>' +
    '<span id="savePlatformFeeStatus" class="save-status"></span>'
  );
}

function savePlatformFee() {
  const feePercent = document.getElementById("editPlatformFee").value;
  if (feePercent === "" || Number(feePercent) < 0) { alert("Please enter a valid fee percentage."); return; }

  const btn = document.getElementById("savePlatformFeeBtn");
  const statusEl = document.getElementById("savePlatformFeeStatus");

  withSaveStatus(btn, statusEl, "Fee", async function () {
    await api("settings/" + encodeURIComponent("Platform Fee %"), { method: "PATCH", body: { value: String(Number(feePercent)) } });
    closeModal();
    await loadMenuEngTab("platform");
  });
}

// ---------- Costing (live breakdown, editable via Manage Costing modal) ----------

function costingSkuOptions() {
  const types = _costingMode === "component" ? ["Component", "Semi-Finished"] : ["Product"];
  return _menuEngLookups.skus.filter((s) => types.indexOf(s.item_type) !== -1);
}

async function renderCostingTab(wrap) {
  wrap.innerHTML =
    '<label><input type="radio" name="costingMode" value="component"' + (_costingMode === "component" ? " checked" : "") + ' onchange="switchCostingMode(\'component\')"> Component / Semi-Finished</label>' +
    '<label style="margin-left:16px;"><input type="radio" name="costingMode" value="product"' + (_costingMode === "product" ? " checked" : "") + ' onchange="switchCostingMode(\'product\')"> Product</label>' +
    "<br><br>" +
    '<div id="costingSkuCombo" style="max-width:320px;"></div><br><br>' +
    '<div id="costingDetail"></div>';

  _costingCombo = createCombobox(
    document.getElementById("costingSkuCombo"),
    costingSkuOptions().map((s) => ({ value: s.sku, label: s.name, sub: s.sku })),
    {
      placeholder: _costingMode === "component" ? "Search component / semi-finished..." : "Search product...",
      onSelect: function (sku) { loadCostingDetail(sku); }
    }
  );
}

function switchCostingMode(mode) {
  if (mode === _costingMode) return;
  _costingMode = mode;
  renderCostingTab(document.getElementById("menuEngTableWrap"));
}

let _currentCostingSku = null;

async function loadCostingDetail(sku) {
  _currentCostingSku = sku;
  const detailEl = document.getElementById("costingDetail");
  detailEl.innerHTML = "<p>Loading...</p>";

  const data = await api("costing?sku=" + encodeURIComponent(sku));
  const isComponentMode = data.itemType === "Component" || data.itemType === "Semi-Finished";

  const rows = data.items.length
    ? data.items.map(costingItemRowHtml).join("")
    : '<tr><td colspan="5">No recipe lines for this SKU.</td></tr>';

  const summary = isComponentMode
    ? (
        "<p>Total Qty: " + data.totals.totalQty + " g &nbsp;|&nbsp; " +
        "Total Cost: " + formatRupiah(data.totals.totalCost) + " &nbsp;|&nbsp; " +
        "Yield: " + (data.baseYieldQty === null ? "-" : data.baseYieldQty) + " g &nbsp;|&nbsp; " +
        "Cost/gram: " + formatRupiah(data.totals.costPerGram) + "</p>"
      )
    : (
        "<p>Food Cost: " + formatRupiah(data.totals.foodCost) + " &nbsp;|&nbsp; " +
        "Packaging Cost: " + formatRupiah(data.totals.packagingCost) + " &nbsp;|&nbsp; " +
        "Total COGS: " + formatRupiah(data.totals.totalCogs) + "</p>"
      );

  detailEl.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h4>" + data.name + " (" + data.sku + ")</h4>" +
      '<button onclick="openManageCostingModal()">Manage Costing</button>' +
    "</div>" +
    summary +
    "<table>" +
      "<thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Line Cost</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
    "</table>";
}

// ---------- Manage Costing modal (recipe_lines CRUD + Arrange) ----------

let _addRecipeLineCombo = null;
let _manageCostingData = null;
let _manageCostingArrangeMode = false;
let _manageCostingArrangeItems = [];

async function openManageCostingModal() {
  const sku = _currentCostingSku;
  if (!sku) return;

  _manageCostingData = await api("costing?sku=" + encodeURIComponent(sku));
  _manageCostingArrangeMode = false;
  renderManageCostingModal();
}

// Rebuilt via openModal() every time arrange mode toggles or a move happens
// (openModal() closes+recreates the backdrop itself, so this stays simple -
// no manual DOM patching / no risk of losing the close button).
function renderManageCostingModal() {
  const data = _manageCostingData;
  const items = _manageCostingArrangeMode ? _manageCostingArrangeItems : data.items;

  const rows = items.length
    ? items.map((it, i) => manageCostingRowHtml(it, i === 0, i === items.length - 1)).join("")
    : '<tr><td colspan="4">No recipe lines yet.</td></tr>';

  const arrangeBar = _manageCostingArrangeMode
    ? '<div style="display:flex; justify-content:flex-start; gap:8px; margin-top:8px;">' +
        '<button onclick="cancelArrangeCosting()">Cancel</button>' +
        '<button onclick="saveArrangeCosting()">Save Order</button>' +
        '<span id="arrangeCostingStatus" class="save-status"></span>' +
      "</div>"
    : '<div style="display:flex; justify-content:flex-start; margin-top:8px;">' +
        '<button onclick="startArrangeCosting()">Arrange</button>' +
      "</div>";

  // Add Item is hidden while arranging - the order being staged isn't saved
  // yet, so adding a new line (which always lands at the end) would be
  // confusing to reason about until Save Order/Cancel resolves it.
  const addItemSection = _manageCostingArrangeMode
    ? ""
    : (
        '<h4 style="margin-top:16px;">Add Item</h4>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
          '<div id="addRecipeLineCombo" style="min-width:220px;"></div>' +
          '<input type="number" id="addRecipeLineQty" min="0" step="any" placeholder="Qty" style="width:90px;">' +
          '<input type="text" id="addRecipeLineUnit" disabled placeholder="Unit" style="background:#f5f5f5; width:70px;">' +
          '<button id="addRecipeLineBtn" onclick="addRecipeLineToCosting(\'' + data.sku + '\')">+ Add</button>' +
        "</div>" +
        '<span id="manageCostingStatus" class="save-status"></span>'
      );

  openModal(
    "<h2>Manage Costing - " + data.name + " (" + data.sku + ")</h2>" +
    "<table>" +
      "<thead><tr>" +
        (_manageCostingArrangeMode ? "<th></th>" : "") +
        "<th>Item</th><th>Qty</th><th>Unit</th>" +
        (_manageCostingArrangeMode ? "" : "<th></th>") +
      "</tr></thead>" +
      '<tbody id="manageCostingBody">' + rows + "</tbody>" +
    "</table>" +
    arrangeBar +
    addItemSection
  );

  if (!_manageCostingArrangeMode) {
    // Anything except Product can be a recipe ingredient (Component/
    // Semi-Finished/Ingredient/Packaging/Operating), matching the old app's
    // getProductCostingItemOptions() - and never the recipe's own SKU.
    const options = _menuEngLookups.skus
      .filter((s) => s.item_type !== "Product" && s.sku !== data.sku)
      .map((s) => ({ value: s.sku, label: s.name, sub: s.sku }));

    _addRecipeLineCombo = createCombobox(document.getElementById("addRecipeLineCombo"), options, {
      placeholder: "Search item to add...",
      onSelect: function (itemSku) {
        const item = _menuEngLookups.skus.find((s) => s.sku === itemSku);
        document.getElementById("addRecipeLineUnit").value = item ? item.unit : "";
      }
    });
  }
}

function manageCostingRowHtml(it, isFirst, isLast) {
  const moveCell = _manageCostingArrangeMode
    ? "<td>" +
        '<button style="font-size:11px;" onclick="moveRecipeLineOrder(\'' + it.lineId + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:11px;" onclick="moveRecipeLineOrder(\'' + it.lineId + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  const qtyCell = _manageCostingArrangeMode
    ? "<td>" + it.qty + "</td>"
    : '<td><input type="number" class="lineQtyInput" min="0" step="any" value="' + it.qty + '" style="width:80px;"></td>';

  const actionsCell = _manageCostingArrangeMode
    ? ""
    : "<td>" +
        '<button onclick="saveRecipeLineQty(\'' + it.lineId + '\', this)">Save</button> ' +
        '<button onclick="deleteRecipeLineFromCosting(\'' + it.lineId + '\')">Delete</button>' +
      "</td>";

  return (
    "<tr>" +
      moveCell +
      "<td>" + it.name + '<br><span style="color:#666; font-size:12px;">' + it.sku + "</span></td>" +
      qtyCell +
      "<td>" + it.unit + "</td>" +
      actionsCell +
    "</tr>"
  );
}

function startArrangeCosting() {
  _manageCostingArrangeMode = true;
  _manageCostingArrangeItems = _manageCostingData.items.slice();
  renderManageCostingModal();
}

function cancelArrangeCosting() {
  _manageCostingArrangeMode = false;
  renderManageCostingModal();
}

// Local-only swap (no API call) - re-renders _manageCostingArrangeItems in
// its new order. Nothing is persisted until Save Order.
function moveRecipeLineOrder(lineId, direction) {
  const index = _manageCostingArrangeItems.findIndex((it) => it.lineId === lineId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= _manageCostingArrangeItems.length) return;

  const tmp = _manageCostingArrangeItems[index];
  _manageCostingArrangeItems[index] = _manageCostingArrangeItems[targetIndex];
  _manageCostingArrangeItems[targetIndex] = tmp;

  renderManageCostingModal();
}

function saveArrangeCosting() {
  const btn = document.querySelector('button[onclick="saveArrangeCosting()"]');
  const statusEl = document.getElementById("arrangeCostingStatus");
  const parentSku = _manageCostingData.sku;

  withSaveStatus(btn, statusEl, "Order", async function () {
    await api("recipe-lines-order", { method: "POST", body: { lineIds: _manageCostingArrangeItems.map((it) => it.lineId) } });
    closeModal();
    await loadCostingDetail(parentSku);
  });
}

// Saving/deleting/adding closes the modal and reloads the Costing detail
// panel behind it - same close-then-reload pattern as the rest of the app
// (e.g. Driver Payout's edit modals) rather than refreshing the modal in
// place.
function saveRecipeLineQty(lineId, btn) {
  const row = btn.closest("tr");
  const qty = Number(row.querySelector(".lineQtyInput").value);
  if (!qty || qty <= 0) { alert("Please enter a valid qty."); return; }

  withInlineSaveStatus(btn, "Qty", async function () {
    await api("recipe-lines/" + encodeURIComponent(lineId), { method: "PATCH", body: { qty: qty } });
    closeModal();
    await loadCostingDetail(_currentCostingSku);
  });
}

function deleteRecipeLineFromCosting(lineId) {
  if (!confirm("Remove this ingredient from the recipe?")) return;

  api("recipe-lines/" + encodeURIComponent(lineId), { method: "DELETE" })
    .then(function () {
      closeModal();
      return loadCostingDetail(_currentCostingSku);
    })
    .catch((err) => alert(err.message));
}

function addRecipeLineToCosting(parentSku) {
  const itemSku = _addRecipeLineCombo ? _addRecipeLineCombo.getValue() : "";
  const qty = Number(document.getElementById("addRecipeLineQty").value);
  const unit = document.getElementById("addRecipeLineUnit").value;

  if (!itemSku) { alert("Please select an item."); return; }
  if (!qty || qty <= 0) { alert("Please enter a valid qty."); return; }

  const btn = document.getElementById("addRecipeLineBtn");
  const statusEl = document.getElementById("manageCostingStatus");

  withSaveStatus(btn, statusEl, "Item", async function () {
    await api("recipe-lines", { method: "POST", body: { parentSku: parentSku, componentSku: itemSku, qty: qty, unit: unit } });
    closeModal();
    await loadCostingDetail(parentSku);
  });
}

function costingItemRowHtml(it) {
  return (
    "<tr>" +
      "<td>" + it.name + '<br><span style="color:#666; font-size:12px;">' + it.sku + "</span></td>" +
      "<td>" + it.qty + "</td>" +
      "<td>" + it.unit + "</td>" +
      "<td>" + formatRupiah(it.unitCost) + "</td>" +
      "<td>" + formatRupiah(it.lineCost) + "</td>" +
    "</tr>"
  );
}
