// Orders is split into 3 top-level pages/nav entries by platform: Online
// Orders (this route, "orders" - manual New Order + Mark Paid/Delivered/
// Cancel, platform="Online"), Platform Orders ("orders-platform" - GrabFood/
// GoFood, arriving via webhook once built, no manual New Order button here),
// and (future) Dine-In. Driver Payout is a 4th, separate top-level page -
// it's a genuinely different workflow (cash-tracking across ALL delivery
// orders regardless of Ongoing/History/platform) so it gets its own route,
// per explicit request. See registerPage("orders-payout", ...) further down.
// All 3 order pages share the same Ongoing/History table rendering below
// (renderOrdersTable etc.) - only the platform filter and the New Order
// button's visibility differ, tracked in _ordersCurrentPlatformFilter/
// _ordersShowNewOrderBtn since loadOrdersData() is also re-called (with no
// args) after every row action (Mark Paid, Cancel, etc.) from whichever page
// is currently active.
registerPage("orders", renderOrdersPage);
registerPage("orders-platform", renderPlatformOrdersPage);

let _ordersLookups = null;
let _customerCombo = null;
let _newCustomerAreaCombo = null;
let _driverCombo = null;
let _ordersByCode = {}; // last-rendered Ongoing/History rows, keyed by order_code - lets the Mark Paid modal show order details without a re-fetch
let _ordersCurrentPlatformFilter = "Online";
let _ordersShowNewOrderBtn = true;
let _ordersIsPlatformMode = false; // Platform Orders has a different column layout (see renderOrdersTable)

// Order History filter (date range + platform) - client-side over the
// already-fetched history set, same pattern as Purchase Log's Filter & Sort
// (see pages/inventory.js's openPurchaseFilterSortModal). Reset on every
// page navigation so switching Online <-> Platform Orders never carries
// over a stale filter from the other page.
let _ordersHistoryRaw = [];
let _ordersHistoryDateFrom = "";
let _ordersHistoryDateTo = "";
let _ordersHistoryPlatformFilter = [];

async function renderOrdersPage(content) {
  await ensureOrdersLookups();
  _ordersCurrentPlatformFilter = "Online";
  _ordersShowNewOrderBtn = true;
  _ordersIsPlatformMode = false;
  _ordersHistoryDateFrom = "";
  _ordersHistoryDateTo = "";
  _ordersHistoryPlatformFilter = [];

  content.innerHTML =
    "<h2>Online Orders</h2>" +
    '<div id="ordersOngoingWrap"><p>Loading...</p></div>' +
    '<div id="ordersHistoryWrap" style="margin-top:28px;"></div>';
  await loadOrdersData();
}

// GrabFood/GoFood orders arrive via platform webhook (once built), not the
// New Order form - so no "+ New Order" button here, unlike Online Orders.
// Row actions (Mark Paid/Delivered/Cancel) are shared with Online Orders
// since a platform order still needs the same status tracking once it's in
// our system.
async function renderPlatformOrdersPage(content) {
  await ensureOrdersLookups();
  _ordersCurrentPlatformFilter = "GrabFood,GoFood";
  _ordersShowNewOrderBtn = false;
  _ordersIsPlatformMode = true;
  _ordersHistoryDateFrom = "";
  _ordersHistoryDateTo = "";
  _ordersHistoryPlatformFilter = [];

  content.innerHTML =
    "<h2>Platform Orders</h2>" +
    '<div id="ordersOngoingWrap"><p>Loading...</p></div>' +
    '<div id="ordersHistoryWrap" style="margin-top:28px;"></div>';
  await loadOrdersData();
}

async function ensureOrdersLookups() {
  if (!_ordersLookups) _ordersLookups = await api("lookups");
  return _ordersLookups;
}

// ---------- New Order modal ----------

async function openOrderModal() {
  const lookups = await ensureOrdersLookups();
  openModal(buildOrderFormHtml());
  initOrderForm(lookups);
}

function buildOrderFormHtml() {
  return (
    "<h2>New Order</h2>" +
    '<div style="display:flex; gap:20px; flex-wrap:wrap;">' +
      "<div>" +
        "<label>Order Date</label><br>" +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<input type="checkbox" id="orderToday" onchange="setOrderToday()">' +
          '<label for="orderToday">Today</label>' +
          '<input type="date" id="orderDate">' +
        "</div>" +
      "</div>" +
      "<div>" +
        "<label>Fulfillment Date</label><br>" +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<input type="checkbox" id="deliveryToday" onchange="setDeliveryToday()">' +
          '<label for="deliveryToday">Today</label>' +
          '<input type="date" id="deliveryDate">' +
        "</div>" +
      "</div>" +
    "</div><br>" +

    // One shared CSS Grid (2 columns x 4 rows), not two independently-flowed
    // flex columns with manually-matched margins - a grid forces every cell
    // in the same row to the same height by construction, so Customer/Name,
    // Contact/Contact, Area/Area, Address/Address always land level with
    // each other regardless of any one field's own rendering quirks (a
    // combobox vs a plain input, a stray tag throwing off one column's
    // margins, etc - exactly the kind of drift that broke this before).
    // The right column is one display:contents group (see
    // #newCustomerFieldsWrap) so toggleNewCustomer() can show/hide all 4 of
    // its cells at once while each still participates in the grid
    // individually - visibility (not display) keeps every cell's row height
    // reserved either way, so neither column ever shifts when the checkbox
    // is (un)checked, per explicit request.
    // grid-auto-flow:column + explicit grid-template-rows fills column 1
    // (all 4 left/locked cells, in DOM order) before moving to column 2 (all
    // 4 right/New-Customer cells) - keeps the right cells contiguous in the
    // DOM despite being visually interleaved row-by-row, so they can still
    // be wrapped in one display:contents group for toggleNewCustomer() to
    // show/hide as a unit.
    '<div style="display:grid; grid-template-columns:220px 200px; grid-template-rows:repeat(4, auto); grid-auto-flow:column; column-gap:30px; row-gap:12px; align-items:start;">' +
      // Checkbox sits on its own line BELOW the combo (not squeezed beside
      // it) so the combo can be full column width, matching Contact/Area/
      // Address below it - this makes the Customer cell taller than a
      // single input row, which the grid's shared row-height automatically
      // reserves for Name's cell too (align-items:start keeps Name's own
      // content top-aligned in that extra space), no overlap either way.
      "<div>" +
        "<label>Customer</label><br>" +
        '<div id="orderCustomerCombo" style="width:100%;"></div>' +
        '<label style="display:flex; align-items:center; gap:4px; font-weight:normal; margin-top:6px;">' +
          '<input type="checkbox" id="newCustomerToggle" onchange="toggleNewCustomer()">' +
          "New Customer" +
        "</label>" +
      "</div>" +
      '<div><label>Contact</label><br><input type="text" id="orderContact" readonly style="background:var(--color-disabled-bg); width:100%; box-sizing:border-box;"></div>' +
      // Editable (not readonly) - saving corrects the customer's own
      // area/address record too (see saveOrder()'s customer PATCH), per
      // explicit request.
      '<div><div style="display:flex; justify-content:space-between; align-items:baseline;"><label>Area</label><span id="orderAreaUpdatedBadge" style="display:none; font-size:11px; color:var(--color-accent);">Update</span></div><input type="text" id="orderArea" oninput="updateFieldUpdatedBadge(this)" style="width:100%; box-sizing:border-box;"></div>' +
      '<div><div style="display:flex; justify-content:space-between; align-items:baseline;"><label>Address</label><span id="orderAddressUpdatedBadge" style="display:none; font-size:11px; color:var(--color-accent);">Update</span></div><input type="text" id="orderAddress" oninput="updateFieldUpdatedBadge(this)" style="width:100%; box-sizing:border-box;"></div>' +
      '<div id="newCustomerFieldsWrap" style="visibility:hidden; display:contents;">' +
        '<div><label>Name</label><br><input type="text" id="newCustomerName" style="width:100%; box-sizing:border-box;"></div>' +
        '<div><label>Contact</label><br><input type="text" id="newCustomerContact" style="width:100%; box-sizing:border-box;"></div>' +
        '<div><label>Area</label><br><div id="newCustomerAreaCombo" style="width:100%;"></div></div>' +
        '<div><label>Address</label><br><input type="text" id="newCustomerAddress" style="width:100%; box-sizing:border-box;"></div>' +
      "</div>" +
    "</div><br>" +

    // One header row for the whole list (not per-item field labels), same
    // table/colgroup pattern as Input Sales.
    '<table style="table-layout:fixed; width:auto;">' +
      '<colgroup><col style="width:200px;"><col style="width:90px;"><col style="width:130px;"><col style="width:130px;"><col style="width:74px;"></colgroup>' +
      "<thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead>" +
      '<tbody id="orderItemRows"></tbody>' +
    "</table>" +
    '<button type="button" onclick="addOrderItemRow()">+ Add Item</button>' +
    '<div style="margin-top:8px; font-weight:bold;">Total: <span id="orderGrandTotal" class="font-number">Rp 0</span></div><br>' +

    // One shared CSS Grid across BOTH rows (not two separate flex rows) -
    // grid-template-columns applies to every row placed into it, so column 1
    // (Type/Status) and column 2 (Fee/Payment) are ALWAYS the same width in
    // both rows by construction, regardless of content (a <select>'s options
    // changing length - e.g. "Delivered" vs "Picked Up" - can no longer
    // resize its box independently of the row below it, which is what was
    // still "off" with the previous per-row-fixed-width flex attempt).
    '<div style="display:grid; grid-template-columns:160px 160px 180px; gap:16px 20px;">' +
      '<div>' +
        "<label>Fulfillment Type</label><br>" +
        '<select id="orderType" onchange="onOrderTypeChange()" style="width:100%;">' +
          "<option>Delivery</option><option>Takeaway</option>" +
        "</select>" +
      "</div>" +
      '<div id="orderDeliveryFeeWrap">' +
        "<label>Delivery Fee</label><br>" +
        '<input type="text" id="orderDeliveryFee" inputmode="numeric" oninput="formatAmount(this)" style="width:100%; box-sizing:border-box;">' +
      "</div>" +
      '<div id="orderDriverWrap">' +
        "<label>Driver</label><br>" +
        '<div id="orderDriverCombo" style="width:100%;"></div>' +
      "</div>" +
      "<div>" +
        "<label>Fulfillment Status</label><br>" +
        '<select id="orderFulfillmentStatus" style="width:100%;"></select>' +
      "</div>" +
      "<div>" +
        "<label>Payment Status</label><br>" +
        '<select id="orderPaymentStatus" onchange="onOrderPaymentStatusChange()" style="width:100%;">' +
          "<option>Unpaid</option><option>Paid</option>" +
        "</select>" +
      "</div>" +
      '<div id="orderMethodWrap" style="display:none;">' +
        "<label>Method</label><br>" +
        '<select id="orderMethod" style="width:100%;"></select>' +
      "</div>" +
    "</div><br>" +

    "<label>Notes</label><br>" +
    '<input type="text" id="orderNotes" style="width:400px;"><br><br>' +

    '<button id="saveOrderBtn" class="btn-primary" onclick="saveOrder()">Save Order</button>' +
    '<span id="saveOrderStatus" class="save-status"></span>'
  );
}

