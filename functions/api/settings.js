// Settings page data - a whitelisted subset of the "settings" key/value
// table (General) plus every managed option list from "settings_lists"
// that's actually read elsewhere in the app. "settings" has a few extra
// legacy/internal keys (LastTransactionID, AppVersion, etc.) not exposed
// here on purpose, same as the old app's getSettingsPageData() only ever
// showing its own fixed generalKeys whitelist.
//
// "Stockable Types" is deliberately left out - it exists as a
// settings_lists row (seeded, unused) but pages/inventory.js's
// STOCKABLE_TYPES is still a hardcoded constant, not read from here yet.
// Managing a list that doesn't actually drive anything would be a fake
// control; wiring it live is a separate follow-up.
//
// Sales Platform used to be two separate lists ("Sales Platform" +
// "Platforms Using Platform Price", the latter a manually-kept-in-sync
// subset) - merged into one list where each value carries a meta tag
// ("Base Pricing"/"Platform Pricing") instead, so there's one place to
// manage a platform instead of two. Same idea for what used to be "PnL
// Fixed Categories", renamed "PnL Categories" with a meta tag
// ("Fixed"/"Variable") per item instead of the list only ever holding fixed
// ones. `listsMeta[listName][value]` carries that tag; `lists[listName]`
// stays a plain array of values so existing consumers (Staff Roles
// membership checks, dropdowns) don't need to know meta exists.
import { getSupabase, getBrandId, jsonResponse, errorResponse } from "./_lib/supabase.js";

const GENERAL_KEYS = [
  "Currency Symbol", "Phone Country Code", "Timezone",
  "Customer Active Days Threshold", "PnL Start Year", "PnL Start Month",
  "Platform Fee %"
];

// SKU Category Code is one list per SKU type (categories are always
// type-scoped - "Protein" under Component and "Protein" under Ingredient
// are different lists with potentially different codes) - see
// pages/database.js's SKU_TYPES and pages/settings.js's SKU Config modal.
const SKU_CONFIG_TYPES = ["Ingredient", "Packaging", "Operating", "Product", "Component", "Semi-Finished"];

const LIST_NAMES = ["Payment Method", "Sales Platform", "PnL Categories", "Staff Roles", "Cashflow Category", "SKU Type Code", "SKU Unit Code"]
  .concat(SKU_CONFIG_TYPES.map((t) => "SKU Category Code - " + t));

export async function onRequestGet({ env }) {
  try {
    const supabase = getSupabase(env);
    const brandId = await getBrandId(supabase);

    const [settingsRes, listsRes] = await Promise.all([
      supabase.from("settings").select("key, value").eq("brand_id", brandId),
      supabase.from("settings_lists").select("list_name, value, meta").eq("brand_id", brandId).order("sort_order")
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (listsRes.error) throw listsRes.error;

    const settingsByKey = {};
    settingsRes.data.forEach((r) => { settingsByKey[r.key] = r.value; });

    const general = GENERAL_KEYS.map((key) => ({ key: key, value: settingsByKey[key] === undefined ? "" : settingsByKey[key] }));

    const lists = {};
    const listsMeta = {};
    LIST_NAMES.forEach((name) => { lists[name] = []; listsMeta[name] = {}; });
    listsRes.data.forEach((r) => {
      if (!lists[r.list_name]) return;
      lists[r.list_name].push(r.value);
      if (r.meta) listsMeta[r.list_name][r.value] = r.meta;
    });

    return jsonResponse({ general: general, lists: lists, listsMeta: listsMeta, listNames: LIST_NAMES });
  } catch (err) {
    return errorResponse(err);
  }
}
