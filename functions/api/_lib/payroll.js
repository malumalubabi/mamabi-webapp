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

function nextMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 1-based here, so this already lands on next month
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function totalWorkingDaysInMonth(monthKey, outletHoursByWeekday) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const row = outletHoursByWeekday[weekday];
    if (!row || row.is_open !== false) count++;
  }
  return count;
}

export async function computePayrollLines(supabase, brandId, monthKey) {
  const [staffRes, hoursRes, roleRatesRes, shiftsRes] = await Promise.all([
    supabase.from("staff").select("id, name, employment_type, base_rate").eq("brand_id", brandId).eq("is_active", true),
    supabase.from("outlet_hours").select("weekday, is_open").eq("brand_id", brandId),
    supabase.from("settings_lists").select("value, meta").eq("brand_id", brandId).eq("list_name", "Staff Roles"),
    supabase.from("staff_shifts").select("staff_id, role, status")
      .eq("brand_id", brandId)
      .gte("shift_date", monthKey + "-01")
      .lt("shift_date", nextMonthKey(monthKey) + "-01")
  ]);
  if (staffRes.error) throw staffRes.error;
  if (hoursRes.error) throw hoursRes.error;
  if (roleRatesRes.error) throw roleRatesRes.error;
  if (shiftsRes.error) throw shiftsRes.error;

  const outletHoursByWeekday = {};
  hoursRes.data.forEach((h) => { outletHoursByWeekday[h.weekday] = h; });
  const totalWorkingDays = totalWorkingDaysInMonth(monthKey, outletHoursByWeekday);

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
