// Generates the next "PREFIX-0001"-style code for a table, based on the
// highest existing code for that brand. All codes we generate are fixed-
// width zero-padded, so a plain text sort on the column doubles as a
// numeric sort - no need to pull every row and parse client-side.
export async function nextCode(supabase, table, column, brandId, prefix, width) {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq("brand_id", brandId)
    .like(column, prefix + "-%")
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw error;

  let n = 0;
  if (data.length) {
    const m = String(data[0][column]).match(/-(\d+)$/);
    if (m) n = parseInt(m[1], 10);
  }
  return prefix + "-" + String(n + 1).padStart(width, "0");
}
