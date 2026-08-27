// Shared client-side helpers, ported from the old Apps Script app's
// 99 Shared/Layout/Layout_JS.html + 00 Core/Utils.gs. Same behavior; the
// only real change is withSaveStatus now wraps a fetch()-returning function
// instead of google.script.run.

// ---------- General settings (Currency Symbol / Phone Country Code /
// Timezone) ----------
//
// Loaded once at app bootstrap (see index.html - awaited before the first
// renderCurrentPage()) and cached here so formatRupiah/formatAmount/
// formatPhoneDisplay/todayISO actually reflect what's configured in
// Settings > General, instead of being permanently hardcoded regardless of
// what's saved there. Defaults below match this brand's actual current
// settings values, so a failed/slow fetch degrades to today's behavior,
// not broken formatting.
let _generalSettings = { currencySymbol: "Rp", phoneCountryCode: "62", timezone: "Asia/Makassar" };

async function ensureGeneralSettings() {
  try {
    const data = await api("settings");
    const byKey = {};
    data.general.forEach((g) => { byKey[g.key] = g.value; });
    if (byKey["Currency Symbol"]) _generalSettings.currencySymbol = byKey["Currency Symbol"];
    if (byKey["Phone Country Code"]) _generalSettings.phoneCountryCode = byKey["Phone Country Code"];
    if (byKey["Timezone"]) _generalSettings.timezone = byKey["Timezone"];
  } catch (err) {
    // Keep the defaults above - a failed settings fetch shouldn't block the app from loading.
  }
}

// ---------- Formatting ----------

function formatRupiah(value) {
  const num = Math.round(Number(value) || 0);
  const sign = num < 0 ? "-" : "";
  return sign + _generalSettings.currencySymbol + " " + Math.abs(num).toLocaleString("id-ID");
}

// Ported from the old app's 00 Core/Utils.gs formatPercent() - value is a
// fraction (0.4545), not already x100.
function formatPercent(value) {
  return (Number(value) * 100).toFixed(2) + "%";
}

// Attach to <input inputmode="numeric" oninput="formatAmount(this)">.
// Strips everything but digits, redisplays as "Rp 12.345".
function formatAmount(input) {
  const digits = input.value.replace(/\D/g, "");
  input.value = digits ? _generalSettings.currencySymbol + " " + Number(digits).toLocaleString("id-ID") : "";
}

// Reverse of formatAmount - pull the raw number back out of a formatted field.
function parseAmount(value) {
  return Number(String(value || "").replace(/\D/g, "")) || 0;
}

// Raw phone digits -> "0812-3456-7890" display. First 4 digits, then the
// remainder split evenly (even -> 2 equal halves; odd divisible by 3 ->
// groups of 3; other odd -> floor/ceil halves). countryCode defaults to 62.
function formatPhoneDisplay(raw, countryCode) {
  countryCode = countryCode || _generalSettings.phoneCountryCode;
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf(countryCode) === 0) digits = "0" + digits.slice(countryCode.length);
  else if (digits.indexOf("0") !== 0) digits = "0" + digits;

  const groups = [digits.slice(0, 4)];
  const rest = digits.slice(4);
  const r = rest.length;

  if (r > 0) {
    if (r % 2 === 0) {
      const half = r / 2;
      groups.push(rest.slice(0, half), rest.slice(half));
    } else if (r % 3 === 0) {
      for (let i = 0; i < r; i += 3) groups.push(rest.slice(i, i + 3));
    } else {
      const floor = Math.floor(r / 2);
      groups.push(rest.slice(0, floor), rest.slice(floor));
    }
  }

  return groups.join("-");
}

// "Today" in the configured Timezone setting (not the browser's local
// zone) - matches the old app's TIMEZONE-based date formatting. en-CA
// formats as YYYY-MM-DD directly, no manual parsing needed.
function todayISO() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: _generalSettings.timezone }).format(new Date());
  } catch (err) {
    // Unset/invalid timezone string - fall back to the browser's local date.
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }
}

