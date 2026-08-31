registerPage("batch-production", renderBatchProductionPage);
registerPage("menu-engineering", renderMenuEngineeringPage);

// Recipe/BOM-driven Batch Production (06 Menu/MenuBatchProduction.html -
// startBatch/markBatchDone, scaled off recipe_lines). Pick the output SKU
// and batch size; Yield and Consumption are both auto-filled from that
// SKU's recipe (Menu Engineering > Costing) scaled by Batch Size, and
// Consumption is read-only here on purpose - it can only be changed by
// editing the recipe itself, not per-batch, so there's one source of truth
// for what a batch of X consumes. See functions/api/batches.js for the
// backend.
const BATCH_OUTPUT_TYPES = ["Semi-Finished", "Component"];

let _batchLookups = null;
let _batchOutputCombo = null;
let _lastBatchesData = []; // Ongoing + History combined, for by-batchCode lookups (Change Component, Open Recipe, etc.)
let _lastHistoryBatches = []; // History only, for toggleShowCancelledBatches' re-render

async function renderBatchProductionPage(content) {
  content.innerHTML =
    "<h2>Batch Production</h2>" +
    '<div id="batchOngoingWrap"><p>Loading...</p></div>' +
    '<div id="batchHistoryWrap" style="margin-top:28px;"></div>';
  await ensureBatchLookups();
  await loadBatchData();
}

async function ensureBatchLookups() {
  if (!_batchLookups) _batchLookups = await api("lookups");
  return _batchLookups;
}

// ================================================================
// Ongoing Batches / Batch History - stacked on one page (History below
// Ongoing, no tab-switch), same pattern as pages/sales.js's Summary/Log.
// "Ongoing Batches" concept (live list + Mark Done) is from
// MenuBatchProduction.html; the recipe-detail/change-component/edit-scaled-
// qty actions there are tied to the BOM system we don't have, so not
// ported. "Batch History" (full log, all statuses) is from 06 Menu/
// BatchHistoryTable.html.
// ================================================================

async function loadBatchData() {
  const [ongoing, history] = await Promise.all([api("batches?scope=ongoing"), api("batches?scope=history")]);
  if (!document.getElementById("batchOngoingWrap")) return;

  _lastHistoryBatches = history;
  _lastBatchesData = ongoing.concat(history);

  renderBatchTable(document.getElementById("batchOngoingWrap"), ongoing, "ongoing");
  renderBatchTable(document.getElementById("batchHistoryWrap"), history, "history");
}

// Batch History gets both Done and Cancelled from the backend (scope=
// history, see functions/api/batches.js) - Cancelled is hidden by default
// via this client-side filter (re-rendered from the same already-fetched
// _lastHistoryBatches, no extra request) so a cluttered cancel history
// doesn't bury the real production log; the checkbox at the bottom-right
// reveals it.
let _showCancelledBatches = false;

function toggleShowCancelledBatches() {
  _showCancelledBatches = document.getElementById("showCancelledBatches").checked;
  renderBatchTable(document.getElementById("batchHistoryWrap"), _lastHistoryBatches, "history");
}

// Batch History only (Ongoing stays unfiltered - it's small and everything
// in it is current/actionable, same reasoning Order History's filter never
// applies to Ongoing Orders either).
let _batchHistoryDateFrom = "";
let _batchHistoryDateTo = "";
let _batchHistoryCategoryFilter = []; // empty = show every Category (default)
let _batchHistorySort = "date-desc";
const BATCH_HISTORY_SORT_LABELS = { "date-desc": "Date (Newest)", "date-asc": "Date (Oldest)" };

function visibleBatchHistoryRows(rows) {
  const cancelledFiltered = _showCancelledBatches ? rows : rows.filter((b) => b.status !== "Cancelled");
  return cancelledFiltered
    .filter((b) =>
      (!_batchHistoryCategoryFilter.length || _batchHistoryCategoryFilter.indexOf(b.category || "") !== -1) &&
      (!_batchHistoryDateFrom || b.date >= _batchHistoryDateFrom) &&
      (!_batchHistoryDateTo || b.date <= _batchHistoryDateTo)
    )
    .sort((a, b) => {
      if (a.date === b.date) return 0;
      const cmp = a.date < b.date ? -1 : 1;
      return _batchHistorySort === "date-asc" ? cmp : -cmp;
    });
}