function initOrderForm(lookups) {
  // Order Date starts empty - pick a date explicitly (Today included)
  // rather than silently defaulting to today, per explicit request.
  const customerContainer = document.getElementById("orderCustomerCombo");
  _customerCombo = createCombobox(
    customerContainer,
    lookups.customers.map((c) => ({ value: c.id, label: c.name, sub: c.contact || "" })),
    {
      placeholder: "Select customer...",
      onSelect: function (value, item) {
        const c = lookups.customers.find((x) => x.id === value);
        document.getElementById("orderContact").value = c && c.contact ? formatPhoneDisplay(c.contact) : "";
        setCustomerFieldOriginal(document.getElementById("orderArea"), c ? c.area : "");
        setCustomerFieldOriginal(document.getElementById("orderAddress"), c ? c.address : "");
      }
    }
  );

  // Suggests areas already used by existing customers, but freely accepts a
  // brand-new one - per explicit request.
  const areas = [...new Set(lookups.customers.map((c) => c.area).filter(Boolean))].sort();
  _newCustomerAreaCombo = createCombobox(
    document.getElementById("newCustomerAreaCombo"),
    areas.map((a) => ({ value: a, label: a })),
    { placeholder: "Area...", allowFreeText: true, commitValue: true }
  );

  const driverContainer = document.getElementById("orderDriverCombo");
  _driverCombo = createCombobox(
    driverContainer,
    // Dropdown-only, no free text - Staff (Driver role) + GrabExpress are
    // the only real delivery driver options, per explicit request. Also
    // keeps "GrabExpress" saving as the exact string driver_payout
    // auto-Paid logic matches on (functions/api/orders.js) - a free-typed
    // variant risked a typo that'd silently skip that logic.
    [{ value: "GrabExpress", label: "GrabExpress", sub: "External" }].concat(
      driverStaffOptions().map((s) => ({ value: s.id, label: s.name, sub: "Staff" }))
    ),
    { placeholder: "Select driver..." }
  );

  const methodSelect = document.getElementById("orderMethod");
  methodSelect.innerHTML = lookups.paymentMethods.map((m) => "<option>" + m + "</option>").join("");

  addOrderItemRow(); // start with one row like the old app
  onOrderTypeChange();
}

// "Updated" badge next to Area/Address's label (New Order and Edit Order,
// see buildOrderFormHtml/buildEditOrderFormHtml) - shown when the field's
// current value differs from whatever it was loaded with (the customer's
// existing record), since saving PATCHes that record. input.dataset.original
// is set once whenever a field gets (re)populated FROM a customer record
// (customer selected, or Edit Order's initial load) - never touched by
// typing itself, so it stays the correct baseline to compare against.
function setCustomerFieldOriginal(input, value) {
  input.value = value || "";
  input.dataset.original = value || "";
  updateFieldUpdatedBadge(input);
}

function updateFieldUpdatedBadge(input) {
  const badge = document.getElementById(input.id + "UpdatedBadge");
  if (!badge) return;
  badge.style.display = input.value.trim() !== (input.dataset.original || "") ? "" : "none";
}

function setOrderToday() {
  if (document.getElementById("orderToday").checked) document.getElementById("orderDate").value = todayISO();
}
function setDeliveryToday() {
  if (document.getElementById("deliveryToday").checked) document.getElementById("deliveryDate").value = todayISO();
}

function toggleNewCustomer() {
  const isNew = document.getElementById("newCustomerToggle").checked;
  // Locked (dimmed, non-interactive), never hidden - so the checkbox and
  // New Customer's own fields never reflow into its old spot, per explicit
  // request.
  const comboEl = document.getElementById("orderCustomerCombo");
  comboEl.style.pointerEvents = isNew ? "none" : "";
  comboEl.style.opacity = isNew ? "0.5" : "";
  document.getElementById("orderArea").disabled = isNew;
  document.getElementById("orderAddress").disabled = isNew;
  document.getElementById("newCustomerFieldsWrap").style.visibility = isNew ? "" : "hidden";
  if (isNew) {
    _customerCombo.clear();
    document.getElementById("orderContact").value = "";
    setCustomerFieldOriginal(document.getElementById("orderArea"), "");
    setCustomerFieldOriginal(document.getElementById("orderAddress"), "");
  } else {
    document.getElementById("newCustomerName").value = "";
    document.getElementById("newCustomerContact").value = "";
    document.getElementById("newCustomerAddress").value = "";
    _newCustomerAreaCombo.clear();
  }
}

// Shared by New Order and Edit Order (see openEditOrderModal) - Edit's form
// has no Driver/Fulfillment Status fields at all (excluded per explicit
// request), so every reference to them is null-guarded rather than
// duplicating this whole function for that one difference.
function onOrderTypeChange() {
  const orderType = document.getElementById("orderType").value;
  const isDelivery = orderType === "Delivery";
  // visibility (not display) - keeps each field's grid cell reserved, so
  // switching Takeaway<->Delivery only hides/shows Fee and Driver in place
  // rather than the whole grid reflowing (Fulfillment Status/Payment
  // Status/Method shifting up to fill the now-empty cells), per explicit
  // request.
  document.getElementById("orderDeliveryFeeWrap").style.visibility = isDelivery ? "" : "hidden";
  const driverWrap = document.getElementById("orderDriverWrap");
  if (driverWrap) driverWrap.style.visibility = isDelivery ? "" : "hidden";
  if (!isDelivery) {
    document.getElementById("orderDeliveryFee").value = "";
    if (_driverCombo) _driverCombo.clear();
  }

  // Delivered only makes sense for Delivery, Picked Up only for Takeaway -
  // Pending is valid (and the reset default) either way.
  const fulfillmentStatusEl = document.getElementById("orderFulfillmentStatus");
  if (fulfillmentStatusEl) {
    const options = isDelivery ? ["Pending", "Delivered"] : ["Pending", "Picked Up"];
    fulfillmentStatusEl.innerHTML = options.map((o) => "<option>" + o + "</option>").join("");
  }
}

function onOrderPaymentStatusChange() {
  const isPaid = document.getElementById("orderPaymentStatus").value === "Paid";
  document.getElementById("orderMethodWrap").style.display = isPaid ? "" : "none";
}

// Ported verbatim (field order + sizing) from the old app's
// 05 Orders/OngoingOrders_JS.html -> addOrderItemRow(). Product -> Qty ->
// Price -> Total, in that order - confirmed against the source file, not
// from memory.
// prefill (Edit Order only - New Order always calls this with no args) -
// {lineId, skuId, name, qty, unitPrice} for one existing order_items row,
// so the row starts populated (and tracked back to that line on save)
// instead of blank. lineId lives on the row's dataset, read by
// collectOrderItems() below.
function addOrderItemRow(prefill) {
  const wrap = document.getElementById("orderItemRows");
  const row = document.createElement("tr");
  row.className = "order-item-row";
  if (prefill && prefill.lineId) row.dataset.lineId = prefill.lineId;
  row.innerHTML =
    '<td><div class="sku-combo"></div></td>' +
    '<td><input type="number" class="qty" min="1" style="width:100%; box-sizing:border-box;" oninput="updateOrderRowTotal(this.closest(\'.order-item-row\'))" value="' + (prefill ? prefill.qty : "") + '"></td>' +
    '<td><input type="text" class="unitPrice" inputmode="numeric" style="width:100%; box-sizing:border-box;" oninput="formatAmount(this); updateOrderRowTotal(this.closest(\'.order-item-row\'))" value="' + (prefill ? formatRupiah(prefill.unitPrice) : "") + '"></td>' +
    '<td><input type="text" class="lineTotal" readonly style="width:100%; box-sizing:border-box; background:var(--color-disabled-bg);" value="' + (prefill ? formatRupiah(prefill.qty * prefill.unitPrice) : "") + '"></td>' +
    '<td class="compact-cell"><button type="button" class="btn-compact" onclick="removeOrderItemRow(this)">Remove</button></td>';
  wrap.appendChild(row);

  // Product uses "Active"/"Inactive" (not "Available"/"Unavailable" like
  // every other item_type) - same fix as pages/sales.js's salesProductOptions.
  const productSkus = _ordersLookups.skus.filter((s) => s.item_type === "Product" && s.status !== "Inactive");
  const combo = createCombobox(
    row.querySelector(".sku-combo"),
    productSkus.map((s) => ({ value: s.id, label: s.name, sub: s.sku })),
    {
      placeholder: "Select item...",
      onSelect: function (skuId) { onOrderRowProductChange(row, skuId); }
    }
  );
  row._combo = combo;
  if (prefill && prefill.skuId) {
    // setSelection() fires onSelect same as a manual pick, which would
    // overwrite unitPrice with the product's CURRENT selling price via
    // onOrderRowProductChange - re-set it back to the order's actual
    // (possibly historical/different) price right after, then recompute
    // the line total against that correct value.
    combo.setSelection(prefill.skuId, prefill.name);
    row.querySelector(".unitPrice").value = formatRupiah(prefill.unitPrice);
    updateOrderRowTotal(row);
  }
}

// Price auto-fills from the product's Base Selling Price - Orders always
// represents the "Online" channel (Base Pricing meta, same as Dine In - see
// salePlatformOptionsHtml in pages/sales.js), never a Platform Pricing
// channel, so there's no channel toggle to check here unlike Input Sales.
// Still freely editable after, same as Input Sales's onSaleRowProductChange.
function onOrderRowProductChange(row, skuId) {
  const product = _ordersLookups.skus.find((s) => s.id === skuId);
  const price = product ? Number(product.selling_price) || 0 : 0;

  row.querySelector(".unitPrice").value = price ? formatRupiah(price) : "";
  updateOrderRowTotal(row);
}