// ---------- Save status ("Saving X..." -> "X saved.") ----------
//
// btn, statusEl: the Save button and the <span class="save-status"> next to it.
// label: name for the message, e.g. "Order" -> "Saving Order..." / "Order saved.".
// asyncFn: function() returning a Promise. Resolve -> success message,
//   reject -> alert(err.message) (same UX as the old app's fail handler).
function withSaveStatus(btn, statusEl, label, asyncFn) {
  btn.disabled = true;
  statusEl.classList.remove("success", "error");
  statusEl.textContent = "Saving " + label + "...";

  asyncFn()
    .then(function (result) {
      btn.disabled = false;
      statusEl.classList.add("success");
      statusEl.textContent = label + " saved.";
      return result;
    })
    .catch(function (err) {
      btn.disabled = false;
      statusEl.classList.add("error");
      statusEl.textContent = "";
      alert(err.message || String(err));
    });
}

// Same, but for a Save button rendered dynamically (e.g. inline table-row
// edit) with no fixed <span> in the HTML - creates/reuses one right after it.
function withInlineSaveStatus(btn, label, asyncFn) {
  let statusEl = btn.nextElementSibling;
  if (!statusEl || !statusEl.classList.contains("save-status")) {
    statusEl = document.createElement("span");
    statusEl.className = "save-status";
    btn.after(statusEl);
  }
  withSaveStatus(btn, statusEl, label, asyncFn);
}

// Thin wrapper around fetch() for our own /api/* endpoints - JSON in, JSON
// out, throws on non-2xx so it plugs straight into withSaveStatus's .catch().
async function api(path, options) {
  options = options || {};
  const opts = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" }
  };
  if (options.body !== undefined) opts.body = JSON.stringify(options.body);

  const res = await fetch("/api/" + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body is fine */ }

  if (!res.ok) {
    throw new Error((data && data.error) || ("Request failed (" + res.status + ")"));
  }
  return data;
}

// ---------- Combobox ----------
//
// Custom dropdown replacing <select>/<datalist> for item/customer/supplier
// pickers - lets the SKU show small & faded next to the name, which plain
// <option> can't style.
//
// container: empty element to use as the combobox wrapper.
// items: [{ value, label, sub }] - value is returned via getValue()/onSelect,
//        label = main text (name), sub = small faded text (e.g. SKU).
// opts:
//   placeholder    - placeholder text before anything is selected
//   allowFreeText  - false (default): pure dropdown, can't type arbitrary
//                    text; click opens a panel with all options + a small
//                    search box inside to filter long lists.
//                    true: field is a real <input> - can type a value not
//                    in the list (e.g. a non-registry code).
//   commitValue    - true: after picking, the displayed text = `value`
//                    (not `label`). Use when the field represents the code
//                    itself rather than a name.
//   onSelect(value, item) - called when the user picks an option.
function createCombobox(container, items, opts) {
  opts = opts || {};
  const allowFreeText = !!opts.allowFreeText;
  const commitValue = !!opts.commitValue;
  const currentItems = items || [];

  container.classList.add("combo-wrapper");

  if (allowFreeText) return createFreeTextCombobox(container, currentItems, opts, commitValue);
  return createDropdownCombobox(container, currentItems, opts, commitValue);
}

// Large lists (e.g. Customer picker with hundreds of rows) rendering all at
// once freezes the browser on open/every keystroke. Two guards: (1) empty
// query on a large list shows nothing until you start typing, (2) matches
// are capped at COMBO_RENDER_LIMIT actually rendered, rest just gets a
// "+N more" hint.
const COMBO_LARGE_LIST_THRESHOLD = 200;
const COMBO_RENDER_LIMIT = 50;

function renderComboOptions(optionsBox, items, query, onPick) {
  optionsBox.innerHTML = "";
  const q = (query || "").toLowerCase();

  if (!q && items.length > COMBO_LARGE_LIST_THRESHOLD) {
    const hint = document.createElement("div");
    hint.className = "combo-empty";
    hint.textContent = "Type to search (" + items.length + " options)...";
    optionsBox.appendChild(hint);
    return;
  }

  const matches = items.filter(function (it) {
    const label = String(it.label == null ? "" : it.label).toLowerCase();
    const sub = String(it.sub == null ? "" : it.sub).toLowerCase();
    return !q || label.indexOf(q) !== -1 || sub.indexOf(q) !== -1;
  });

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "combo-empty";
    empty.textContent = "No results";
    optionsBox.appendChild(empty);
    return;
  }

  const shown = matches.slice(0, COMBO_RENDER_LIMIT);

  shown.forEach(function (it) {
    const row = document.createElement("div");
    row.className = "combo-option";

    const labelSpan = document.createElement("span");
    labelSpan.className = "combo-label";
    labelSpan.textContent = it.label;

    const subSpan = document.createElement("span");
    subSpan.className = "combo-sub";
    subSpan.textContent = it.sub || "";

    row.appendChild(labelSpan);
    row.appendChild(subSpan);

    // mousedown (not click) so the pick registers before blur closes the panel.
    row.addEventListener("mousedown", function (e) {
      e.preventDefault();
      onPick(it);
    });

    optionsBox.appendChild(row);
  });

  if (matches.length > shown.length) {
    const more = document.createElement("div");
    more.className = "combo-empty";
    more.textContent = "+" + (matches.length - shown.length) + " more - keep typing to narrow down";
    optionsBox.appendChild(more);
  }
}