function openBatchHistoryFilterSortModal() {
  const categories = [...new Set(_lastHistoryBatches.map((b) => b.category || "").filter(Boolean))].sort();
  const sortOptions = [["date-desc", "Date (Newest)"], ["date-asc", "Date (Oldest)"]];

  const categoryChecks = categories.map((c) =>
    '<label style="display:block; margin:4px 0;"><input type="checkbox" class="batchHistoryCategoryFilterCheck" value="' + c + '"' + (_batchHistoryCategoryFilter.indexOf(c) !== -1 ? " checked" : "") + "> " + c + "</label>"
  ).join("");
  const sortRadios = sortOptions.map(([val, label]) =>
    '<label style="display:block; margin:6px 0;"><input type="radio" name="batchHistorySortOption" value="' + val + '"' + (_batchHistorySort === val ? " checked" : "") + "> " + label + "</label>"
  ).join("");

  openModal(
    "<h2>Filter &amp; Sort - Batch History</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="batchHistoryDateFrom" value="' + _batchHistoryDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="batchHistoryDateTo" value="' + _batchHistoryDateTo + '">' +
    "</div><br><br>" +
    "<label>Category</label>" +
    "<div>" + categoryChecks + "</div><br>" +
    "<label>Sort</label>" +
    "<div>" + sortRadios + "</div>" +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyBatchHistoryFilterSort()">Apply</button>' +
    "</div>"
  );
}

function applyBatchHistoryFilterSort() {
  _batchHistoryDateFrom = document.getElementById("batchHistoryDateFrom").value || "";
  _batchHistoryDateTo = document.getElementById("batchHistoryDateTo").value || "";
  _batchHistoryCategoryFilter = Array.from(document.querySelectorAll(".batchHistoryCategoryFilterCheck:checked")).map((cb) => cb.value);
  const selectedSort = document.querySelector('input[name="batchHistorySortOption"]:checked');
  if (selectedSort) _batchHistorySort = selectedSort.value;
  closeModal();
  renderBatchTable(document.getElementById("batchHistoryWrap"), _lastHistoryBatches, "history");
}

function batchHistoryFilterSortBadgeText() {
  const dateParts = [];
  if (_batchHistoryDateFrom) dateParts.push("from " + _batchHistoryDateFrom);
  if (_batchHistoryDateTo) dateParts.push("to " + _batchHistoryDateTo);
  const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
  const categoryText = _batchHistoryCategoryFilter.length ? _batchHistoryCategoryFilter.join(", ") : "All Categories";
  return dateText + " | " + categoryText + " | " + BATCH_HISTORY_SORT_LABELS[_batchHistorySort];
}

function renderBatchTable(wrap, rows, scope) {
  const title = scope === "ongoing" ? "Ongoing Batches" : "Batch History";
  const visibleRows = scope === "history" ? visibleBatchHistoryRows(rows) : rows;

  // Start New Batch always creates an Ongoing batch, so the button lives
  // next to that subsection's own title, not a page-level header - same
  // reasoning as Orders' "+ New Order" and Sales' "+ Input Sales".
  const titleRow =
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">' +
      "<h3>" + title + "</h3>" +
      (scope === "ongoing"
        ? '<button class="btn-primary" onclick="openBatchModal()">+ Start New Batch</button>'
        : '<div style="display:flex; align-items:center; gap:10px;">' +
            '<span style="color:var(--color-text-muted); font-size:12px;">' + batchHistoryFilterSortBadgeText() + "</span>" +
            '<button onclick="openBatchHistoryFilterSortModal()">Filter &amp; Sort</button>' +
          "</div>") +
    "</div>";

  if (!rows.length) {
    wrap.innerHTML = titleRow + (scope === "ongoing" ? "<p>No ongoing batches.</p>" : "<p>No batches yet.</p>");
    return;
  }

  // Ongoing Batches columns match the old app's MenuBatchProduction.html
  // table exactly (Batch ID/Date/Recipe/Base Yield (g)/Scaled Qty/Scaled
  // Yield (g)/actions) - Base Yield now reads sku_items.base_yield_qty (via
  // lookups, see baseYieldFor()). Batch History keeps its own separate
  // column set (unaffected by this - see batchHistoryRowHtml).
  const head = scope === "ongoing"
    ? "<tr><th>Batch ID</th><th>Date</th><th>Category</th><th>Item Name</th><th>Batch Size</th><th>Base Yield (g)</th><th>Scaled Yield (g)</th><th></th></tr>"
    : "<tr><th>Batch ID</th><th>Date</th><th>Category</th><th>Item Name</th><th>Batch Size</th><th>Yield</th><th>Status</th><th>Notes</th></tr>";

  const bodyRows = scope === "ongoing" ? visibleRows.map(ongoingBatchRowHtml).join("") : visibleRows.map(batchHistoryRowHtml).join("");
  const cancelledCount = scope === "history" ? rows.filter((b) => b.status === "Cancelled").length : 0;

  // IDs suffixed by scope - Ongoing and History now render into separate
  // containers on the same page at once (not tab-swapped), so they can't
  // share element ids without one section's pagination/scroll silently
  // grabbing the other's DOM nodes.
  const paginationId = "batchPaginationNav-" + scope;
  const scrollWrapId = "batchScrollWrap-" + scope;
  const tbodyId = "batchTbody-" + scope;

  wrap.innerHTML =
    titleRow +
    '<div id="' + paginationId + '" class="pagination-nav"></div>' +
    '<div id="' + scrollWrapId + '" style="overflow-x:auto;">' +
      "<table><thead>" + head + "</thead>" +
      '<tbody id="' + tbodyId + '">' + (bodyRows || '<tr><td colspan="8">No batches match the current filter.</td></tr>') + "</tbody></table>" +
    "</div>" +
    (scope === "history" && cancelledCount > 0
      ? '<div style="text-align:right; margin-top:8px;"><label><input type="checkbox" id="showCancelledBatches" onchange="toggleShowCancelledBatches()"' +
        (_showCancelledBatches ? " checked" : "") +
        "> Show Cancelled Batches (" + cancelledCount + ")</label></div>"
      : "");

  paginateTable(tbodyId, paginationId, scope === "history" ? 10 : 20);
  enableDragScroll(document.getElementById(scrollWrapId));
}