function removeOrderItemRow(btn) {
  const rows = document.querySelectorAll("#orderItemRows .order-item-row");
  if (rows.length <= 1) return; // old app keeps at least one row on screen
  btn.closest(".order-item-row").remove();
  updateOrderGrandTotal();
}

function updateOrderRowTotal(row) {
  const qty = Number(row.querySelector(".qty").value) || 0;
  const price = parseAmount(row.querySelector(".unitPrice").value);
  const total = qty * price;
  row.querySelector(".lineTotal").value = total ? formatRupiah(total) : "";
  updateOrderGrandTotal();
}

function updateOrderGrandTotal() {
  let total = 0;
  document.querySelectorAll("#orderItemRows .order-item-row").forEach(function (row) {
    const qty = Number(row.querySelector(".qty").value) || 0;
    const price = parseAmount(row.querySelector(".unitPrice").value);
    total += qty * price;
  });
  document.getElementById("orderGrandTotal").textContent = formatRupiah(total);
}

function collectOrderItems() {
  const items = [];
  document.querySelectorAll("#orderItemRows .order-item-row").forEach(function (row) {
    const skuId = row._combo.getValue();
    const qty = Number(row.querySelector(".qty").value) || 0;
    const price = parseAmount(row.querySelector(".unitPrice").value);
    // lineId only ever set by Edit Order's prefill (see addOrderItemRow) -
    // undefined for every New Order row, which the backend correctly reads
    // as "this is a new line" either way.
    if (skuId && qty > 0) items.push({ skuId: skuId, qty: qty, unitPrice: price, lineId: row.dataset.lineId || undefined });
  });
  return items;
}

// Driver combo value is either a staff id (picked from the list) or raw
// typed text (external driver, e.g. "GrabExpress") - tell them apart by
// checking against the staff ids we loaded into the combo.
function resolveDriver(value) {
  if (!value) return { driverStaffId: null, driverNameRaw: null };
  const isStaff = _ordersLookups.staff.some((s) => s.id === value);
  return isStaff ? { driverStaffId: value, driverNameRaw: null } : { driverStaffId: null, driverNameRaw: value };
}

async function saveOrder() {
  const btn = document.getElementById("saveOrderBtn");
  const statusEl = document.getElementById("saveOrderStatus");

  withSaveStatus(btn, statusEl, "Order", async function () {
    const isNewCustomer = document.getElementById("newCustomerToggle").checked;
    let customerId = _customerCombo.getValue();

    if (isNewCustomer) {
      const name = document.getElementById("newCustomerName").value.trim();
      if (!name) throw new Error("New customer name is required");
      const created = await api("customers", {
        method: "POST",
        body: {
          name: name,
          contact: document.getElementById("newCustomerContact").value.trim() || undefined,
          area: _newCustomerAreaCombo.getValue() || undefined,
          address: document.getElementById("newCustomerAddress").value.trim() || undefined
        }
      });
      customerId = created.id;
      _ordersLookups.customers.push(created); // so it's pickable next time without a reload
    }
    if (!customerId) throw new Error("Please select or add a customer");
    if (!document.getElementById("orderDate").value) throw new Error("Please select an order date");
    if (!document.getElementById("deliveryDate").value) throw new Error("Please select a fulfillment date");

    // Area/Address are editable now (not readonly) - saving here corrects
    // the customer's own record too, per explicit request. Skipped for a
    // brand-new customer - its area/address were already set correctly by
    // the POST above.
    if (!isNewCustomer) {
      const customer = _ordersLookups.customers.find((c) => c.id === customerId);
      if (customer) {
        await api("customers/" + encodeURIComponent(customer.customer_code), {
          method: "PATCH",
          body: {
            area: document.getElementById("orderArea").value.trim() || null,
            address: document.getElementById("orderAddress").value.trim() || null
          }
        });
        customer.area = document.getElementById("orderArea").value.trim() || null;
        customer.address = document.getElementById("orderAddress").value.trim() || null;
      }
    }

    const items = collectOrderItems();
    if (!items.length) throw new Error("Add at least one product");

    const orderType = document.getElementById("orderType").value;
    const driver = orderType === "Delivery" ? resolveDriver(_driverCombo.getValue()) : { driverStaffId: null, driverNameRaw: null };

    const payload = {
      orderDate: document.getElementById("orderDate").value,
      deliveryDate: document.getElementById("deliveryDate").value || null,
      customerId: customerId,
      items: items,
      orderType: orderType,
      deliveryFee: orderType === "Delivery" ? parseAmount(document.getElementById("orderDeliveryFee").value) : 0,
      driverStaffId: driver.driverStaffId,
      driverNameRaw: driver.driverNameRaw,
      fulfillmentStatus: document.getElementById("orderFulfillmentStatus").value,
      paymentStatus: document.getElementById("orderPaymentStatus").value,
      paymentMethod: document.getElementById("orderPaymentStatus").value === "Paid" ? document.getElementById("orderMethod").value : null,
      notes: document.getElementById("orderNotes").value || null
    };

    await api("orders", { method: "POST", body: payload });
    closeModal();
    await loadOrdersData();
  });
}

// ---------- Edit Order modal (Ongoing Online Orders only) ----------
// Same layout as New Order, but Order Date and Customer are locked
// (read-only, never sent in the PATCH) and there's no Driver/Fulfillment
// Status/Payment Status - those are handled by their own dedicated actions
// (Mark Delivered's driver picker, Mark Paid) rather than a general edit,
// per explicit request. Reuses the exact same item-row machinery as New
// Order (addOrderItemRow/collectOrderItems/onOrderTypeChange etc.) since
// only one modal is ever open at a time.

function openEditOrderModal(orderCode) {
  const o = _ordersByCode[orderCode];
  if (!o) return;
  openModal(buildEditOrderFormHtml(o));
  initEditOrderForm(o);
}

function buildEditOrderFormHtml(o) {
  return (
    "<h2>Edit Order - " + o.orderCode + "</h2>" +
    '<div style="display:flex; gap:20px; flex-wrap:wrap;">' +
      "<div>" +
        "<label>Order Date</label><br>" +
        '<input type="text" value="' + o.orderDate + '" readonly style="background:var(--color-disabled-bg); width:150px; box-sizing:border-box;">' +
      "</div>" +
      "<div>" +
        "<label>Fulfillment Date</label><br>" +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<input type="checkbox" id="deliveryToday" onchange="setDeliveryToday()">' +
          '<label for="deliveryToday">Today</label>' +
          '<input type="date" id="deliveryDate">' +
        "</div>" +
      "</div>" +
    "</div><br>" +

    "<div>" +
      "<label>Customer</label><br>" +
      '<input type="text" value="' + o.customerName + '" readonly style="background:var(--color-disabled-bg); width:220px; box-sizing:border-box;">' +
      '<label style="display:block; margin-top:8px;">Contact</label>' +
      '<input type="text" value="' + (o.customerContact ? formatPhoneDisplay(o.customerContact) : "") + '" readonly style="background:var(--color-disabled-bg); margin-top:2px; width:220px; box-sizing:border-box;">' +
      // Editable (not readonly) - saving corrects the customer's own
      // area/address record too (see saveEditOrder()'s customer PATCH), per
      // explicit request.
      '<div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; width:220px;"><label>Area</label><span id="editOrderAreaUpdatedBadge" style="display:none; font-size:11px; color:var(--color-accent);">Update</span></div>' +
      '<input type="text" id="editOrderArea" value="' + (o.customerArea || "") + '" oninput="updateFieldUpdatedBadge(this)" style="margin-top:2px; width:220px; box-sizing:border-box;">' +
      '<div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; width:220px;"><label>Address</label><span id="editOrderAddressUpdatedBadge" style="display:none; font-size:11px; color:var(--color-accent);">Update</span></div>' +
      '<input type="text" id="editOrderAddress" value="' + (o.customerAddress || "") + '" oninput="updateFieldUpdatedBadge(this)" style="margin-top:2px; width:220px; box-sizing:border-box;">' +
    "</div><br>" +

    '<table style="table-layout:fixed; width:auto;">' +
      '<colgroup><col style="width:200px;"><col style="width:90px;"><col style="width:130px;"><col style="width:130px;"><col style="width:74px;"></colgroup>' +
      "<thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead>" +
      '<tbody id="orderItemRows"></tbody>' +
    "</table>" +
    '<button type="button" onclick="addOrderItemRow()">+ Add Item</button>' +
    '<div style="margin-top:8px; font-weight:bold;">Total: <span id="orderGrandTotal" class="font-number">Rp 0</span></div><br>' +

    '<div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">' +
      '<div style="width:160px;">' +
        "<label>Fulfillment Type</label><br>" +
        '<select id="orderType" onchange="onOrderTypeChange()" style="width:100%;">' +
          "<option>Delivery</option><option>Takeaway</option>" +
        "</select>" +
      "</div>" +
      '<div id="orderDeliveryFeeWrap" style="width:160px;">' +
        "<label>Delivery Fee</label><br>" +
        '<input type="text" id="orderDeliveryFee" inputmode="numeric" oninput="formatAmount(this)" style="width:100%; box-sizing:border-box;">' +
      "</div>" +
    "</div><br>" +

    "<label>Notes</label><br>" +
    '<input type="text" id="orderNotes" style="width:400px;"><br><br>' +

    '<button id="saveOrderBtn" class="btn-primary" onclick="saveEditOrder(\'' + o.orderCode + '\')">Save Changes</button>' +
    '<span id="saveOrderStatus" class="save-status"></span>'
  );
}

function initEditOrderForm(o) {
  document.getElementById("deliveryDate").value = o.deliveryDate || "";
  document.getElementById("orderType").value = o.orderType;
  document.getElementById("orderDeliveryFee").value = o.deliveryFee ? formatRupiah(o.deliveryFee) : "";
  document.getElementById("orderNotes").value = o.notes || "";
  setCustomerFieldOriginal(document.getElementById("editOrderArea"), o.customerArea || "");
  setCustomerFieldOriginal(document.getElementById("editOrderAddress"), o.customerAddress || "");

  o.items.forEach((it) => addOrderItemRow({ lineId: it.lineId, skuId: it.skuId, name: it.name, qty: it.qty, unitPrice: it.unitPrice }));
  onOrderTypeChange();
}

