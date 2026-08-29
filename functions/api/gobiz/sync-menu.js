// Pushes our Product catalog to GoFood (PUT .../v1/catalog) so incoming
// order webhooks can map their line items back to our sku_items - GoFood
// order_items carry back whatever external_id we assign here, per our own
// SKU code, never a GoBiz-generated id. Not wired to any trigger yet (call
// manually via POST /api/gobiz/sync-menu after adding/pricing a Product, or
// from Settings later) - GoFood's catalog endpoint is a full replace, not a
// merge/upsert (see comment below), so every call re-sends the WHOLE active
// Product list, never a partial diff.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "../_lib/supabase.js";
import { gobizFetch } from "../_lib/gobiz.js";

// Hardcoded for now - our single sandbox outlet's GoBiz id ("G..." format),
// from the Outlet ID / Merchant ID field on the developer portal's
// integration page (NOT the UUID from the browsable sandbox restaurant URL -
// that one 403s "Partner is not authorized to access this outlet's
// resource", confirmed live). See _lib/gobiz.js's comment on why there's no
// API call to look this up for Direct Integration.
const OUTLET_ID = "G971761612";

export async function onRequestPost({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const { data: products, error } = await supabase
      .from("sku_items")
      .select("sku, name, platform_selling_price")
      .eq("brand_id", brandId)
      .eq("item_type", "Product")
      .neq("status", "Inactive");
    if (error) throw error;

    // Platform Selling Price is manually set per Product in Menu Engineering
    // > Platform Pricing (see functions/api/platform-pricing.js) - a Product
    // with none set yet has nothing meaningful to sell on GoFood at, so it's
    // left out of the push rather than syncing a Rp 0 item.
    const priced = products.filter((p) => Number(p.platform_selling_price) > 0);

    const menuItems = priced.map((p) => ({
      external_id: p.sku,
      name: p.name,
      in_stock: true,
      price: Math.round(Number(p.platform_selling_price))
    }));

    const result = await gobizFetch(env, "/integrations/gofood/outlets/" + OUTLET_ID + "/v1/catalog", {
      method: "PUT",
      body: {
        request_id: crypto.randomUUID(),
        menus: [{ name: "Menu", menu_items: menuItems }]
      }
    });

    return jsonResponse({ syncedCount: menuItems.length, skippedNoPriceCount: products.length - priced.length, gobiz: result });
  } catch (err) {
    return errorResponse(err);
  }
}
