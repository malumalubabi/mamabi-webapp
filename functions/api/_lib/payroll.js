// Payroll (HR > Attendance > Payroll tab) - computes each active staff's
// pay for one month from staff_shifts + Settings > Staff Roles' Daily Rate.
// Monthly staff: flat base_rate, minus a per-Absent-day deduction (Leave/
// Sick/Cancelled don't deduct - only unexcused Absent). Daily staff: sum of
// that day's role's Daily Rate for every "Scheduled" (= worked) shift that
// month - no deduction concept, since they're only ever paid for days they
// actually have a Scheduled shift.
// "Total working days" (the Monthly deduction's denominator) = calendar
// days in the month Outlet Hours' weekly pattern says the outlet is open -
// same source the Calendar itself reads for the open/closed dot.
//
// Both the shifts counted and totalWorkingDays are capped at today (in the
// brand's configured Timezone) - a shift dated later this month is still
// only "Scheduled" (planned), not something that's actually happened yet,
// so it must not be paid for early. Recalculating mid-month naturally
// yields a partial, growing total as the month goes on; once the month is
// fully in the past the cap has no effect (today is past month-end).

async function todayInBrandTimezone(supabase, brandId) {
  const { data, error } = await supabase.from("settings").select("value").eq("brand_id", brandId).eq("key", "Timezone").maybeSingle();
  if (error) throw error;
  const timezone = (data && data.value) || "Asia/Makassar";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); // "YYYY-MM-DD"
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
}

function lastDateOfMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return monthKey + "-" + String(lastDay).padStart(2, "0");
}

// Counts working days from the 1st through cutoff (inclusive) - breaks as
// soon as a candidate date exceeds cutoff, which also correctly yields 0
// for a monthKey entirely after cutoff (a future month) without needing a
// separate special case.
function totalWorkingDaysUpTo(monthKey, cutoff, outletHoursByWeekday) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = monthKey + "-" + String(d).padStart(2, "0");
    if (dateStr > cutoff) break;
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const row = outletHoursByWeekday[weekday];
    if (!row || row.is_open !== false) count++;
  }
  return count;
}

export async function computePayrollLines(supabase, brandId, monthKey) {
  const today = await todayInBrandTimezone(supabase, brandId);
  const monthEnd = lastDateOfMonth(monthKey);
  const cutoff = today < monthEnd ? today : monthEnd;

  const [staffRes, hoursRes, roleRatesRes, shiftsRes] = await Promise.all([
    supabase.from("staff").select("id, name, employment_type, base_rate").eq("brand_id", brandId).eq("is_active", true),
    supabase.from("outlet_hours").select("weekday, is_open").eq("brand_id", brandId),
    supabase.from("settings_lists").select("value, meta").eq("brand_id", brandId).eq("list_name", "Staff Roles"),
    supabase.from("staff_shifts").select("staff_id, role, status")
      .eq("brand_id", brandId)
      .gte("shift_date", monthKey + "-01")
      .lte("shift_date", cutoff)
  ]);
  if (staffRes.error) throw staffRes.error;
  if (hoursRes.error) throw hoursRes.error;
  if (roleRatesRes.error) throw roleRatesRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const outletHoursByWeekday = {};
  hoursRes.data.forEach((h) => { outletHoursByWeekday[h.weekday] = h; });
  const totalWorkingDays = totalWorkingDaysUpTo(monthKey, cutoff, outletHoursByWeekday);

  const roleRateMap = {};
  roleRatesRes.data.forEach((r) => { roleRateMap[r.value] = Number(r.meta) || 0; });

  const shiftsByStaff = {};
  shiftsRes.data.forEach((s) => {
    if (!shiftsByStaff[s.staff_id]) shiftsByStaff[s.staff_id] = [];
    shiftsByStaff[s.staff_id].push(s);
  });

  return staffRes.data.map((st) => {
    const shifts = shiftsByStaff[st.id] || [];
    let basePay = 0, workedDays = 0, absentDays = 0, deduction = 0;

    if (st.employment_type === "Daily") {
      shifts.forEach((s) => {
        if (s.status === "Scheduled") {
          basePay += roleRateMap[s.role] || 0;
          workedDays++;
        }
      });
    } else {
      absentDays = shifts.filter((s) => s.status === "Absent").length;
      deduction = totalWorkingDays > 0 ? (Number(st.base_rate) / totalWorkingDays) * absentDays : 0;
      basePay = Number(st.base_rate) - deduction;
      workedDays = Math.max(totalWorkingDays - absentDays, 0);
    }

    return {
      staffId: st.id,
      staffName: st.name,
      employmentType: st.employment_type,
      basePay: Math.round(basePay),
      workedDays: workedDays,
      absentDays: absentDays,
      deduction: Math.round(deduction)
    };
  });
}