function saveEditOrder(orderCode) {
  const btn = document.getElementById("saveOrderBtn");
  const statusEl = document.getElementById("saveOrderStatus");

  withSaveStatus(btn, statusEl, "Order", async function () {
    if (!document.getElementById("deliveryDate").value) throw new Error("Please select a fulfillment date");

    const items = collectOrderItems();
    if (!items.length) throw new Error("Add at least one product");

    const orderType = document.getElementById("orderType").value;
    const payload = {
      deliveryDate: document.getElementById("deliveryDate").value || null,
      items: items,
      orderType: orderType,
      deliveryFee: orderType === "Delivery" ? parseAmount(document.getElementById("orderDeliveryFee").value) : 0,
      notes: document.getElementById("orderNotes").value || null
    };

    // Area/Address are editable now (not readonly) - saving here corrects
    // the customer's own record too, per explicit request.
    const o = _ordersByCode[orderCode];
    if (o && o.customerCode) {
      await api("customers/" + encodeURIComponent(o.customerCode), {
        method: "PATCH",
        body: {
          area: document.getElementById("editOrderArea").value.trim() || null,
          address: document.getElementById("editOrderAddress").value.trim() || null
        }
      });
    }

    await api("orders/" + encodeURIComponent(orderCode), { method: "PATCH", body: payload });
    closeModal();
    await loadOrdersData();
  });
}

// ---------- Table (Ongoing / History / Driver Payout) ----------

// Ongoing + History stacked on one page (History below Ongoing, no tab-
// switch), same pattern as pages/sales.js's Summary/Log and pages/menu.js's
// Ongoing Batches/Batch History.
async function loadOrdersData() {
  const platformQuery = _ordersCurrentPlatformFilter ? "&platform=" + encodeURIComponent(_ordersCurrentPlatformFilter) : "";
  const [ongoing, history] = await Promise.all([
    api("orders?scope=ongoing" + platformQuery),
    api("orders?scope=history" + platformQuery)
  ]);
  if (!document.getElementById("ordersOngoingWrap")) return;

  // Reset once here (not inside renderOrdersTable) - it's called twice now,
  // once per section, and would otherwise wipe out the first section's
  // entries when the second one runs.
  _ordersByCode = {};
  // Registered from the full unfiltered set (not just what ends up
  // rendered) so a stale History filter never leaves an order unreachable
  // by code - cheap insurance, no current caller needs it, but matches how
  // Ongoing's own registration works.
  ongoing.forEach((o) => { _ordersByCode[o.orderCode] = o; });
  history.forEach((o) => { _ordersByCode[o.orderCode] = o; });

  _ordersHistoryRaw = history;
  renderOrdersTable(document.getElementById("ordersOngoingWrap"), ongoing, "ongoing");
  renderHistorySection();
}

function visibleHistoryOrders() {
  return _ordersHistoryRaw.filter((o) =>
    (!_ordersHistoryDateFrom || o.orderDate >= _ordersHistoryDateFrom) &&
    (!_ordersHistoryDateTo || o.orderDate <= _ordersHistoryDateTo) &&
    (!_ordersHistoryPlatformFilter.length || _ordersHistoryPlatformFilter.indexOf(o.platform) !== -1)
  );
}

function renderHistorySection() {
  const wrap = document.getElementById("ordersHistoryWrap");
  if (!wrap) return;
  renderOrdersTable(wrap, visibleHistoryOrders(), "history");
}

function ordersHistoryFilterBadgeText() {
  const dateParts = [];
  if (_ordersHistoryDateFrom) dateParts.push("from " + _ordersHistoryDateFrom);
  if (_ordersHistoryDateTo) dateParts.push("to " + _ordersHistoryDateTo);
  const dateText = dateParts.length ? dateParts.join(" ") : "All dates";
  const platformText = _ordersHistoryPlatformFilter.length ? _ordersHistoryPlatformFilter.join(", ") : "All platforms";
  return dateText + " | " + platformText;
}

// Platform checklist only shown when there's more than one distinct
// platform in the currently loaded history (Online Orders always has
// exactly one - "Online" - so a single always-on checkbox would filter
// nothing); Platform Orders' GrabFood+GoFood mix is the actual use case.
function openOrdersHistoryFilterModal() {
  const platforms = [...new Set(_ordersHistoryRaw.map((o) => o.platform).filter(Boolean))].sort();
  const platformChecks = platforms
    .map((p) =>
      '<label style="display:block; margin:4px 0;"><input type="checkbox" class="ordersHistoryPlatformCheck" value="' + p + '"' +
        (_ordersHistoryPlatformFilter.indexOf(p) !== -1 ? " checked" : "") + "> " + p + "</label>"
    )
    .join("");

  openModal(
    "<h2>Filter - Order History</h2>" +
    "<label>Date Range</label><br>" +
    '<div style="display:flex; align-items:center; gap:8px;">' +
      '<input type="date" id="ordersHistoryDateFrom" value="' + _ordersHistoryDateFrom + '">' +
      "<span>to</span>" +
      '<input type="date" id="ordersHistoryDateTo" value="' + _ordersHistoryDateTo + '">' +
    "</div><br><br>" +
    (platforms.length > 1 ? "<label>Platform</label><div>" + platformChecks + "</div><br>" : "") +
    '<div style="margin-top:16px;">' +
      '<button class="btn-primary" onclick="applyOrdersHistoryFilter()">Apply</button>' +
    "</div>"
  );
}

function applyOrdersHistoryFilter() {
  _ordersHistoryDateFrom = document.getElementById("ordersHistoryDateFrom").value || "";
  _ordersHistoryDateTo = document.getElementById("ordersHistoryDateTo").value || "";
  const checks = document.querySelectorAll(".ordersHistoryPlatformCheck:checked");
  _ordersHistoryPlatformFilter = checks.length ? Array.from(checks).map((cb) => cb.value) : [];
  closeModal();
  renderHistorySection();
}

// Ported verbatim (columns + action buttons) from the old app's
// 05 Orders/OngoingOrdersTable.html + OrderHistoryTable.html +
// OngoingOrdersTable_JS.html - read directly from the source files, not
// reconstructed from memory. Order code isn't a visible column there
// either (only used internally as the row's reference); kept that way here.
function orderTotal(o) {
  return o.items.reduce((s, it) => s + it.lineTotal, 0) + o.deliveryFee;
}

// "Copy Order Form" (Online Orders only) - a plain-text order summary
// formatted for pasting straight into a WA chat with the customer, matching
// an exact template given by explicit request. Built fresh from the order's
// current data every time the button is clicked, not stored anywhere.
function buildOrderFormText(o) {
  const address = o.orderType === "Takeaway" ? "ambil sendiri" : (o.customerAddress || "");

  // Same digit-normalization as shared.js's formatPhoneDisplay (country
  // code stripped, 0-prefixed) but WITHOUT the dash-grouping it adds for
  // on-screen display - the WA form template wants plain digits.
  const countryCode = _generalSettings.phoneCountryCode || "62";
  let waDigits = String(o.customerContact || "").replace(/\D/g, "");
  if (waDigits.indexOf(countryCode) === 0) waDigits = "0" + waDigits.slice(countryCode.length);
  else if (waDigits && waDigits.indexOf("0") !== 0) waDigits = "0" + waDigits;

  const itemLines = o.items
    .map((it, i) => {
      const unitK = Math.round(it.unitPrice / 1000) + "k";
      const lineK = Math.round(it.unitPrice * it.qty / 1000) + "k";
      return (i + 1) + ". " + it.name + " (" + unitK + ") x " + it.qty + " = " + lineK;
    })
    .join("\n");

  return (
    "📝 FORM ORDER - MaluMaluBabi\n\n" +
    "Nama Lengkap: " + o.customerName + "\n" +
    "No. WA: " + waDigits + "\n" +
    "Alamat: " + address + "\n\n" +
    "Pesanan:\n" +
    itemLines + "\n\n" +
    "TOTAL: Rp. " + orderTotal(o).toLocaleString("id-ID") + "\n\n" +
    "Metode Bayar: " + (o.paymentMethod || "") + "\n\n" +
    "Catatan: " + (o.notes || "")
  );
}

// "Copy Template Form" - a blank version of the same form, for staff to
// fill in by hand while taking an order over WA/phone before it's entered
// into the system, per explicit request. Not order-specific, so it lives
// next to "+ New Order" itself rather than per-row.
function buildBlankOrderFormTemplate() {
  return (
    "📝 FORM ORDER - MaluMaluBabi\n\n" +
    "Nama Lengkap: ...\n" +
    "No. WA: ...\n" +
    "Alamat: ...\n\n" +
    "Pesanan:\n" +
    "1. [item] x [jumlah]\n" +
    "2. [item] x [jumlah]\n\n" +
    "Metode Bayar: \n\n" +
    "Catatan:"
  );
}

function copyBlankOrderFormTemplate(btn) {
  const text = buildBlankOrderFormTemplate();
  const originalLabel = btn.textContent;

  navigator.clipboard.writeText(text).then(function () {
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = originalLabel; }, 1500);
  }).catch(function () {
    alert("Couldn't copy automatically. Here's the text:\n\n" + text);
  });
}

function copyOrderFormText(btn, orderCode) {
  const o = _ordersByCode[orderCode];
  if (!o) return;
  const text = buildOrderFormText(o);
  const originalLabel = btn.textContent;

  navigator.clipboard.writeText(text).then(function () {
    btn.textContent = "Copied!";
    setTimeout(function () { btn.textContent = originalLabel; }, 1500);
  }).catch(function () {
    // Clipboard API can be blocked (permissions, non-HTTPS context) - fall
    // back to showing the text directly so it's never a dead end.
    alert("Couldn't copy automatically. Here's the text:\n\n" + text);
  });
}

function dateCell(o) {
  return (
    '<div><span style="font-size:12px; color:var(--color-text-muted);">Order</span><br>' + o.orderDate + "</div>" +
    '<div style="margin-top:4px;"><span style="font-size:12px; color:var(--color-text-muted);">Fulfillment</span><br>' + (o.deliveryDate || "") + "</div>"
  );
}

// "{area} - {address}" - shared everywhere this combined display is used
// (Ongoing Orders' customerCell, New Order's readonly Address field). Falls
// back to whichever half is actually present if only one is set.
function areaAddressText(area, address) {
  if (area && address) return area + " - " + address;
  return area || address || "";
}