// Pure dropdown mode: trigger looks like a <select>, click opens a panel
// with all options. A small search box lives inside the panel (not the
// main field) to filter long lists.
function createDropdownCombobox(container, currentItems, opts, commitValue) {
  const placeholder = opts.placeholder || "Select...";

  container.innerHTML =
    '<div class="combo-trigger" tabindex="0">' +
      '<span class="combo-trigger-text combo-placeholder">' + placeholder + "</span>" +
      '<span class="combo-arrow">▾</span>' +
    "</div>" +
    '<div class="combo-panel">' +
      '<input type="text" class="combo-search" placeholder="Search...">' +
      '<div class="combo-options"></div>' +
    "</div>";

  const trigger = container.querySelector(".combo-trigger");
  const triggerText = container.querySelector(".combo-trigger-text");
  const panel = container.querySelector(".combo-panel");
  const search = container.querySelector(".combo-search");
  const optionsBox = container.querySelector(".combo-options");

  let selectedValue = "";

  function openPanel() {
    panel.style.display = "block";
    search.value = "";
    renderComboOptions(optionsBox, currentItems, "", pick);
    search.focus();
  }

  function closePanel() {
    panel.style.display = "none";
  }

  function pick(it) {
    selectedValue = it.value;
    triggerText.textContent = commitValue ? it.value : it.label;
    triggerText.classList.remove("combo-placeholder");
    closePanel();
    if (opts.onSelect) opts.onSelect(it.value, it);
  }

  trigger.addEventListener("click", function () {
    if (panel.style.display === "block") closePanel();
    else openPanel();
  });

  search.addEventListener("input", function () {
    renderComboOptions(optionsBox, currentItems, search.value, pick);
  });

  document.addEventListener("mousedown", function (e) {
    if (!container.contains(e.target)) closePanel();
  });

  return {
    setItems: function (newItems) { currentItems.length = 0; currentItems.push.apply(currentItems, newItems); },
    getValue: function () { return selectedValue; },
    setSelection: function (value, label) {
      const item = currentItems.find(function (it) { return it.value === value; }) || { value: value, label: label };
      pick(item);
    },
    clear: function () {
      selectedValue = "";
      triggerText.textContent = placeholder;
      triggerText.classList.add("combo-placeholder");
    }
  };
}

// Free-text mode: the field is a real <input>, can be filled with a value
// not in the list (e.g. a non-registry SKU code), but still has a browse panel.
function createFreeTextCombobox(container, currentItems, opts, commitValue) {
  container.innerHTML =
    '<input type="text" class="combo-input" placeholder="' + (opts.placeholder || "") + '" autocomplete="off">' +
    '<div class="combo-panel"><div class="combo-options"></div></div>';

  const input = container.querySelector(".combo-input");
  const panel = container.querySelector(".combo-panel");
  const optionsBox = container.querySelector(".combo-options");

  function pick(it) {
    input.value = commitValue ? it.value : it.label;
    input.dataset.value = it.value;
    panel.style.display = "none";
    if (opts.onSelect) opts.onSelect(it.value, it);
  }

  function openPanel(query) {
    renderComboOptions(optionsBox, currentItems, query, pick);
    panel.style.display = "block";
  }

  input.addEventListener("input", function () {
    input.dataset.value = input.value;
    openPanel(input.value);
  });

  input.addEventListener("focus", function () {
    openPanel(input.value);
  });

  input.addEventListener("blur", function () {
    setTimeout(function () { panel.style.display = "none"; }, 150);
  });

  return {
    setItems: function (newItems) { currentItems.length = 0; currentItems.push.apply(currentItems, newItems); },
    getValue: function () { return input.dataset.value || ""; },
    setSelection: function (value, label) {
      input.value = commitValue ? value : label;
      input.dataset.value = value;
    },
    clear: function () { input.value = ""; input.dataset.value = ""; }
  };
}

