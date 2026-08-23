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
export async function getOpexLinkMap(supabase, brandId) {
  const [ordersRes, batchesRes] = await Promise.all([
    supabase.from("orders").select("order_code, driver_payout_opex_code, driver_payout_method").eq("brand_id", brandId).not("driver_payout_opex_code", "is", null),
    supabase.from("sales_batches").select("batch_code, platform_fee_opex_code, marketing_fee_opex_code").eq("brand_id", brandId)
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (batchesRes.error) throw batchesRes.error;

  const map = {};
  ordersRes.data.forEach((o) => {
    map[o.driver_payout_opex_code] = { source: "Driver Payout", refCode: o.order_code, paymentMethod: o.driver_payout_method || null };
  });
  batchesRes.data.forEach((b) => {
    if (b.platform_fee_opex_code) map[b.platform_fee_opex_code] = { source: "Sales Batch", refCode: b.batch_code, paymentMethod: null };
    if (b.marketing_fee_opex_code) map[b.marketing_fee_opex_code] = { source: "Sales Batch", refCode: b.batch_code, paymentMethod: null };
  });
  return map;
}