// showAddress - Ongoing Orders only (per explicit request), appended below
// the Order ID line - History rows don't get it (customerCell(o) with no
// second arg, as historyRowHtml already calls it).
function customerCell(o, showAddress) {
  return (
    o.customerName +
    '<br><span style="color:var(--color-text-muted); font-size:12px;">' + (o.customerContact ? formatPhoneDisplay(o.customerContact) : "") + "</span>" +
    '<br><span style="color:var(--color-text-muted); font-size:12px;">' + o.orderCode + "</span>" +
    // max-width capped so this line (the only structural difference from
    // History's customerCell) can't stretch the column wider than what
    // name/contact/order code alone would need - it just wraps instead,
    // keeping Ongoing's Customer column sized the same as History's per
    // explicit request, without hardcoding either table's column widths.
    (showAddress && areaAddressText(o.customerArea, o.customerAddress)
      ? '<br><span style="display:block; max-width:150px; color:var(--color-text-muted); font-size:12px;">' + areaAddressText(o.customerArea, o.customerAddress) + "</span>"
      : "")
  );
}

function itemsCell(o) {
  return o.items
    .map(function (it) {
      return (
        '<div style="padding:1px 0;">' +
          '<div style="display:flex; justify-content:space-between; gap:8px;">' +
            "<span>" + it.name + "</span>" +
            '<span style="color:var(--color-text-muted); white-space:nowrap;">x' + it.qty + "</span>" +
          "</div>" +
          '<span class="font-number" style="color:var(--color-text-muted); font-size:12px;">' + formatRupiah(it.unitPrice) + "</span>" +
        "</div>"
      );
    })
    .join("");
}

function typeCell(o) {
  let html = o.orderType;
  if (o.orderType === "Delivery") {
    html += '<br><span style="font-size:12px; color:var(--color-text-muted);">Fee<br><span class="font-number">' + formatRupiah(o.deliveryFee) + "</span></span>";
  }
  return html;
}

function renderOrdersTable(wrap, orders, scope) {
  orders.forEach((o) => { _ordersByCode[o.orderCode] = o; });

  const title = scope === "history" ? "Order History" : "Ongoing Orders";
  // New Order always creates an Ongoing order, so the button lives next to
  // that subsection's own title (not the tab strip above it) - matches
  // where it's actually relevant, same reasoning as Sales' "+ Input Sales"
  // sitting on the Log section instead of the page header.
  const titleRow =
    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      "<h3>" + title + "</h3>" +
      (scope === "ongoing" && _ordersShowNewOrderBtn
        ? '<div style="display:flex; gap:10px;">' +
            '<button onclick="copyBlankOrderFormTemplate(this)">Copy Template Form</button>' +
            '<button class="btn-primary" onclick="openOrderModal()">+ New Order</button>' +
          "</div>"
        : "") +
      (scope === "history"
        ? '<div style="display:flex; align-items:center; gap:10px;">' +
            '<span style="color:var(--color-text-muted); font-size:12px;">' + ordersHistoryFilterBadgeText() + "</span>" +
            '<button onclick="openOrdersHistoryFilterModal()">Filter</button>' +
          "</div>"
        : "") +
    "</div>";

  if (!orders.length) {
    wrap.innerHTML = titleRow + "<p>No orders here.</p>";
    return;
  }

  // Platform Orders (GrabFood/GoFood) has its own column set - Type/Payment
  // are meaningless (always Takeaway/already-Paid via the platform), and
  // there's platform-only data (order number, PIN, per-item notes, service
  // fee breakdown) the Online layout has no room or need for - see
  // platformOngoingRowHtml/platformHistoryRowHtml above.
  const rows = _ordersIsPlatformMode
    ? orders.map(scope === "history" ? platformHistoryRowHtml : platformOngoingRowHtml).join("")
    : orders.map(scope === "history" ? historyRowHtml : ongoingRowHtml).join("");

  // Reverted the fixed-width colgroup experiment on both Online tables -
  // back to plain auto-layout (content-driven sizing) for all columns, per
  // explicit correction. The Status merge/Total rename/Notes-Order Status
  // swap (in `head` below and their row builders) are unrelated content/
  // order changes, not sizing, and stay.
  const head = _ordersIsPlatformMode
    ? (scope === "history"
        ? "<tr><th>Date</th><th>Customer</th><th>Items</th><th>Total Price</th><th>Order Status</th><th>Notes</th></tr>"
        : "<tr><th>Date</th><th>Customer</th><th>Items</th><th>Total Price</th><th>Status</th><th>Notes</th><th></th></tr>")
    : (scope === "history"
        ? "<tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Fulfillment Type</th><th>Order Status</th><th>Notes</th></tr>"
        : "<tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Type</th><th>Status</th><th>Notes</th><th></th></tr>");

  // Two separate <table> elements can never auto-sync column widths with
  // each other - auto-layout only ever considers rows within its OWN
  // table, there's no cross-table mechanism for it. Matching pixel widths
  // on just these 4 columns (Date/Customer/Items/Total) is the only way to
  // actually guarantee Ongoing and History line up, per explicit request -
  // the <col>s for each table's OWN remaining columns (Type/Status/Notes/
  // Actions, or Fulfillment Type/Order Status/Notes) are left unspecified,
  // so table-layout:fixed still lets them share whatever space is left
  // rather than being pinned to arbitrary numbers too.
  const isOnline = !_ordersIsPlatformMode;
  const ONLINE_SHARED_COLS = '<col style="width:120px;"><col style="width:220px;"><col style="width:280px;"><col style="width:120px;">'; // Date, Customer, Items, Total
  const colgroup = isOnline
    ? "<colgroup>" + ONLINE_SHARED_COLS + (scope === "ongoing" ? "<col><col><col><col>" : "<col><col><col>") + "</colgroup>"
    : "";
  const tableStyle = isOnline ? ' style="table-layout:fixed; width:auto;"' : "";

  // IDs suffixed by scope - Ongoing and History now render into separate
  // containers on the same page at once (not tab-swapped), so they can't
  // share element ids without one section's pagination/scroll silently
  // grabbing the other's DOM nodes (same fix as pages/menu.js's Batch
  // Production merge).
  const paginationId = "ordersPaginationNav-" + scope;
  const scrollWrapId = "ordersScrollWrap-" + scope;
  const tbodyId = "ordersTbody-" + scope;

  wrap.innerHTML =
    titleRow +
    '<div id="' + paginationId + '" class="pagination-nav"></div>' +
    '<div id="' + scrollWrapId + '" style="overflow-x:auto;">' +
      "<table" + tableStyle + ">" + colgroup + "<thead>" + head + "</thead>" +
      '<tbody id="' + tbodyId + '">' + rows + "</tbody></table>" +
    "</div>";

  paginateTable(tbodyId, paginationId, 20);
  enableDragScroll(document.getElementById(scrollWrapId));
}

// Dine-In is a placeholder for now, deferred until the user builds it out
// ("nanti kalau ada dine in tinggal ditambahin page baru lagi") - just the
// nav entry + Coming Soon so the final 3-way Platform/Online/Dine-In split
// is visible now, no backend/data model yet.
registerPage("orders-dinein", renderDineInPage);

function renderDineInPage(content) {
  content.innerHTML = "<h2>Dine-In</h2><p>Coming soon.</p>";
}

// ================================================================
// Driver Payout - its own top-level page/nav entry now (was a 3rd tab on
// Orders) - Unpaid Payout (bulk Mark Paid) + Payout History (per-row Edit),
// ported from 05 Orders/DriverPayoutTable.html + DriverPayoutTable_JS.html.
// Not paginated (same as the old app - this list is small, a handful to a
// few dozen delivery orders at a time). Sourced from every Delivery order
// regardless of Ongoing/History status (a payout can still be owed on an
// order that's otherwise done, or vice versa), split by driver_payout_status.
// ================================================================

registerPage("orders-payout", renderDriverPayoutPage);

async function renderDriverPayoutPage(content) {
  await ensureOrdersLookups();
  content.innerHTML = "<h2>Driver Payout</h2>" + '<div id="driverPayoutWrap"><p>Loading...</p></div>';
  await loadDriverPayoutData();
}

async function loadDriverPayoutData() {
  const wrap = document.getElementById("driverPayoutWrap");
  if (!wrap) return;

  const [ongoing, history] = await Promise.all([api("orders?scope=ongoing"), api("orders?scope=history")]);
  if (!document.getElementById("driverPayoutWrap")) return;
  renderDriverPayoutSections(wrap, ongoing.concat(history));
}

let _driverPayoutOrdersByCode = {};

function driverStaffOptions() {
  return _ordersLookups.staff.filter((s) => Array.isArray(s.roles) && s.roles.indexOf("Driver") !== -1);
}

// Value is either a staff id or (for a driver not in the Driver-role list -
// e.g. GrabExpress, or role changed since) the raw name - same dual scheme
// as resolveDriver() uses for the New Order form's driver combo, so it
// round-trips through the same PATCH fields.
function driverSelectOptionsHtml(o) {
  const drivers = driverStaffOptions();
  const currentValue = o.driverStaffId || o.driverNameRaw || "";
  const alreadyListed = drivers.some((d) => d.id === currentValue);

  let html = '<option value="">-- Select driver --</option>';
  drivers.forEach((d) => {
    html += '<option value="' + d.id + '"' + (d.id === currentValue ? " selected" : "") + ">" + d.name + "</option>";
  });
  if (currentValue && !alreadyListed) {
    html += '<option value="' + currentValue + '" selected>' + (o.driverName || currentValue) + " (not in Staff list)</option>";
  }
  return html;
}

function methodSelectOptionsHtml(current) {
  let html = '<option value="">-</option>';
  _ordersLookups.paymentMethods.forEach((m) => {
    html += "<option" + (m === current ? " selected" : "") + ">" + m + "</option>";
  });
  return html;
}