// ---------- Drag-to-scroll ----------
//
// For a wide table wrapped in an overflow-x:auto container - adds
// click-and-drag horizontal scrolling on top of the native scrollbar
// (which stays as a fallback), like Figma/Google Sheets. Call once on the
// wrapper element right after it's in the DOM; safe to call again on a
// fresh element after an innerHTML rebuild (old listeners just go with the
// discarded node - nothing to clean up).
function enableDragScroll(container) {
  if (!container || container._dragScrollEnabled) return;
  container._dragScrollEnabled = true;
  container.classList.add("drag-scroll");

  let isDown = false;
  let dragged = false;
  let startX = 0;
  let startScrollLeft = 0;
  const DRAG_THRESHOLD = 4; // px of movement before a mousedown counts as a drag, not a click

  container.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    // Native form controls need their own default mousedown behavior
    // (focus, text caret, opening a <select>) uninterrupted - buttons are
    // fine since their action fires on "click", which the drag-suppression
    // below can safely intercept only when a real drag happened.
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    isDown = true;
    dragged = false;
    startX = e.pageX;
    startScrollLeft = container.scrollLeft;
  });

  document.addEventListener("mousemove", function (e) {
    if (!isDown) return;
    const delta = e.pageX - startX;
    if (!dragged && Math.abs(delta) < DRAG_THRESHOLD) return;
    dragged = true;
    container.classList.add("dragging");
    container.scrollLeft = startScrollLeft - delta;
    e.preventDefault();
  });

  document.addEventListener("mouseup", function () {
    if (!isDown) return;
    isDown = false;
    container.classList.remove("dragging");
  });

  // mousedown+mouseup on a button still fires a "click" on it regardless of
  // how much the mouse moved in between - swallow exactly that one click
  // when it was actually a drag, so Edit/etc. buttons under the cursor
  // don't fire after the user drags across them.
  container.addEventListener("click", function (e) {
    if (dragged) {
      e.preventDefault();
      e.stopPropagation();
      dragged = false;
    }
  }, true);
}

// ---------- Pagination ----------
//
// Paginates the rows already sitting in <tbody id="tbodyId"> (rendered from
// a fetched JSON array), pageSize at a time, with a Prev/Next nav + page
// info in <... id="navId"> underneath. No server round-trip per page change.
// Call again whenever the table is re-rendered.
function paginateTable(tbodyId, navId, pageSize) {
  pageSize = pageSize || 20;
  const tbody = document.getElementById(tbodyId);
  const nav = document.getElementById(navId);
  if (!tbody || !nav) return;

  const rows = Array.from(tbody.rows);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  let page = 1;

  const table = tbody.closest("table");
  const headRow = table.querySelector("thead tr");
  const colCount = headRow ? headRow.children.length : (rows[0] ? rows[0].children.length : 1);

  if (headRow) {
    Array.from(headRow.children).forEach(function (th) {
      th.style.width = th.getBoundingClientRect().width + "px";
    });
    table.style.tableLayout = "fixed";
  }

  function show() {
    const start = (page - 1) * pageSize;
    const visibleCount = Math.max(0, Math.min(pageSize, rows.length - start));

    rows.forEach(function (row, i) {
      row.style.display = (i >= start && i < start + pageSize) ? "" : "none";
    });

    const fillersNeeded = rows.length > pageSize ? pageSize - visibleCount : 0;
    let fillers = tbody.querySelectorAll(".pagination-filler-row");
    while (fillers.length < fillersNeeded) {
      const filler = document.createElement("tr");
      filler.className = "pagination-filler-row";
      filler.innerHTML = '<td colspan="' + colCount + '">&nbsp;</td>';
      tbody.appendChild(filler);
      fillers = tbody.querySelectorAll(".pagination-filler-row");
    }
    fillers.forEach(function (f, i) { f.style.display = i < fillersNeeded ? "" : "none"; });

    nav.innerHTML = "";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    prev.disabled = page <= 1;
    prev.onclick = function () { page--; show(); };

    const info = document.createElement("span");
    info.className = "pagination-info";
    info.textContent = "Page " + page + " / " + totalPages + " (" + rows.length + " items)";

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled = page >= totalPages;
    next.onclick = function () { page++; show(); };

    nav.appendChild(prev);
    nav.appendChild(info);
    nav.appendChild(next);
  }

  show();
}