// Item Name + SKU (small, gray, underneath) + Open Recipe - shared by both
// Ongoing Batches and Batch History. Change Component and Edit Batch Size
// used to have their own inline row controls (Ongoing only); both now live
// inside the Open Recipe modal instead (see openBatchRecipeModal below), so
// Ongoing's row is down to this one button too, per explicit request that
// the row not "pile up" action buttons.
function itemNameCell(b) {
  return (
    b.itemName +
    '<br><span style="color:var(--color-text-muted); font-size:12px;">' + b.sku + "</span>" +
    '<br><button onclick="openBatchRecipeModal(\'' + b.batchCode + '\')">Open Recipe</button>'
  );
}

// From lookups.skus (recipe_lines' base_yield_qty, filled in from the
// imported recipe data) - the expected yield of ONE batch run at this
// item's base recipe, before this batch's own Batch Size multiplier.
function baseYieldFor(sku) {
  const item = _batchLookups.skus.find((s) => s.sku === sku);
  return item && item.base_yield_qty !== null && item.base_yield_qty !== undefined ? item.base_yield_qty : "";
}

function ongoingBatchRowHtml(b) {
  return (
    "<tr>" +
      "<td>" + b.batchCode + "</td>" +
      '<td style="white-space:nowrap; width:1%;">' + b.date + "</td>" +
      "<td>" + (b.category || "") + "</td>" +
      "<td>" + itemNameCell(b) + "</td>" +
      "<td>" + (b.batchSize === null ? "" : b.batchSize) + "</td>" +
      "<td>" + baseYieldFor(b.sku) + "</td>" +
      "<td>" + (b.yieldQty === null ? "" : b.yieldQty) + "</td>" +
      "<td>" +
        '<button onclick="markBatchDone(\'' + b.batchCode + '\')">Mark Done</button> ' +
        '<button onclick="cancelBatch(\'' + b.batchCode + '\')">Cancel Batch</button>' +
      "</td>" +
    "</tr>"
  );
}

function batchHistoryRowHtml(b) {
  return (
    "<tr>" +
      "<td>" + b.batchCode + "</td>" +
      '<td style="white-space:nowrap; width:1%;">' + b.date + "</td>" +
      "<td>" + (b.category || "") + "</td>" +
      "<td>" + itemNameCell(b) + "</td>" +
      "<td>" + (b.batchSize === null ? "" : b.batchSize) + "</td>" +
      "<td>" + (b.yieldQty === null ? "" : b.yieldQty) + "</td>" +
      "<td>" + b.status + "</td>" +
      "<td>" + (b.notes || "") + "</td>" +
    "</tr>"
  );
}

function markBatchDone(batchCode) {
  openConfirmModal({
    title: "Mark batch as Done?",
    body: "This will count its yield into stock.",
    chip: batchCode,
    confirmLabel: "Mark as Done",
    onConfirm: async function () {
      await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { status: "Done" } });
      closeModal();
      await loadBatchData();
    }
  });
}

// Ported from MenuBatchProduction_JS.html's cancelBatch() - same wording.
// Sets status to Cancelled, which moves it out of Ongoing Batches and into
// Batch History (see the scope filter in functions/api/batches.js).
function cancelBatch(batchCode) {
  openConfirmModal({
    title: "Cancel this batch?",
    body: "This will remove it from Ongoing Batches and move it to Batch History with status Cancelled.",
    chip: batchCode,
    confirmLabel: "Cancel Batch",
    danger: true,
    onConfirm: async function () {
      await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { status: "Cancelled" } });
      closeModal();
      await loadBatchData();
    }
  });
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

  const raw = batch && batch.batchSize !== null ? batch.batchSize : "";
  // Change Component only for Ongoing batches (matches the old inline-row
  // button's own restriction) - a Done/Cancelled batch's output SKU is
  // history, not something to still be re-pointing.
  const canChangeComponent = !!(batch && batch.status === "Ongoing");

  openModal(
    "<h2>Recipe Detail</h2>" +
    '<div id="batchComponentTitle" data-batch-code="' + batchCode + '" style="font-size:16px; font-weight:600; margin-bottom:16px;">' +
      batchComponentViewHtml(batch, canChangeComponent) +
    "</div>" +
    '<div id="batchQtySection" data-batch-code="' + batchCode + '" data-raw="' + raw + '" style="margin-bottom:16px;">' +
      batchQtyViewHtml(raw) +
    "</div>" +
    "<table><thead><tr><th>Item Name</th><th>Base Qty</th><th>Scaled Qty</th></tr></thead>" +
    "<tbody>" + rows + "</tbody></table>"
  );
}

