registerPage("dashboard", async function (content) {
  const data = await api("dashboard");

  content.innerHTML =
    '<div class="tile-row">' +
      tile("Cash Balance", formatRupiah(data.cashBalance)) +
      tile("Bank Balance", formatRupiah(data.bankBalance)) +
      tile("Income", formatRupiah(data.income), "this month") +
      tile("Expense", formatRupiah(data.expense), "this month") +
    "</div>" +

    "<h3>Stock Alerts</h3>" +
    renderLowStock(data.lowStock) +

    "<h3>Recent Orders</h3>" +
    renderRecentOrders(data.recentOrders);
});

function tile(label, value, sub) {
  return (
    '<div class="tile">' +
      "<h4>" + label + (sub ? " <small>(" + sub + ")</small>" : "") + "</h4>" +
      "<h2>" + value + "</h2>" +
    "</div>"
  );
}

function renderLowStock(items) {
  if (!items.length) {
    return "<p>All stock above minimum. Nothing to flag.</p>";
  }

  const rows = items
    .map(function (it) {
      return (
        "<tr>" +
          "<td>" + it.name + '<br><span style="color:#666; font-size:12px;">' + it.sku + "</span></td>" +
          "<td>" + it.qtyOnHand.toLocaleString("id-ID") + " " + it.unit + "</td>" +
          "<td>" + it.minStock.toLocaleString("id-ID") + " " + it.unit + "</td>" +
        "</tr>"
      );
    })
    .join("");

  return (
    '<div class="tile alert" style="width:auto; max-width:600px;">' +
      "<table>" +
        "<thead><tr><th>Item</th><th>On Hand</th><th>Min Stock</th></tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
      "</table>" +
    "</div>"
  );
}

function renderRecentOrders(orders) {
  if (!orders.length) {
    return "<p>No orders yet.</p>";
  }

  const rows = orders
    .map(function (o) {
      return (
        "<tr>" +
          "<td>" + o.orderCode + "</td>" +
          "<td>" + o.orderDate + ", " + dayOfWeek(o.orderDate) + "</td>" +
          "<td>" + o.customerName + '<br><span style="color:#666; font-size:12px;">' + (o.customerContact ? formatPhoneDisplay(o.customerContact) : "") + "</span></td>" +
          "<td>" + formatRupiah(o.totalPrice) + "</td>" +
          "<td>" + o.orderType + "</td>" +
          "<td>" + o.orderStatus + "</td>" +
        "</tr>"
      );
    })
    .join("");

  return (
    "<style>" +
      "#recentOrdersTable { table-layout: fixed; }" +
      "#recentOrdersTable th, #recentOrdersTable td { padding-top: 2px; padding-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }" +
      "#recentOrdersTable .colOrder { width: 95px; } #recentOrdersTable .colDate { width: 180px; }" +
      "#recentOrdersTable .colPrice { width: 110px; } #recentOrdersTable .colType { width: 110px; } #recentOrdersTable .colStatus { width: 110px; }" +
    "</style>" +
    '<table id="recentOrdersTable">' +
      "<colgroup>" +
        '<col class="colOrder"><col class="colDate"><col><col class="colPrice"><col class="colType"><col class="colStatus">' +
      "</colgroup>" +
      "<thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Total Price</th><th>Type</th><th>Status</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
    "</table>"
  );
}

// Day-of-week helps eyeball weekly patterns at a glance without opening
// Order History. Parsed/formatted as UTC so the weekday always matches the
// literal date string, regardless of the browser's local timezone.
function dayOfWeek(dateStr) {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}