// Same as paginateTable, but for tables that merge rows with rowspan (e.g.
// Orders - one order, multiple items). paginateTable slices every N rows
// regardless of rowspan and can cut a group in half. This version keeps
// groups intact (rows carry a "group-start" class) - targetPageSize is a
// floor per page, not exact, since a group is never split.
function paginateGroupedTable(tbodyId, navId, targetPageSize) {
  targetPageSize = targetPageSize || 20;
  const tbody = document.getElementById(tbodyId);
  const nav = document.getElementById(navId);
  if (!tbody || !nav) return;

  const rows = Array.from(tbody.rows);
  if (!rows.length) return;

  const table = tbody.closest("table");
  const headRow = table.querySelector("thead tr");
  const colCount = headRow ? headRow.children.length : 1;

  const pages = [];
  let current = [];
  rows.forEach(function (row) {
    const isGroupStart = row.classList.contains("group-start");
    if (isGroupStart && current.length >= targetPageSize) {
      pages.push(current);
      current = [];
    }
    current.push(row);
  });
  if (current.length) pages.push(current);

  const maxRowsPerPage = pages.reduce(function (max, p) { return Math.max(max, p.length); }, 0);
  const totalPages = pages.length;
  let page = 1;

  function show() {
    rows.forEach(function (row) { row.style.display = "none"; });

    const visible = pages[page - 1] || [];
    visible.forEach(function (row) { row.style.display = ""; });

    const fillersNeeded = totalPages > 1 ? maxRowsPerPage - visible.length : 0;
    let fillers = tbody.querySelectorAll(".pagination-filler-row");
    while (fillers.length < fillersNeeded) {
      const filler = document.createElement("tr");
      filler.className = "pagination-filler-row";
      filler.innerHTML = '<td colspan="' + colCount + '">&nbsp;</td>';
      tbody.appendChild(filler);
      fillers = tbody.querySelectorAll(".pagination-filler-row");
    }
    fillers.forEach(function (f, i) { f.style.display = i < fillersNeeded ? "" : "none"; });

    nav.innerHTML = "";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "Prev";
    prev.disabled = page <= 1;
    prev.onclick = function () { page--; show(); };

    const info = document.createElement("span");
    info.className = "pagination-info";
    info.textContent = "Page " + page + " / " + totalPages + " (" + rows.length + " items)";

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled = page >= totalPages;
    next.onclick = function () { page++; show(); };

    nav.appendChild(prev);
    nav.appendChild(info);
    nav.appendChild(next);
  }

  show();
}

// ---------- Modal ----------
//
// One reusable overlay (backdrop + centered box) - the page behind it stays
// mounted, nothing navigates. openModal(html) returns the box element so
// the caller can wire up its own inputs/buttons inside it. Closes on
// backdrop click, Escape, or a manual closeModal() call (e.g. after save).
function openModal(html) {
  closeModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "activeModalBackdrop";
  backdrop.addEventListener("mousedown", function (e) {
    if (e.target === backdrop) closeModal();
  });

  const box = document.createElement("div");
  box.className = "modal-box";
  box.innerHTML = '<button type="button" class="modal-close" onclick="closeModal()">&times;</button>' + html;
  backdrop.appendChild(box);

  document.body.appendChild(backdrop);
  document.addEventListener("keydown", closeModalOnEscape);
  return box;
}

function closeModal() {
  const backdrop = document.getElementById("activeModalBackdrop");
  if (backdrop) backdrop.remove();
  document.removeEventListener("keydown", closeModalOnEscape);
}

function closeModalOnEscape(e) {
  if (e.key === "Escape") closeModal();
}

// ---------- Tiny hash router ----------
//
// pages/*.js each register themselves via registerPage(name, renderFn).
// renderFn receives the #content element and does its own fetch + DOM build.
// URL is #/<name> so it's bookmarkable and back/forward works; no library.
const PAGE_REGISTRY = {};

