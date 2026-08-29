// One-shot bundle of everything the Orders/Inventory/Cashflow forms need
// for their comboboxes/selects. Small dataset (dozens to low hundreds of
// rows total) - cheaper to fetch once per page load than to build five
// separate endpoints for it.
//
// Sales Platform is one merged settings_lists list now (see settings.js) -
// each row's meta ("Base Pricing"/"Platform Pricing") says which selling
// price field it should use. Reshaped back into the same two arrays this
// endpoint always returned (salesPlatforms/platformsUsingPlatformPrice) so
// pages/sales.js's existing `.indexOf(platform)` pricing-lookup logic
// doesn't need to change at all.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [customers, skus, suppliers, staff, paymentMethods, salesPlatforms] = await Promise.all([
      supabase.from("customers").select("id, customer_code, name, contact, area, address").eq("brand_id", brandId).order("name"),
      supabase.from("sku_items").select("id, sku, name, unit, item_type, category, min_stock, base_yield_qty, selling_price, platform_selling_price, status").eq("brand_id", brandId).order("sku"),
      supabase.from("suppliers").select("id, supplier_code, name").eq("brand_id", brandId).order("name"),
      supabase.from("staff").select("id, name, roles").eq("brand_id", brandId).eq("is_active", true).order("name"),
      supabase.from("settings_lists").select("value").eq("brand_id", brandId).eq("list_name", "Payment Method").order("sort_order"),
      supabase.from("settings_lists").select("value, meta").eq("brand_id", brandId).eq("list_name", "Sales Platform").order("sort_order")
    ]);

    for (const r of [customers, skus, suppliers, staff, paymentMethods, salesPlatforms]) {
      if (r.error) throw r.error;
    }

    return jsonResponse({
      customers: customers.data,
      skus: skus.data,
      suppliers: suppliers.data,
      staff: staff.data,
      paymentMethods: paymentMethods.data.map((r) => r.value),
      salesPlatforms: salesPlatforms.data.map((r) => r.value),
      platformsUsingPlatformPrice: salesPlatforms.data.filter((r) => r.meta === "Platform Pricing").map((r) => r.value)
    });
  } catch (err) {
    return errorResponse(err);
  }
}
