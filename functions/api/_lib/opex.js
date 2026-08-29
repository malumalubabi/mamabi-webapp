import { nextCode } from "./codes.js";

// Manual OpEx entries (functions/api/opex.js's POST, functions/api/opex/
// [code].js's PATCH) let category through as free text with nothing
// checking it against settings_lists "PnL Categories" - unlike
// functions/api/cashflow.js's POST, which already validates its category
// the same way. A category that doesn't match any managed list value falls
// through pnl.js's Fixed/Variable split as "Variable" (categoryMetaMap
// lookup misses -> defaults there), silently misclassifying it instead of
// erroring at entry time.
export async function isValidOpexCategory(supabase, brandId, category) {
  const { data, error } = await supabase
    .from("settings_lists")
    .select("value")
    .eq("brand_id", brandId)
    .eq("list_name", "PnL Categories")
    .eq("value", category)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// Cross-reference helper - opex_entries has no column pointing back to what
// created it, so "is this row auto-linked" is answered by checking whether
// its opex_code shows up as a link column on orders (Driver Payout) or
// sales_batches (Platform Fee/Marketing Fee). Used both to annotate the Log
// (functions/api/opex.js GET) and to block direct edit/delete of a linked
// row (functions/api/opex/[code].js) - the old app never guarded this (any
// row could be edited/deleted straight from the Ledger even if it came from
// Driver Payout), which could silently desync the two; edit/delete from the
// source instead, same restriction as Sales Log's "Online" rows.
//
// A Driver Payout link also carries paymentMethod (orders.driver_payout_method)
// so the Log can show it live - it's never copied into opex_entries itself,
// so if the method gets changed later from Payout History (savePayoutEdit),
// the Log reflects that automatically instead of going stale. Sales Batch
// links don't have a comparable "how it was paid" concept (platform fees are
// deducted by the platform, not paid via a method), so paymentMethod is null
// there.
//
// A Driver Payout opex_code can now be shared by several orders (grouped per
// driver+month, see resyncDriverPayoutOpexGroup below) - refCode becomes the
// joined list of every order sharing that code, and paymentMethod the set of
// distinct methods among them (normally just one, since they're all set
// together at Mark Paid time, but a later per-order edit in Payout History
// can in theory diverge them).
export async function getOpexLinkMap(supabase, brandId) {
  const [ordersRes, batchesRes] = await Promise.all([
    supabase.from("orders").select("order_code, driver_payout_opex_code, driver_payout_method").eq("brand_id", brandId).not("driver_payout_opex_code", "is", null),
    supabase.from("sales_batches").select("batch_code, platform_fee_opex_code, marketing_fee_opex_code").eq("brand_id", brandId)
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (batchesRes.error) throw batchesRes.error;

  const map = {};
  const ordersByCode = {};
  ordersRes.data.forEach((o) => {
    if (!ordersByCode[o.driver_payout_opex_code]) ordersByCode[o.driver_payout_opex_code] = [];
    ordersByCode[o.driver_payout_opex_code].push(o);
  });
  Object.entries(ordersByCode).forEach(([opexCode, orders]) => {
    const methods = [...new Set(orders.map((o) => o.driver_payout_method).filter(Boolean))];
    map[opexCode] = {
      source: "Driver Payout",
      refCode: orders.map((o) => o.order_code).join(", "),
      paymentMethod: methods.length ? methods.join(", ") : null
    };
  });
  batchesRes.data.forEach((b) => {
    if (b.platform_fee_opex_code) map[b.platform_fee_opex_code] = { source: "Sales", refCode: b.batch_code, paymentMethod: null };
    if (b.marketing_fee_opex_code) map[b.marketing_fee_opex_code] = { source: "Sales", refCode: b.batch_code, paymentMethod: null };
  });
  return map;
}

// Recomputes ONE driver+month's Driver Payout OpEx group from scratch, from
// whatever's currently Completed in the DB - never incrementally patched,
// same "always live recompute" pattern as P&L's computeLiveMonthlyData.
// Membership is accrual-based (order_status = 'Completed'), NOT whether the
// driver has actually been paid (driver_payout_status) - the expense is
// incurred the moment the order is done, same accrual timing as stock
// consumption (see _lib/orders.js's recordOrderConsumption), regardless of
// when cash actually moves to the driver. Mark Paid (functions/api/
// driver-payout/mark-paid.js) no longer calls this at all - it only flips
// driver_payout_status, which this function doesn't even look at anymore.
// Called after every mutation that could change a group's membership: an
// order becoming Completed (functions/api/orders.js POST, functions/api/
// orders/[code].js PATCH) and a per-order edit in Payout History
// (functions/api/driver-payout/[code].js - both the old group, if driver/
// month changed, and the new one), so every driver's accrued fees roll up
// the same way regardless of which path completed the order.
//
// driverKey is either a staff id (driver_staff_id) or a raw external name
// (driver_name_raw) - same dual scheme used everywhere else driver identity
// is grouped (pages/orders.js's groupUnpaidByDriver). monthKey is "YYYY-MM"
// of order_date.
export async function resyncDriverPayoutOpexGroup(supabase, brandId, driverKey, driverIsStaff, monthKey) {
  const driverColumn = driverIsStaff ? "driver_staff_id" : "driver_name_raw";

  // Every order for this driver in this month, Completed or not - not just
  // the currently-Completed ones - so a stray link left behind on an order
  // that got un-Completed somehow (or had its fee zeroed) is still found
  // and cleared, even though it's no longer a real member of the group.
  const { data: inMonth, error: selErr } = await supabase
    .from("orders")
    .select("order_code, order_date, delivery_fee, order_status, driver_payout_opex_code")
    .eq("brand_id", brandId)
    .eq(driverColumn, driverKey)
    .gte("order_date", monthKey + "-01")
    .lt("order_date", nextMonthKey(monthKey) + "-01");
  if (selErr) throw selErr;

  const staleCode = inMonth.map((o) => o.driver_payout_opex_code).find(Boolean) || null;
  const members = inMonth.filter((o) => o.order_status === "Completed" && Number(o.delivery_fee) > 0);

  if (!members.length) {
    if (staleCode) {
      await supabase.from("opex_entries").delete().eq("brand_id", brandId).eq("opex_code", staleCode);
      const strayCodes = inMonth.filter((o) => o.driver_payout_opex_code === staleCode);
      if (strayCodes.length) {
        await supabase.from("orders").update({ driver_payout_opex_code: null }).eq("brand_id", brandId).in("order_code", strayCodes.map((o) => o.order_code));
      }
    }
    return;
  }

  const total = members.reduce((sum, o) => sum + Number(o.delivery_fee), 0);
  const entryDate = members.reduce((max, o) => (o.order_date > max ? o.order_date : max), members[0].order_date);
  const driverLabel = driverIsStaff
    ? (await supabase.from("staff").select("name").eq("id", driverKey).eq("brand_id", brandId).maybeSingle()).data?.name || driverKey
    : driverKey;
  const desc = "Driver Fee " + driverLabel + ", " + members.map((o) => o.order_code).join(", ");

  let opexCode = staleCode;
  if (opexCode) {
    const { error: updErr } = await supabase
      .from("opex_entries")
      .update({ entry_date: entryDate, description: desc, gross_amount: total })
      .eq("brand_id", brandId)
      .eq("opex_code", opexCode);
    if (updErr) throw updErr;
  } else {
    opexCode = await nextCode(supabase, "opex_entries", "opex_code", brandId, "OPX", 4);
    const { error: insErr } = await supabase.from("opex_entries").insert({
      brand_id: brandId,
      opex_code: opexCode,
      entry_date: entryDate,
      category: "Logistic",
      description: desc,
      gross_amount: total,
      amort: "No",
      period: 1
    });
    if (insErr) throw insErr;
  }

  const { error: linkErr } = await supabase
    .from("orders")
    .update({ driver_payout_opex_code: opexCode })
    .eq("brand_id", brandId)
    .in("order_code", members.map((o) => o.order_code));
  if (linkErr) throw linkErr;

  // Any other order that had staleCode but isn't a member anymore (flipped
  // Unpaid, or its fee got zeroed) - clear its now-wrong link.
  const strayCodes = inMonth.filter((o) => o.driver_payout_opex_code === staleCode && !members.some((m) => m.order_code === o.order_code));
  if (strayCodes.length) {
    const { error: clearErr } = await supabase
      .from("orders")
      .update({ driver_payout_opex_code: null })
      .eq("brand_id", brandId)
      .in("order_code", strayCodes.map((o) => o.order_code));
    if (clearErr) throw clearErr;
  }
}

function nextMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m, 1); // m (0-based next month) since monthKey's m is 1-based
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