// stroke="currentColor" - color comes from .btn-icon-edit's own `color`
// property (shared.css), so this single markup stays monochrome and
// theme-matched wherever it's dropped in, no per-use color to keep in sync.
const ICON_PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Change Component - ported from the old inline-row control (see
// itemNameCell's comment above), now living inline in the modal's own
// header: a pencil button next to the item name swaps that name for a
// dropdown in place (not a separate section), defaulting to the item
// currently in use. Same auto-scale-from-recipe PATCH as before
// (functions/api/batches/[code].js), just reachable from a different spot.
function batchComponentViewHtml(batch, canChangeComponent) {
  const nameHtml = batch
    ? batch.itemName + ' <span style="font-size:12px; color:var(--color-text-muted); font-weight:normal;">(' + batch.sku + ")</span>"
    : "";
  const pencil = canChangeComponent
    ? '<button class="btn-icon-edit" onclick="startEditBatchComponent()" title="Change Component">' + ICON_PENCIL + "</button>"
    : "";
  return (
    '<div style="display:flex; align-items:center; gap:4px;">' +
      '<span style="display:inline-block; min-width:200px;">' + nameHtml + "</span>" +
      pencil +
    "</div>"
  );
}

// Component AND Semi-Finished both belong here (a batch can be re-pointed
// to either kind of produced item, not just whichever type it currently
// is) - previously filtered to the batch's own current item_type only,
// which hid the other kind from the picker entirely.
const BATCH_COMPONENT_SWAP_TYPES = ["Component", "Semi-Finished"];

function startEditBatchComponent() {
  const wrap = document.getElementById("batchComponentTitle");
  const batchCode = wrap.dataset.batchCode;
  const batch = _lastBatchesData.find((b) => b.batchCode === batchCode);

  wrap.innerHTML =
    '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
      '<div class="batchComponentCombo" style="min-width:220px;"></div>' +
      '<button class="saveBatchComponentBtn btn-primary" onclick="saveBatchComponent(this)">Save</button>' +
      '<button onclick="cancelEditBatchComponent()">Cancel</button>' +
      '<span class="save-status"></span>' +
    "</div>";

  // Current item stays in the list (unlike before) so it can be the
  // dropdown's default selection - "not yet changed" needs to be a valid,
  // visible option, not just an empty placeholder.
  const options = _batchLookups.skus.filter((s) =>
    BATCH_COMPONENT_SWAP_TYPES.indexOf(s.item_type) !== -1 && (s.status !== "Unavailable" || s.sku === batch.sku)
  );
  wrap._combo = createCombobox(
    wrap.querySelector(".batchComponentCombo"),
    options.map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    { placeholder: "Select component or semi-finished..." }
  );
  const currentItem = _batchLookups.skus.find((s) => s.sku === batch.sku);
  if (currentItem) wrap._combo.setSelection(currentItem.id, currentItem.name);
}

function cancelEditBatchComponent() {
  const wrap = document.getElementById("batchComponentTitle");
  const batch = _lastBatchesData.find((b) => b.batchCode === wrap.dataset.batchCode);
  wrap.innerHTML = batchComponentViewHtml(batch, batch && batch.status === "Ongoing");
}

function saveBatchComponent(btn) {
  const wrap = document.getElementById("batchComponentTitle");
  const batchCode = wrap.dataset.batchCode;
  const newSkuId = wrap._combo ? wrap._combo.getValue() : "";
  if (!newSkuId) { alert("Please select a component."); return; }

  const statusEl = wrap.querySelector(".save-status");
  withSaveStatus(btn, statusEl, "Component", async function () {
    await api("batches/" + encodeURIComponent(batchCode), { method: "PATCH", body: { outputSkuId: newSkuId } });
    closeModal();
    await loadBatchData();
  });
}

// Number gets a reserved min-width so the pencil button sits at a fixed x
// position regardless of digit count (1 digit vs 4 digits no longer shifts
// it left/right).
function batchQtyViewHtml(raw) {
  return (
    '<label style="color:var(--color-text-muted); font-size:12px;">Batch Size</label><br>' +
    '<div style="display:flex; align-items:center;">' +
      '<span style="display:inline-block; min-width:40px;">' + (raw === "" ? "-" : raw) + "</span>" +
      '<button class="btn-icon-edit" onclick="startEditBatchQty()" title="Edit Batch Size">' + ICON_PENCIL + "</button>" +
    "</div>"
  );
}

function startEditBatchQty() {
  const section = document.getElementById("batchQtySection");
  section.innerHTML =
    '<label style="color:var(--color-text-muted); font-size:12px;">Batch Size</label><br>' +
    '<input type="number" class="batchQtyInput" min="0" step="any" value="' + section.dataset.raw + '" style="width:100px;"> ' +
    '<button class="saveBatchQtyBtn btn-primary" onclick="saveBatchQty(this)">Save</button> ' +
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
    await loadBatchData();
  });
}

