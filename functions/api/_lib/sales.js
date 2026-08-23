// Shared shaping for the Sales module - merges manual entries (sales_entries,
// grouped under sales_batches for the shared Date/Platform/fees of one Input
// Sales submission) with "Online" rows derived LIVE from Orders (never
// stored, exactly like the old app's getOnlineOrderSalesRows_()) so the two
// can never double-count.
import { nextCode } from "./codes.js";

// Same "done" rule as orders.js's isOrderDone(), duplicated here (not
// imported) so this file doesn't reach into another route file - matches
// this codebase's convention of keeping shared logic in _lib/.
function isOrderSaleDone(o) {
  return o.order_status !== "Cancelled" && o.payment_status === "Paid" && o.fulfillment_status !== "Pending";
}

// Keeps one Sales batch's linked fee OpEx entry (Platform Fee/Marketing Fee)
// in sync with its current amount: create if it doesn't exist yet and the
// fee is >0, update in place if it already exists, delete if the fee was
// edited down to 0 (or removed). Same three-way logic as orders.js's
// savePayoutEdit()/driver_payout_opex_code.
export async function syncFeeOpex(supabase, brandId, existingOpexCode, newAmount, date, category, description) {
  if (newAmount > 0) {
    if (existingOpexCode) {
      const { error } = await supabase
        .from("opex_entries")
        .update({ gross_amount: newAmount, description: description, entry_date: date })
        .eq("brand_id", brandId)
        .eq("opex_code", existingOpexCode);
      if (error) throw error;
      return existingOpexCode;
    }

    const opexCode = await nextCode(supabase, "opex_entries", "opex_code", brandId, "OPX", 4);
    const { error } = await supabase.from("opex_entries").insert({
      brand_id: brandId, opex_code: opexCode, entry_date: date, category: category,
      description: description, gross_amount: newAmount, amort: "No", period: 1
    });
    if (error) throw error;
    return opexCode;
  }

  if (existingOpexCode) {
    const { error } = await supabase.from("opex_entries").delete().eq("brand_id", brandId).eq("opex_code", existingOpexCode);
    if (error) throw error;
  }
  return null;
}

export async function getOnlineSalesRows(supabase, brandId) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "order_code, order_date, order_type, order_status, payment_status, fulfillment_status, delivery_fee, " +
      "order_items(qty, unit_price, line_total, food_cost_snapshot, packaging_cost_snapshot, sku_items(sku, name))"
    )
    .eq("brand_id", brandId);
  if (error) throw error;

  const rows = [];
  data.filter(isOrderSaleDone).forEach((o) => {
    (o.order_items || []).forEach((it) => {
      const revenue = Number(it.line_total);
      const foodCost = it.food_cost_snapshot === null ? 0 : Number(it.food_cost_snapshot);
      const packagingCost = it.packaging_cost_snapshot === null ? 0 : Number(it.packaging_cost_snapshot);

      rows.push({
        id: null,
        salesCode: null,
        source: "online",
        groupKey: "order:" + o.order_code,
        refId: o.order_code,
        date: o.order_date,
        platform: "Online",
        sku: it.sku_items ? it.sku_items.sku : "",
        productName: it.sku_items ? it.sku_items.name : "",
        qty: Number(it.qty),
        sellingPrice: Number(it.unit_price),
        revenue: revenue,
        foodCost: foodCost,
        packagingCost: packagingCost,
        grossProfit: revenue - (foodCost + packagingCost),
        notes: null,
        orderType: o.order_type,
        deliveryFee: o.order_type === "Delivery" ? Number(o.delivery_fee) || 0 : 0,
        platformFee: 0,
        marketingFee: 0
      });
    });
  });
  return rows;
}

export async function getManualSalesRows(supabase, brandId) {
  const { data, error } = await supabase
    .from("sales_entries")
    .select(
      "id, sales_code, sale_date, platform, qty, selling_price, food_cost_snapshot, packaging_cost_snapshot, notes, " +
      "sku_items(sku, name), sales_batches!inner(brand_id, batch_code, platform_fee, marketing_fee)"
    )
    .eq("sales_batches.brand_id", brandId);
  if (error) throw error;

  return data.map((r) => {
    const qty = Number(r.qty);
    const sellingPrice = Number(r.selling_price);
    const revenue = qty * sellingPrice;
    const foodCost = Number(r.food_cost_snapshot) || 0;
    const packagingCost = Number(r.packaging_cost_snapshot) || 0;
    const batch = r.sales_batches;

    return {
      id: r.id,
      salesCode: r.sales_code,
      source: "manual",
      groupKey: "batch:" + batch.batch_code,
      refId: batch.batch_code,
      date: r.sale_date,
      platform: r.platform,
      sku: r.sku_items ? r.sku_items.sku : "",
      productName: r.sku_items ? r.sku_items.name : "",
      qty: qty,
      sellingPrice: sellingPrice,
      revenue: revenue,
      foodCost: foodCost,
      packagingCost: packagingCost,
      grossProfit: revenue - (foodCost + packagingCost),
      notes: r.notes,
      orderType: "",
      deliveryFee: 0,
      platformFee: batch.platform_fee === null ? 0 : Number(batch.platform_fee),
      marketingFee: batch.marketing_fee === null ? 0 : Number(batch.marketing_fee)
    };
  });
}

// Items directly on a Product's recipe that get deducted from stock at Sale
// time. Component/Semi-Finished lines are skipped - Batch Production already
// deducted THEIR raw ingredients when that Component/Semi-Finished was
// produced, so deducting them again here would double-count. Ported from
// the old app's resolveProductConsumption_()/getStockableTypes_().
export function saleConsumptionItems(resolver, skuId, qty) {
  const { items } = resolver.getBreakdown(skuId);
  return items
    .filter((it) => it.itemType !== "Component" && it.itemType !== "Semi-Finished")
    .map((it) => ({ skuId: it.componentSkuId, qty: it.qty * qty }));
}

// Live Food/Packaging cost per unit for a Product SKU, from the same
// resolver used everywhere else in Menu Engineering/Orders - shared here so
// sales.js (create) and sales/[code].js (per-line edit) compute it the
// same way.
export function productCostPerUnit(resolver, skuId) {
  const { items } = resolver.getBreakdown(skuId);
  return {
    foodCostPerUnit: items.filter((x) => x.itemType !== "Packaging").reduce((sum, x) => sum + x.lineCost, 0),
    packagingCostPerUnit: items.filter((x) => x.itemType === "Packaging").reduce((sum, x) => sum + x.lineCost, 0)
  };
}