function renderDriverPayoutSections(wrap, orders) {
  // deliveryFee > 0 only - a Rp0 fee (free ongkir) has nothing to pay a
  // driver for, so it's not a Driver Payout concern at all regardless of
  // paid/unpaid status, per explicit request.
  const deliveryOrders = orders.filter((o) => o.orderType === "Delivery" && o.deliveryFee > 0);
  _driverPayoutOrdersByCode = {};
  deliveryOrders.forEach((o) => { _driverPayoutOrdersByCode[o.orderCode] = o; });

  const unpaid = deliveryOrders.filter((o) => o.driverPayoutStatus !== "Paid");
  const paid = deliveryOrders.filter((o) => o.driverPayoutStatus === "Paid");

  wrap.innerHTML =
    "<h3>Unpaid Payout</h3>" +
    buildUnpaidPayoutTableShellHtml(unpaid) +
    '<h3 style="margin-top:28px;">Payout History</h3>' +
    buildPayoutHistoryTableHtml(paid);

  // Same helper as the Purchase Log (inventory.js) - keeps each driver's
  // group of rows intact across page breaks instead of slicing blindly.
  if (unpaid.length) paginateGroupedTable("unpaidPayoutTbody", "unpaidPayoutPaginationNav", 20);
  enableDragScroll(document.getElementById("payoutHistoryScrollWrap"));
}

// ---------- Unpaid Payout (single table, grouped by Driver) ----------

// Groups purely from the Unpaid data itself (distinct driverStaffId/
// driverNameRaw among currently-unpaid Delivery orders) - not looped from
// the Staff master list, so a driver with zero unpaid orders never shows
// up as an empty group. Orders with no driver at all fall into their own
// "Unassigned" bucket (still a real, data-derived group - just one with a
// null key), which has no Mark Paid control since there's no one to pay.
const UNASSIGNED_DRIVER_KEY = "__unassigned__";