// ================================================================
// Start New Batch modal - Consumption (and now Yield) are read-only,
// entirely derived from the output SKU's recipe (Menu Engineering >
// Costing) scaled by Batch Size - there's no manual entry path here at
// all, on purpose: the recipe is the one source of truth for what a batch
// consumes/yields, changed only via Costing, never per-batch.
// ================================================================

// Self-contained (loads its own lookups) rather than assuming
// renderBatchProductionPage already ran - callable from anywhere, e.g.
// Dashboard's "+ Start New Batch" shortcut, which may open this before the
// Batch Production page itself has ever been visited this session.
async function openBatchModal() {
  await ensureBatchLookups();
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
    "</div><br>" +

    "<label>Output SKU</label><br>" +
    '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
      '<div id="batchOutputCombo" style="min-width:260px;"></div>' +
      '<input type="text" id="batchOutputCategory" disabled placeholder="Category" style="background:var(--color-disabled-bg); width:120px;">' +
      '<input type="text" id="batchOutputUnit" disabled placeholder="Unit" style="background:var(--color-disabled-bg); width:70px;">' +
    "</div><br><br>" +

    '<div style="display:flex; gap:20px;">' +
      "<div><label>Batch Size</label><br><input type=\"number\" id=\"batchSize\" min=\"0\" step=\"any\" onchange=\"onBatchSizeChange()\"></div>" +
      "<div><label>Yield</label><br><input type=\"number\" id=\"batchYield\" min=\"0\" step=\"any\" readonly style=\"background:var(--color-disabled-bg);\"></div>" +
      "<div><label>Status</label><br><select id=\"batchStatus\"><option>Ongoing</option><option>Done</option></select></div>" +
    "</div><br><br>" +

    '<button id="saveBatchBtn" class="btn-primary" onclick="saveBatch()">Start Batch</button>' +
    '<span id="saveBatchStatus" class="save-status"></span><br><br>' +

    "<label>Consumption</label>" +
    '<div id="batchConsumptionRows"></div><br>' +

    "<label>Notes</label><br>" +
    '<input type="text" id="batchNotes"><br><br>'
  );
}

// Recipe breakdown (base 1x qty per line, unscaled) for whichever output
// SKU is currently selected - null if none selected yet, or if that SKU has
// no recipe_lines set up (Menu Engineering > Costing), in which case
// Consumption/Yield just show an empty state until one is.
let _batchRecipeItems = null;
let _batchBaseYieldQty = null;
let _batchConsumptionComputed = [];

function initBatchForm() {
  _batchRecipeItems = null;
  _batchBaseYieldQty = null;
  _batchOutputCombo = createCombobox(
    document.getElementById("batchOutputCombo"),
    _batchLookups.skus.filter((s) => BATCH_OUTPUT_TYPES.indexOf(s.item_type) !== -1 && s.status !== "Unavailable").map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select output SKU...",
      onSelect: onBatchOutputSelect
    }
  );

  renderBatchConsumptionReadonly();
}

// Fetches the output SKU's recipe (functions/api/costing.js's live
// breakdown, same one the "Open Recipe" modal on an already-started batch
// reads) - Yield and Consumption both derive from it, scaled by Batch Size.
async function onBatchOutputSelect(skuId) {
  const item = _batchLookups.skus.find((s) => s.id === skuId);
  document.getElementById("batchOutputCategory").value = item ? item.category || "" : "";
  document.getElementById("batchOutputUnit").value = item ? item.unit : "";

  _batchRecipeItems = null;
  _batchBaseYieldQty = null;
  if (item) {
    try {
      const recipe = await api("costing?sku=" + encodeURIComponent(item.sku));
      if (recipe.items && recipe.items.length) _batchRecipeItems = recipe.items;
      _batchBaseYieldQty = recipe.baseYieldQty;
    } catch (err) {
      _batchRecipeItems = null; // no recipe set up yet
      _batchBaseYieldQty = null;
    }
  }
  refreshBatchFromRecipe();
}

function onBatchSizeChange() {
  refreshBatchFromRecipe();
}

function refreshBatchFromRecipe() {
  const batchSize = Number(document.getElementById("batchSize").value) || 1;

  const yieldEl = document.getElementById("batchYield");
  yieldEl.value = _batchBaseYieldQty != null ? Math.round(_batchBaseYieldQty * batchSize * 100) / 100 : "";

  renderBatchConsumptionReadonly(batchSize);
}