function registerPage(name, renderFn) {
  PAGE_REGISTRY[name] = renderFn;
}

function navigateTo(name) {
  if (location.hash === "#/" + name) { renderCurrentPage(); return; }
  location.hash = "#/" + name;
}

function renderCurrentPage() {
  const hashBody = location.hash.replace(/^#\//, "") || "dashboard";
  const [name, query] = hashBody.split("?");
  const content = document.getElementById("content");
  const renderFn = PAGE_REGISTRY[name];

  setActiveNavButton(name, new URLSearchParams(query || "").get("tab") || "");

  if (!renderFn) {
    content.innerHTML = "<p>Page not found: " + name + "</p>";
    return;
  }
  content.innerHTML = "<p>Loading...</p>";
  Promise.resolve(renderFn(content)).catch(function (err) {
    content.innerHTML = '<p style="color:#d32f2f">Error loading page: ' + (err.message || err) + "</p>";
  });
}

// ---------- Navbar dropdowns ----------
// Ported verbatim from the old app's 99 Shared/Layout/LayoutNavbar.html.

function closeNavDropdowns() {
  document.querySelectorAll("#navbar .navbar-item.open").forEach(function (el) {
    el.classList.remove("open");
  });
  document.querySelectorAll("#navbar .navbar-subitem.open").forEach(function (el) {
    el.classList.remove("open");
  });
}

function toggleNavDropdown(btn) {
  const item = btn.closest(".navbar-item");
  const wasOpen = item.classList.contains("open");
  closeNavDropdowns();
  if (!wasOpen) item.classList.add("open");
}

// Level-2 submenu (e.g. "Engineering" inside the Menu dropdown) toggles
// independently of its parent dropdown, so the parent dropdown stays open
// while the submenu opens/closes. stopPropagation so this click isn't
// treated as a "click outside" by the listener below, which would close
// everything again immediately.
function toggleNavSubmenu(btn, event) {
  event.stopPropagation();
  const subitem = btn.closest(".navbar-subitem");
  const wasOpen = subitem.classList.contains("open");

  // Close any OTHER open submenu in the same dropdown (e.g. Cashflow and
  // Opex are both under Finance) - not this one, that's toggled below.
  subitem.parentElement.querySelectorAll(":scope > .navbar-subitem.open").forEach(function (el) {
    if (el !== subitem) el.classList.remove("open");
  });

  subitem.classList.toggle("open", !wasOpen);
}

// Leaf button (in a dropdown, or a standalone item like Dashboard) gets
// highlighted; parent toggles (e.g. "Finance", and "Engineering" at level 2)
// get highlighted too when a descendant is active, so it's still visible
// even while the dropdown/submenu is closed.
// tab: the current page's ?tab= value (empty string if the page has none).
// Buttons without a data-tab (most pages - one nav entry per page) match on
// data-page alone; buttons that share a data-page across several tabs (e.g.
// Sales' Summary/Log) also need their own data-tab to match, otherwise every
// sibling tab button would light up together.
function setActiveNavButton(page, tab) {
  document.querySelectorAll("#navbar [data-page]").forEach(function (btn) {
    const matchesPage = btn.dataset.page === page;
    const matchesTab = btn.dataset.tab === undefined || btn.dataset.tab === tab;
    btn.classList.toggle("navbar-active", matchesPage && matchesTab);
  });
  document.querySelectorAll("#navbar .navbar-subitem").forEach(function (sub) {
    const hasActiveChild = !!sub.querySelector(".navbar-subdropdown [data-page].navbar-active");
    sub.querySelector("button").classList.toggle("navbar-active", hasActiveChild);
  });
  document.querySelectorAll("#navbar .navbar-item").forEach(function (item) {
    const hasActiveChild = !!item.querySelector(".navbar-dropdown [data-page].navbar-active, .navbar-dropdown .navbar-subitem > button.navbar-active");
    item.querySelector("button").classList.toggle("navbar-active", hasActiveChild);
  });
}

// Click outside any navbar-item -> close whatever dropdown is open.
document.addEventListener("mousedown", function (e) {
  if (!e.target.closest(".navbar-item")) closeNavDropdowns();
});

window.addEventListener("hashchange", renderCurrentPage);