function groupUnpaidByDriver(rows) {
  const byKey = {};
  rows.forEach((o) => {
    const key = o.driverStaffId || o.driverNameRaw || UNASSIGNED_DRIVER_KEY;
    if (!byKey[key]) {
      byKey[key] = { key: key, label: key === UNASSIGNED_DRIVER_KEY ? "Unassigned" : (o.driverName || key), orders: [] };
    }
    byKey[key].orders.push(o);
  });

  const groups = Object.values(byKey);
  groups.sort((a, b) => {
    if (a.key === UNASSIGNED_DRIVER_KEY) return 1;
    if (b.key === UNASSIGNED_DRIVER_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

// Every order currently unpaid and belonging to one driver group - shared
// by the group header (for its Total/Mark Paid) and the Mark Paid modal
// (so it re-checks live data at confirm time, not a stale snapshot).
function ordersInUnpaidGroup(groupKey) {
  return Object.values(_driverPayoutOrdersByCode).filter((o) =>
    o.orderType === "Delivery" &&
    o.driverPayoutStatus !== "Paid" &&
    (o.driverStaffId || o.driverNameRaw || UNASSIGNED_DRIVER_KEY) === groupKey
  );
}

function buildUnpaidPayoutTableShellHtml(rows) {
  if (!rows.length) return "<p>No unpaid delivery fees.</p>";
  const body = groupUnpaidByDriver(rows).map(unpaidDriverGroupRowsHtml).join("");
  return (
    '<div id="unpaidPayoutPaginationNav" class="pagination-nav"></div>' +
    "<table>" +
      "<thead><tr><th>Order Date</th><th>Customer</th><th>Delivery Fee</th><th>Order ID</th><th></th></tr></thead>" +
      '<tbody id="unpaidPayoutTbody">' + body + "</tbody>" +
    "</table>"
  );
}

// One full-width header row per driver group (name / total / Mark Paid),
// followed by that driver's order rows. The header row carries
// "group-start" so paginateGroupedTable never splits a group mid-page.
function unpaidDriverGroupRowsHtml(group) {
  const total = group.orders.reduce((sum, o) => sum + o.deliveryFee, 0);
  const isUnassigned = group.key === UNASSIGNED_DRIVER_KEY;
  const markPaidBtn = isUnassigned
    ? '<span style="color:var(--color-text-muted); font-size:12px;">Assign a driver (Edit) to enable Mark Paid</span>'
    : '<button onclick="openMarkGroupPaidModal(\'' + group.key + '\')">Mark Paid</button>';

  const header =
    '<tr class="group-start driver-group-row">' +
      '<td colspan="5" style="background:var(--color-disabled-bg);">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          "<strong>" + group.label + "</strong>" +
          '<div style="display:flex; align-items:center; gap:12px;">' +
            '<strong>Total: <span class="font-number">' + formatRupiah(total) + "</span></strong>" +
            markPaidBtn +
          "</div>" +
        "</div>" +
      "</td>" +
    "</tr>";

  return header + group.orders.map(unpaidPayoutRowHtml).join("");
}

function unpaidPayoutRowHtml(o) {
  return (
    "<tr>" +
      "<td>" + o.orderDate + "</td>" +
      "<td>" + o.customerName + "</td>" +
      '<td><span class="font-number">' + formatRupiah(o.deliveryFee) + "</span></td>" +
      "<td>" + o.orderCode + "</td>" +
      '<td class="compact-cell"><button class="btn-compact" onclick="openPayoutEditModal(\'' + o.orderCode + '\')">Edit</button></td>' +
    "</tr>"
  );
}

// Per-transaction Edit modal - only Delivery Fee and Driver (Method is now
// chosen once per group at Mark Paid time, not per order). Saving re-loads
// the whole tab, so the order re-groups under its new driver automatically
// (and the old group just disappears on its own if that was its last order
// - grouping is recomputed fresh from the data every render, never
// tracked/mutated in place).
function openPayoutEditModal(orderCode) {
  const order = _driverPayoutOrdersByCode[orderCode];
  openModal(
    "<h2>Edit Payout - " + orderCode + "</h2>" +
    "<label>Delivery Fee</label><br>" +
    '<input type="text" id="editPayoutFee" inputmode="numeric" value="' + formatRupiah(order.deliveryFee) + '" oninput="formatAmount(this)"><br><br>' +
    "<label>Driver</label><br>" +
    '<select id="editPayoutDriver">' + driverSelectOptionsHtml(order) + "</select><br><br>" +
    '<button id="savePayoutEditBtn" class="btn-primary" onclick="savePayoutEditModal(\'' + orderCode + '\')">Save</button>' +
    '<span id="savePayoutEditStatus" class="save-status"></span>'
  );
}

function savePayoutEditModal(orderCode) {
  const fee = parseAmount(document.getElementById("editPayoutFee").value);
  const driverValue = document.getElementById("editPayoutDriver").value;

  if (!driverValue) { alert("Please select a driver."); return; }

  const driver = resolveDriver(driverValue);
  const btn = document.getElementById("savePayoutEditBtn");
  const statusEl = document.getElementById("savePayoutEditStatus");

  withSaveStatus(btn, statusEl, "Payout", async function () {
    await api("orders/" + encodeURIComponent(orderCode), {
      method: "PATCH",
      body: { deliveryFee: fee, driverStaffId: driver.driverStaffId, driverNameRaw: driver.driverNameRaw }
    });
    closeModal();
    await loadDriverPayoutData();
  });
}

// Mark Paid opens a modal (Payout Method + Confirm) rather than acting
// immediately, since Method now applies to the whole group at once and
// needs picking every time (unlike the old per-row select that stayed on
// screen). Re-reads ordersInUnpaidGroup() fresh at open and at confirm time
// so it always reflects whatever's currently in the group.
//
// No Payment Date field - the linked OpEx entry is accrual-based (see
// functions/api/_lib/opex.js's resyncDriverPayoutOpexGroup) and was already
// created/dated when these orders became Completed, not when this button
// gets clicked, so there was nothing left for that field to drive.
function openMarkGroupPaidModal(groupKey) {
  const orders = ordersInUnpaidGroup(groupKey);
  if (!orders.length) return;

  const driverLabel = orders[0].driverName || groupKey;
  const total = orders.reduce((sum, o) => sum + o.deliveryFee, 0);

  openModal(
    "<h2>Mark Paid - " + driverLabel + "</h2>" +
    '<p>' + orders.length + ' order(s), total <span class="font-number">' + formatRupiah(total) + "</span></p>" +
    "<label>Payout Method</label><br>" +
    '<select id="markPaidMethod">' + methodSelectOptionsHtml(null) + "</select><br><br>" +
    '<button id="markPaidConfirmBtn" onclick="confirmMarkGroupPaid(\'' + groupKey + '\')">Confirm</button>' +
    '<span id="markPaidStatus" class="save-status"></span>'
  );
}

// Marks driver_payout_status Paid for every order in this group - purely a
// cash-tracking action now. The Driver Payout OpEx entry itself (one per
// driver+month, see functions/api/_lib/opex.js's resyncDriverPayoutOpexGroup)
// is accrual-based and was already created/updated when these orders became
// Completed, not here - this endpoint doesn't touch opex_entries at all.
function confirmMarkGroupPaid(groupKey) {
  const orders = ordersInUnpaidGroup(groupKey);
  if (!orders.length) { closeModal(); return; }

  const methodSelect = document.getElementById("markPaidMethod");
  const method = methodSelect && methodSelect.value ? methodSelect.value : null;

  const btn = document.getElementById("markPaidConfirmBtn");
  const statusEl = document.getElementById("markPaidStatus");

  withSaveStatus(btn, statusEl, "Payout", async function () {
    await api("driver-payout/mark-paid", {
      method: "POST",
      body: { orderCodes: orders.map((o) => o.orderCode), method: method }
    });
    closeModal();
    await loadDriverPayoutData();
  });
}

// ---------- Payout History ----------

function buildPayoutHistoryTableHtml(rows) {
  const body = rows.length ? rows.map(payoutHistoryRowHtml).join("") : '<tr><td colspan="8">No paid driver fees yet.</td></tr>';
  return (
    '<div style="overflow-x:auto;" id="payoutHistoryScrollWrap">' +
      "<table>" +
        "<thead><tr><th>Order Date</th><th>Customer</th><th>Delivery Fee</th><th>Driver</th><th>Method</th><th>Status</th><th>Order ID</th><th></th></tr></thead>" +
        "<tbody>" + body + "</tbody>" +
      "</table>" +
    "</div>"
  );
}

function payoutHistoryRowHtml(o) {
  return (
    '<tr data-order="' + o.orderCode + '">' +
      "<td>" + o.orderDate + "</td>" +
      "<td>" + o.customerName + "</td>" +
      "<td>" +
        '<span class="payoutFeeDisplay font-number">' + formatRupiah(o.deliveryFee) + "</span>" +
        '<input type="text" class="payoutFeeInput" value="' + o.deliveryFee + '" inputmode="numeric" style="display:none;" oninput="formatAmount(this)">' +
      "</td>" +
      "<td>" +
        '<span class="payoutDriverDisplay">' + (o.driverName || "") + "</span>" +
        '<select class="payoutDriverSelect" style="display:none;">' + driverSelectOptionsHtml(o) + "</select>" +
      "</td>" +
      "<td>" +
        '<span class="payoutMethodDisplay">' + (o.driverPayoutMethod || "") + "</span>" +
        '<select class="payoutMethodSelect" style="display:none;">' + methodSelectOptionsHtml(o.driverPayoutMethod) + "</select>" +
      "</td>" +
      "<td>" +
        '<span class="payoutStatusDisplay">Paid</span>' +
        '<select class="payoutStatusSelect" style="display:none;"><option>Paid</option><option>Unpaid</option></select>' +
      "</td>" +
      "<td>" + o.orderCode + "</td>" +
      "<td>" +
        '<button class="payoutEditBtn btn-compact" onclick="startEditPayout(this)">Edit</button>' +
        '<button class="payoutSaveBtn btn-compact btn-primary" onclick="savePayoutEdit(this)" style="display:none;">Save</button> ' +
        '<button class="payoutCancelBtn btn-compact" onclick="cancelEditPayout()" style="display:none;">Cancel</button>' +
      "</td>" +
    "</tr>"
  );
}

function startEditPayout(btn) {
  const row = btn.closest("tr");
  row.querySelectorAll(".payoutFeeDisplay, .payoutDriverDisplay, .payoutMethodDisplay, .payoutStatusDisplay").forEach((el) => { el.style.display = "none"; });
  row.querySelectorAll(".payoutFeeInput, .payoutDriverSelect, .payoutMethodSelect, .payoutStatusSelect").forEach((el) => { el.style.display = ""; });
  row.querySelector(".payoutEditBtn").style.display = "none";
  row.querySelector(".payoutSaveBtn").style.display = "";
  row.querySelector(".payoutCancelBtn").style.display = "";
  formatAmount(row.querySelector(".payoutFeeInput"));
}

// Simplest correct "discard changes" - reload the tab fresh rather than
// manually restoring every cell's original display state.
function cancelEditPayout() {
  loadDriverPayoutData();
}

// Status here is Paid/Unpaid, backed by the same driver_payout_status
// column Unpaid Payout/Mark Paid use ("Unpaid" -> null, matching how the
// rest of the app represents not-yet-paid - there's no literal "Unpaid"
// value in the data, just an unset status). Saving as Unpaid moves the row
// back out of Payout History into Unpaid Payout on the next load, since
// both sections are just a driverPayoutStatus filter over the same list.
function savePayoutEdit(btn) {
  const row = btn.closest("tr");
  const orderCode = row.dataset.order;
  const order = _driverPayoutOrdersByCode[orderCode];
  const fee = parseAmount(row.querySelector(".payoutFeeInput").value);
  const driverValue = row.querySelector(".payoutDriverSelect").value;
  const method = row.querySelector(".payoutMethodSelect").value;
  const status = row.querySelector(".payoutStatusSelect").value;

  if (!driverValue) { alert("Please select a driver."); return; }

  const driver = resolveDriver(driverValue);

  // The linked OpEx entry is shared with every other order in this driver's
  // group for the same month now, so this can no longer just PATCH/DELETE
  // "its own" entry directly (see functions/api/driver-payout/[code].js) -
  // the server updates the order then fully resyncs the old driver+month
  // group (if driver/fee changed enough to matter) and the new one.
  withInlineSaveStatus(btn, "Payout", async function () {
    await api("driver-payout/" + encodeURIComponent(orderCode), {
      method: "PATCH",
      body: {
        deliveryFee: fee,
        driverStaffId: driver.driverStaffId,
        driverNameRaw: driver.driverNameRaw,
        driverPayoutMethod: method || null,
        driverPayoutStatus: status === "Paid" ? "Paid" : null
      }
    });
    await loadDriverPayoutData();
  });
}

// Shared by ongoingRowHtml and platformOngoingRowHtml - Mark Paid/Mark
// Delivered-or-PickedUp/Cancel Order all key off generic order fields, no
// platform-specific logic needed (a GoFood order's paymentStatus is already
// "Paid" at creation, so Mark Paid just never renders for it, same effect
// achieved for free).
function orderActionsHtml(o) {
  const fulfillmentDone = o.fulfillmentStatus !== "Pending";
  return (
    // Fixed width (not text-align - text stays centered) so this whole
    // button stack (with Copy Form above it) reads as one uniform column
    // instead of each button sizing to its own label's length.
    (o.paymentStatus !== "Paid" ? '<button style="font-size:12px; width:130px;" onclick="startMarkOrderPaid(\'' + o.orderCode + '\')">Mark Paid</button><br>' : "") +
    (!fulfillmentDone ? '<button style="font-size:12px; width:130px;" onclick="markOrderDeliveryStatus(this, \'' + o.orderCode + '\', \'' + o.orderType + '\')">' + (o.orderType === "Takeaway" ? "Mark Picked Up" : "Mark Delivered") + "</button><br>" : "") +
    // Extra top margin so Cancel sits visibly apart from Mark Paid/Mark
    // Delivered above it - those two get used often, Cancel rarely, so a
    // slip of the mouse shouldn't land on it. Label spelled out
    // ("Cancel Order") since a bare "Cancel" reads as "cancel this action".
    '<button style="font-size:12px; width:130px; margin-top:10px;" onclick="markOrderCancelled(\'' + o.orderCode + '\')">Cancel Order</button>'
  );
}

function ongoingRowHtml(o) {
  const fulfillmentDone = o.fulfillmentStatus !== "Pending";
  const statusHtml = fulfillmentDone
    ? o.fulfillmentStatus + (o.driverName ? "<br><span style=\"font-size:12px; color:var(--color-text-muted);\">by " + o.driverName + "</span>" : "")
    : "";

  const paymentHtml = o.paymentStatus + (o.paymentStatus === "Paid" && o.paymentMethod ? '<br><span style="font-size:12px; color:var(--color-text-muted);">' + o.paymentMethod + "</span>" : "");

  // Merged Payment+Status into one Status column - payment on top, order/
  // fulfillment status below it, separated by a small gap - per explicit
  // request.
  const combinedStatusHtml = paymentHtml + (statusHtml ? '<div style="margin-top:6px;">' + statusHtml + "</div>" : "");

  // Copy Form/Edit Order - Online Orders only, not shared via
  // orderActionsHtml so they never show up on Platform Orders' ongoing rows
  // (GoFood customers ordered through the app, not WA, and their order
  // details aren't ours to edit). Extra bottom margin after Edit Order
  // separates this pair from the Mark Paid/etc buttons below.
  const actions =
    '<button style="font-size:12px; width:130px;" onclick="copyOrderFormText(this, \'' + o.orderCode + '\')">Copy Form</button><br>' +
    '<button style="font-size:12px; width:130px; margin-bottom:10px;" onclick="openEditOrderModal(\'' + o.orderCode + '\')">Edit Order</button><br>' +
    orderActionsHtml(o);

  return (
    "<tr>" +
      "<td>" + dateCell(o) + "</td>" +
      "<td>" + customerCell(o, true) + "</td>" +
      "<td>" + itemsCell(o) + "</td>" +
      '<td><span class="font-number">' + formatRupiah(orderTotal(o)) + "</span></td>" +
      "<td>" + typeCell(o) + "</td>" +
      "<td>" + combinedStatusHtml + "</td>" +
      "<td>" + (o.notes || "") + "</td>" +
      '<td class="orderActions" style="text-align:left;" data-order="' + o.orderCode + '">' + actions + "</td>" +
    "</tr>"
  );
}

function historyRowHtml(o) {
  const totalHtml = '<span class="font-number">' + formatRupiah(orderTotal(o)) + "</span>" + (o.paymentMethod ? '<br><span style="font-size:12px; color:var(--color-text-muted);">' + o.paymentMethod + "</span>" : "");
  const statusLabel = o.orderStatus === "Cancelled" ? "Cancelled" : "Completed";
  const statusSub = o.orderStatus !== "Cancelled" && o.fulfillmentStatus !== "Pending"
    ? '<br><span style="font-size:12px; color:var(--color-text-muted);">' + o.fulfillmentStatus + (o.driverName ? " by " + o.driverName : "") + "</span>"
    : "";

  return (
    "<tr>" +
      "<td>" + dateCell(o) + "</td>" +
      "<td>" + customerCell(o) + "</td>" +
      "<td>" + itemsCell(o) + "</td>" +
      "<td>" + totalHtml + "</td>" +
      "<td>" + typeCell(o) + "</td>" +
      "<td>" + statusLabel + statusSub + "</td>" +
      "<td>" + (o.notes || "") + "</td>" +
    "</tr>"
  );
}

// ---------- Platform Orders (GrabFood/GoFood) - dedicated column layout ----------
// Distinct from the Online cell builders above (dateCell/customerCell/
// itemsCell/typeCell) since Type/Payment are meaningless here (always
// Takeaway/already-Paid via the platform) and there's extra platform-only
// data to show instead: platform name + fulfillment method, the platform's
// own order number/PIN, and per-item notes.

// GoFood's own order_total = items subtotal + takeaway/service charge (see
// functions/api/webhooks/gofood.js) - orderTotal(o) (items + deliveryFee)
// doesn't apply here since deliveryFee is always 0 for platform orders.
function platformOrderTotal(o) {
  return o.items.reduce((s, it) => s + it.lineTotal, 0) + o.platformServiceFee;
}

function formatTimeHM(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Friendly labels for the GoFood lifecycle events logged to
// order_status_events (see functions/api/webhooks/gofood.js's
// LIFECYCLE_EVENTS) - shown as a timeline under Status, per explicit
// request ("keterangan jam masuknya order... beserta timenya").
const PLATFORM_EVENT_LABELS = {
  "gofood.order.created": "Order Created",
  "gofood.order.merchant_accepted": "Accepted",
  "gofood.order.driver_otw_pickup": "Driver On The Way",
  "gofood.order.driver_arrived": "Driver Arrived",
  "gofood.order.placed": "Handed to Driver",
  "gofood.order.completed": "Completed",
  "gofood.order.cancelled": "Cancelled"
};

function platformStatusEventsHtml(o) {
  if (!o.statusEvents || !o.statusEvents.length) return "";
  return (
    '<div style="font-size:11px; color:var(--color-text-muted); margin-top:4px;">' +
      o.statusEvents.map((e) => (PLATFORM_EVENT_LABELS[e.event] || e.event) + " " + formatTimeHM(e.occurredAt)).join("<br>") +
    "</div>"
  );
}

function platformDateCell(o) {
  return (
    "<div>" + o.orderDate + "</div>" +
    '<div style="margin-top:4px; font-size:12px; color:var(--color-text-muted);">' + o.platform + "</div>" +
    '<div style="font-size:12px; color:var(--color-text-muted);">' + (o.platformFulfillmentType === "Pickup" ? "Self Pick Up" : "by Driver") + "</div>"
  );
}

function platformCustomerCell(o) {
  return (
    o.customerName +
    '<br><span style="color:var(--color-text-muted); font-size:12px;">' + o.orderCode + "</span>" +
    "<br><strong>" + (o.platformOrderId || "") + "</strong>" +
    (o.platformPin ? "<br><strong>PIN: " + o.platformPin + "</strong>" : "")
  );
}

// Per-item notes (customer's item-level customization request, e.g. "pedas
// dikit") shown to the right of that same item's name/qty line, in orange
// so it stands out from the rest of the row - independent per item, not
// pooled into one block, since two items in the same order can carry
// unrelated notes.
// 3 sub-columns (item+price / qty / notes), each left-aligned and lined up
// across every item via one shared CSS grid - not 3 separate flex rows per
// item, which would let each item's qty/notes drift to a different
// horizontal position depending on how long that item's name happens to be.
function platformItemsCell(o) {
  const cellsHtml = o.items
    .map(function (it) {
      return (
        "<div>" +
          "<div>" + it.name + "</div>" +
          '<span class="font-number" style="color:var(--color-text-muted); font-size:12px;">' + formatRupiah(it.unitPrice) + "</span>" +
        "</div>" +
        '<div style="color:var(--color-text-muted);"><strong>x&nbsp;' + it.qty + "</strong></div>" +
        '<div style="color:#C2703D; font-size:12px;">' + (it.notes || "") + "</div>"
      );
    })
    .join("");
  return '<div style="display:grid; grid-template-columns:1fr auto 1fr; column-gap:10px; row-gap:6px; align-items:start; text-align:left;">' + cellsHtml + "</div>";
}

function platformTotalCell(o) {
  const itemsSubtotal = o.items.reduce((s, it) => s + it.lineTotal, 0);
  return (
    '<span class="font-number" style="font-weight:bold;">' + formatRupiah(platformOrderTotal(o)) + "</span>" +
    '<div style="font-size:11px; color:var(--color-text-muted); margin-top:2px;">' +
      "Items: " + formatRupiah(itemsSubtotal) +
      // GoFood's own "takeaway_charges" field - a merchant-configured
      // packaging fee on pickup-style orders ("Restaurant Takeaway Fee" in
      // GoFood's own consumer-facing terms), NOT delivery/ongkir (GoFood
      // never sends us a delivery fee at all - see functions/api/webhooks/gofood.js).
      // Not guaranteed on every order - depends on the outlet's own portal
      // settings, hence the >0 guard rather than always showing this line.
      (o.platformServiceFee > 0 ? "<br>Takeaway Fee: " + formatRupiah(o.platformServiceFee) : "") +
      // Raw capture only for now (functions/api/webhooks/gofood.js) - no
      // real promo'd order has been seen yet to know the field shape well
      // enough to break down the discount amount here.
      (o.platformPromotions ? "<br>🏷️ Promo Applied" : "") +
    "</div>"
  );
}

function platformOngoingRowHtml(o) {
  const fulfillmentDone = o.fulfillmentStatus !== "Pending";
  const statusHtml = (fulfillmentDone ? o.fulfillmentStatus : "Preparing") + platformStatusEventsHtml(o);

  return (
    "<tr>" +
      "<td>" + platformDateCell(o) + "</td>" +
      "<td>" + platformCustomerCell(o) + "</td>" +
      "<td style=\"min-width:280px;\">" + platformItemsCell(o) + "</td>" +
      "<td>" + platformTotalCell(o) + "</td>" +
      "<td>" + statusHtml + "</td>" +
      "<td>" + (o.notes || "") + "</td>" +
      '<td class="orderActions" style="text-align:left;" data-order="' + o.orderCode + '">' + orderActionsHtml(o) + "</td>" +
    "</tr>"
  );
}

function platformHistoryRowHtml(o) {
  const statusLabel = o.orderStatus === "Cancelled" ? "Cancelled" : "Completed";
  const statusSub = o.orderStatus !== "Cancelled" && o.fulfillmentStatus !== "Pending"
    ? '<br><span style="font-size:12px; color:var(--color-text-muted);">' + o.fulfillmentStatus + "</span>"
    : "";

  return (
    "<tr>" +
      "<td>" + platformDateCell(o) + "</td>" +
      "<td>" + platformCustomerCell(o) + "</td>" +
      "<td style=\"min-width:280px;\">" + platformItemsCell(o) + "</td>" +
      "<td>" + platformTotalCell(o) + "</td>" +
      "<td>" + statusLabel + statusSub + platformStatusEventsHtml(o) + "</td>" +
      "<td>" + (o.notes || "") + "</td>" +
    "</tr>"
  );
}

// ---------- Ongoing row actions (Mark Paid / Mark Delivered / Cancel) ----------
// Ported from OngoingOrdersTable_JS.html. Note: the old app also reversed
// stock consumption and removed a Driver Payout row on Cancel - neither has
// an equivalent here (our schema doesn't tie ingredient stock to orders;
// driver payout is just a couple of columns on the order itself), so Cancel
// here is just the order_status flip.
// Modal, same pattern as Driver Payout's Mark Paid (openPayoutEditModal /
// openMarkGroupPaidModal) - a dropdown pick-then-Confirm in an overlay
// instead of swapping the row's action cell in place. Order details are
// read-only context (from _ordersByCode, populated on every table render)
// so whoever's confirming payment can double-check they've got the right
// order without leaving the modal.
function startMarkOrderPaid(orderCode) {
  const o = _ordersByCode[orderCode];
  const summary = o
    ? (
        "<p><strong>Customer:</strong> " + o.customerName + (o.customerContact ? " (" + formatPhoneDisplay(o.customerContact) + ")" : "") + "</p>" +
        "<div>" + itemsCell(o) + "</div>" +
        (o.orderType === "Delivery" && o.deliveryFee > 0 ? '<p><strong>Delivery Fee:</strong> <span class="font-number">' + formatRupiah(o.deliveryFee) + "</span></p>" : "") +
        '<p><strong>Total Price:</strong> <span class="font-number">' + formatRupiah(orderTotal(o)) + "</span></p>"
      )
    : "";

  openModal(
    "<h2>Mark Paid - " + orderCode + "</h2>" +
    summary +
    "<label>Payment Method</label><br>" +
    '<select id="markOrderPaidMethod">' + methodSelectOptionsHtml(null) + "</select><br><br>" +
    '<button id="markOrderPaidConfirmBtn" onclick="confirmMarkOrderPaid(\'' + orderCode + '\')">Confirm</button>' +
    '<span id="markOrderPaidStatus" class="save-status"></span>'
  );
}

function confirmMarkOrderPaid(orderCode) {
  const method = document.getElementById("markOrderPaidMethod").value;
  if (!method) { alert("Please select a payment method."); return; }

  const btn = document.getElementById("markOrderPaidConfirmBtn");
  const statusEl = document.getElementById("markOrderPaidStatus");

  withSaveStatus(btn, statusEl, "Payment", async function () {
    await api("orders/" + encodeURIComponent(orderCode), { method: "PATCH", body: { paymentStatus: "Paid", paymentMethod: method } });
    closeModal();
    await loadOrdersData();
  });
}

// Takeaway (Picked Up) needs no driver - the customer collects it
// themselves - so that path stays a plain confirm(). Delivery orders open a
// modal to confirm/pick the driver instead, since it's now optional at New
// Order creation time (may not be decided yet, or may change by the time
// the order actually goes out) - this is the point it needs to be locked in.
function markOrderDeliveryStatus(btn, orderCode, orderType) {
  if (orderType === "Takeaway") {
    if (!confirm("Mark this order as Picked Up?")) return;
    withInlineSaveStatus(btn, "Status", async function () {
      await api("orders/" + encodeURIComponent(orderCode), { method: "PATCH", body: { fulfillmentStatus: "Picked Up" } });
      await loadOrdersData();
    });
    return;
  }
  openMarkDeliveredModal(orderCode);
}

function openMarkDeliveredModal(orderCode) {
  const o = _ordersByCode[orderCode];
  if (!o) return;

  openModal(
    "<h2>Mark Delivered - " + orderCode + "</h2>" +
    "<p><strong>Customer:</strong> " + o.customerName + "</p>" +
    "<label>Driver</label><br>" +
    '<select id="markDeliveredDriver">' + driverSelectOptionsHtml(o) + "</select><br><br>" +
    '<button id="markDeliveredConfirmBtn" onclick="confirmMarkDelivered(\'' + orderCode + '\')">Confirm</button>' +
    '<span id="markDeliveredStatus" class="save-status"></span>'
  );
}

function confirmMarkDelivered(orderCode) {
  const driverValue = document.getElementById("markDeliveredDriver").value;
  if (!driverValue) { alert("Please select a driver."); return; }

  const driver = resolveDriver(driverValue);
  const btn = document.getElementById("markDeliveredConfirmBtn");
  const statusEl = document.getElementById("markDeliveredStatus");

  withSaveStatus(btn, statusEl, "Status", async function () {
    await api("orders/" + encodeURIComponent(orderCode), {
      method: "PATCH",
      body: { fulfillmentStatus: "Delivered", driverStaffId: driver.driverStaffId, driverNameRaw: driver.driverNameRaw }
    });
    closeModal();
    await loadOrdersData();
  });
}

function markOrderCancelled(orderCode) {
  if (!confirm("Mark this order as Cancelled?")) return;
  api("orders/" + encodeURIComponent(orderCode), { method: "PATCH", body: { orderStatus: "Cancelled" } })
    .then(() => loadOrdersData())
    .catch((err) => alert(err.message));
}