function renderBatchConsumptionReadonly(batchSize) {
  batchSize = batchSize || Number(document.getElementById("batchSize").value) || 1;
  const wrap = document.getElementById("batchConsumptionRows");

  if (!_batchRecipeItems || !_batchRecipeItems.length) {
    _batchConsumptionComputed = [];
    wrap.innerHTML =
      '<p style="color:var(--color-text-muted); font-size:12px;">' +
      (_batchOutputCombo && _batchOutputCombo.getValue()
        ? "No recipe configured for this SKU - set one up in Menu &gt; Engineering &gt; Costing first."
        : "Select an output SKU to see its recipe.") +
      "</p>";
    return;
  }

  _batchConsumptionComputed = _batchRecipeItems.map((it) => ({
    skuId: it.componentSkuId,
    qty: Math.round(it.qty * batchSize * 100) / 100
  }));

  const rows = _batchConsumptionComputed
    .map((c) => {
      const item = _batchLookups.skus.find((s) => s.id === c.skuId);
      return "<tr><td>" + (item ? item.name : c.skuId) + "</td><td>" + c.qty + "</td><td>" + (item ? item.unit : "") + "</td></tr>";
    })
    .join("");

  wrap.innerHTML = "<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>" + rows + "</tbody></table>";
}

function setBatchToday() {
  if (document.getElementById("batchToday").checked) document.getElementById("batchDate").value = todayISO();
}

