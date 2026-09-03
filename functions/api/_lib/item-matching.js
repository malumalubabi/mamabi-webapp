// Matches a platform report's raw item text (GoFood's "Nama menu" / GoFood's
// "Item") to one of this brand's sku_items - Draft Review then pre-selects
// whatever matched and leaves the rest for a manual pick (see
// pages/sales.js's openSalesDraftReviewModal). Two-pass: exact product name
// first, then sales_item_aliases (names a user has manually resolved
// before) - see that table's comment for why aliases exist at all (GrabFood
// prefixes some items with "Sambal " that our own catalog doesn't).
export async function matchItemsToSkus(supabase, brandId, platform, rawItems) {
  const { data: products, error: prodErr } = await supabase
    .from("sku_items")
    .select("id, name")
    .eq("brand_id", brandId)
    .eq("item_type", "Product");
  if (prodErr) throw prodErr;
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));

  const { data: aliases, error: aliasErr } = await supabase
    .from("sales_item_aliases")
    .select("raw_label, sku_id")
    .eq("brand_id", brandId)
    .eq("platform", platform);
  if (aliasErr) throw aliasErr;
  const byAlias = new Map(aliases.map((a) => [a.raw_label.trim().toLowerCase(), a.sku_id]));

  return rawItems.map((it) => {
    const key = it.label.trim().toLowerCase();
    const skuId = byName.get(key) || byAlias.get(key) || null;
    return { label: it.label, qty: it.qty, sellingPrice: it.sellingPrice, skuId: skuId };
  });
}

// Called when a Draft Review row that came from an imported file gets
// manually resolved to a product - upsert (not plain insert) so correcting
// a previous alias just overwrites it instead of erroring on the unique
// constraint.
export async function saveItemAlias(supabase, brandId, platform, rawLabel, skuId) {
  const { error } = await supabase
    .from("sales_item_aliases")
    .upsert(
      { brand_id: brandId, platform: platform, raw_label: rawLabel, sku_id: skuId },
      { onConflict: "brand_id,platform,raw_label" }
    );
  if (error) throw error;
}