function collectBatchConsumption() {
  return _batchConsumptionComputed.filter((c) => c.skuId && c.qty > 0).map((c) => ({ skuId: c.skuId, qty: c.qty, notes: null }));
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
    await loadBatchData();
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
        '<button style="font-size:12px;" onclick="moveProductOrder(\'' + r.sku + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:12px;" onclick="moveProductOrder(\'' + r.sku + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  return (
    "<tr>" +
      moveCell +
      "<td>" + r.sku + "</td>" +
      "<td>" + r.name + "</td>" +
      '<td><span class="font-number">' + formatRupiah(r.sellingPrice) + "</span></td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openSellingPriceModal(\'' + r.sku + '\')">Edit</button></td>' +
      '<td><span class="font-number">' + formatRupiah(r.foodCost) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.packagingCost) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.totalCogs) + "</span></td>" +
      "<td>" + formatPercent(r.foodCostPct) + "</td>" +
      "<td>" + formatPercent(r.cogsPct) + "</td>" +
      '<td><span class="font-number">' + formatRupiah(r.grossProfit) + "</span></td>" +
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
    '<button id="saveSellingPriceBtn" class="btn-primary" onclick="saveSellingPrice(\'' + sku + '\')">Save</button>' +
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
    ? '<span style="color:var(--color-success);">&#9650;</span>'
    : r.marginTrend === "down"
      ? '<span style="color:var(--color-error);">&#9660;</span>'
      : '<span style="color:var(--color-text-muted);">-</span>';

  return (
    "<tr>" +
      "<td>" + r.sku + "</td>" +
      "<td>" + r.name + "</td>" +
      '<td><span class="font-number">' + formatRupiah(r.sellingPrice) + "</span></td>" +
      "<td>" + formatPercent(fee) + "</td>" +
      '<td><span class="font-number">' + formatRupiah(r.markupPrice) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(r.platformSellingPrice) + "</span></td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openPlatformPriceModal(\'' + r.sku + '\')">Edit</button></td>' +
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
    '<button id="savePlatformPriceBtn" class="btn-primary" onclick="savePlatformPrice(\'' + sku + '\')">Save</button>' +
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
    '<button id="savePlatformFeeBtn" class="btn-primary" onclick="savePlatformFee()">Save</button>' +
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
  // Product uses "Active"/"Inactive", everything else uses "Available"/
  // "Unavailable" - checking both is harmless since a given row only ever
  // has one or the other, never both.
  return _menuEngLookups.skus.filter((s) => types.indexOf(s.item_type) !== -1 && s.status !== "Unavailable" && s.status !== "Inactive");
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
        'Total Cost: <span class="font-number">' + formatRupiah(data.totals.totalCost) + "</span> &nbsp;|&nbsp; " +
        "Yield: " + (data.baseYieldQty === null ? "-" : data.baseYieldQty) + " g &nbsp;|&nbsp; " +
        'Cost/gram: <span class="font-number">' + formatRupiah(data.totals.costPerGram) + "</span></p>"
      )
    : (
        '<p>Food Cost: <span class="font-number">' + formatRupiah(data.totals.foodCost) + "</span> &nbsp;|&nbsp; " +
        'Packaging Cost: <span class="font-number">' + formatRupiah(data.totals.packagingCost) + "</span> &nbsp;|&nbsp; " +
        'Total COGS: <span class="font-number">' + formatRupiah(data.totals.totalCogs) + "</span></p>"
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
//
// Qty edits, Add Item and Remove are all staged locally (DOM only, no API
// call) instead of saving+closing+reloading per action - one "Save" button
// at the bottom commits everything (updated qtys, additions, removals, and
// Yield) together. Arrange is the one exception: it's already its own local-
// staging flow with its own explicit Save Order button, so it's left as-is,
// with a guard so entering it can't silently discard unsaved Save-pending
// edits made above.

let _addRecipeLineCombo = null;
let _manageCostingData = null;
let _manageCostingArrangeMode = false;
let _manageCostingArrangeItems = [];
let _manageCostingDirty = false;

async function openManageCostingModal() {
  const sku = _currentCostingSku;
  if (!sku) return;

  _manageCostingData = await api("costing?sku=" + encodeURIComponent(sku));
  _manageCostingArrangeMode = false;
  _manageCostingDirty = false;
  renderManageCostingModal();
}

function markManageCostingDirty() {
  _manageCostingDirty = true;
}

// Rebuilt via openModal() every time arrange mode toggles or a move happens
// (openModal() closes+recreates the backdrop itself, so this stays simple -
// no manual DOM patching / no risk of losing the close button). Regular Qty
// edits/Add/Remove, by contrast, patch the DOM directly (see
// addRecipeLineToCosting/removeManageCostingRow) precisely so they DON'T
// trigger a rebuild that would blow away other in-progress unsaved edits.
function renderManageCostingModal() {
  const data = _manageCostingData;
  const items = _manageCostingArrangeMode ? _manageCostingArrangeItems : data.items;
  const isComponentMode = data.itemType === "Component" || data.itemType === "Semi-Finished";

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
          '<input type="text" id="addRecipeLineUnit" disabled placeholder="Unit" style="background:var(--color-disabled-bg); width:70px;">' +
          '<button type="button" id="addRecipeLineBtn" onclick="addRecipeLineToCosting()">+ Add</button>' +
        "</div>"
      );

  // Yield only means anything for a produced Component/Semi-Finished recipe
  // (Products don't have a base_yield_qty) - editable here now instead of
  // only shown read-only in the Costing detail summary.
  const yieldSection = (!_manageCostingArrangeMode && isComponentMode)
    ? (
        '<div style="margin-top:16px;">' +
          '<label for="manageCostingYield">Yield (g)</label><br>' +
          '<input type="number" id="manageCostingYield" min="0" step="any" value="' + (data.baseYieldQty === null ? "" : data.baseYieldQty) + '" style="width:120px;" oninput="markManageCostingDirty()">' +
        "</div>"
      )
    : "";

  const saveBar = _manageCostingArrangeMode
    ? ""
    : (
        '<div style="margin-top:16px;">' +
          '<button id="saveManageCostingBtn" class="btn-primary" onclick="saveManageCostingAll()">Save</button> ' +
          '<span id="manageCostingStatus" class="save-status"></span>' +
        "</div>"
      );

  openModal(
    "<h2>Manage Costing - " + data.name + " (" + data.sku + ")</h2>" +
    yieldSection +
    '<table style="margin-top:16px;">' +
      "<thead><tr>" +
        (_manageCostingArrangeMode ? "<th></th>" : "") +
        "<th>Item</th><th>Qty</th><th>Unit</th>" +
        (_manageCostingArrangeMode ? "" : "<th></th>") +
      "</tr></thead>" +
      '<tbody id="manageCostingBody">' + rows + "</tbody>" +
    "</table>" +
    arrangeBar +
    addItemSection +
    saveBar
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
        '<button style="font-size:12px;" onclick="moveRecipeLineOrder(\'' + it.lineId + '\', \'up\')"' + (isFirst ? " disabled" : "") + '>&#9650;</button> ' +
        '<button style="font-size:12px;" onclick="moveRecipeLineOrder(\'' + it.lineId + '\', \'down\')"' + (isLast ? " disabled" : "") + '>&#9660;</button>' +
      "</td>"
    : "";

  const qtyCell = _manageCostingArrangeMode
    ? "<td>" + it.qty + "</td>"
    : '<td><input type="number" class="lineQtyInput" min="0" step="any" value="' + it.qty + '" style="width:80px;" oninput="markManageCostingDirty()"></td>';

  const actionsCell = _manageCostingArrangeMode
    ? ""
    : '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeManageCostingRow(this)">Remove</button></td>';

  return (
    "<tr" + (_manageCostingArrangeMode ? "" : ' data-line-id="' + it.lineId + '"') + ">" +
      moveCell +
      "<td>" + it.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + it.sku + "</span></td>" +
      qtyCell +
      "<td>" + it.unit + "</td>" +
      actionsCell +
    "</tr>"
  );
}

function startArrangeCosting() {
  if (_manageCostingDirty) { alert("Please Save your changes first, then Arrange."); return; }
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

// Pure DOM removal - no API call, no re-render of the rest of the table, so
// any other row's in-progress unsaved qty edit is left alone. Actually
// deleted (or un-added) server-side only once Save is clicked.
function removeManageCostingRow(btn) {
  btn.closest("tr").remove();
  markManageCostingDirty();

  const tbody = document.getElementById("manageCostingBody");
  if (!tbody.querySelector("tr")) tbody.innerHTML = '<tr><td colspan="4">No recipe lines yet.</td></tr>';
}

// Appends a new <tr> straight into the DOM instead of POSTing immediately -
// data-new-sku/data-unit (no data-line-id) mark it as unsaved so
// saveManageCostingAll() knows to POST it as a new line rather than PATCH.
function addRecipeLineToCosting() {
  const itemSku = _addRecipeLineCombo ? _addRecipeLineCombo.getValue() : "";
  const qty = Number(document.getElementById("addRecipeLineQty").value);
  const unit = document.getElementById("addRecipeLineUnit").value;

  if (!itemSku) { alert("Please select an item."); return; }
  if (!qty || qty <= 0) { alert("Please enter a valid qty."); return; }

  const item = _menuEngLookups.skus.find((s) => s.sku === itemSku);
  const tbody = document.getElementById("manageCostingBody");
  if (!tbody.querySelector(".lineQtyInput")) tbody.innerHTML = ""; // clear the "No recipe lines yet." placeholder

  const row = document.createElement("tr");
  row.dataset.newSku = itemSku;
  row.dataset.unit = unit;
  row.innerHTML =
    "<td>" + (item ? item.name : itemSku) + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + itemSku + "</span></td>" +
    '<td><input type="number" class="lineQtyInput" min="0" step="any" value="' + qty + '" style="width:80px;" oninput="markManageCostingDirty()"></td>' +
    "<td>" + unit + "</td>" +
    '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeManageCostingRow(this)">Remove</button></td>';
  tbody.appendChild(row);

  _addRecipeLineCombo.clear();
  document.getElementById("addRecipeLineQty").value = "";
  document.getElementById("addRecipeLineUnit").value = "";
  markManageCostingDirty();
}

// The one final Save - diffs the table's current DOM state against the
// original snapshot (_manageCostingData.items) to figure out what changed,
// then fires every PATCH/POST/DELETE together. Not wrapped in a DB
// transaction (these are separate REST calls), so a failure partway through
// can leave a partial save - acceptable here since each call is independently
// idempotent-ish and the modal stays open with an error rather than silently
// losing anything.
function saveManageCostingAll() {
  const btn = document.getElementById("saveManageCostingBtn");
  const statusEl = document.getElementById("manageCostingStatus");
  const parentSku = _manageCostingData.sku;
  const isComponentMode = _manageCostingData.itemType === "Component" || _manageCostingData.itemType === "Semi-Finished";

  const rows = Array.from(document.querySelectorAll("#manageCostingBody tr"));
  const keptLineIds = [];
  const updates = [];
  const additions = [];

  for (const row of rows) {
    const qtyInput = row.querySelector(".lineQtyInput");
    if (!qtyInput) continue; // the "No recipe lines yet." placeholder row
    const qty = Number(qtyInput.value);
    if (!qty || qty <= 0) { alert("Please enter a valid qty for every item."); return; }

    if (row.dataset.lineId) {
      keptLineIds.push(row.dataset.lineId);
      updates.push({ lineId: row.dataset.lineId, qty: qty });
    } else if (row.dataset.newSku) {
      additions.push({ componentSku: row.dataset.newSku, qty: qty, unit: row.dataset.unit });
    }
  }

  const deletedLineIds = _manageCostingData.items
    .map((it) => it.lineId)
    .filter((id) => keptLineIds.indexOf(id) === -1);

  let yieldValue;
  if (isComponentMode) {
    const yieldInput = document.getElementById("manageCostingYield");
    yieldValue = yieldInput.value === "" ? null : Number(yieldInput.value);
  }

  withSaveStatus(btn, statusEl, "Costing", async function () {
    const calls = updates.map((u) => api("recipe-lines/" + encodeURIComponent(u.lineId), { method: "PATCH", body: { qty: u.qty } }))
      .concat(deletedLineIds.map((id) => api("recipe-lines/" + encodeURIComponent(id), { method: "DELETE" })))
      .concat(additions.map((a) => api("recipe-lines", { method: "POST", body: { parentSku: parentSku, componentSku: a.componentSku, qty: a.qty, unit: a.unit } })));
    if (isComponentMode) calls.push(api("sku-items/" + encodeURIComponent(parentSku), { method: "PATCH", body: { baseYieldQty: yieldValue } }));

    await Promise.all(calls);
    _manageCostingDirty = false;
    closeModal();
    await loadCostingDetail(parentSku);
  });
}

function costingItemRowHtml(it) {
  return (
    "<tr>" +
      "<td>" + it.name + '<br><span style="color:var(--color-text-muted); font-size:12px;">' + it.sku + "</span></td>" +
      "<td>" + it.qty + "</td>" +
      "<td>" + it.unit + "</td>" +
      '<td><span class="font-number">' + formatRupiah(it.unitCost) + "</span></td>" +
      '<td><span class="font-number">' + formatRupiah(it.lineCost) + "</span></td>" +
    "</tr>"
  );
}
