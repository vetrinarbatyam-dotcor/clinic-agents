import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from "../../shared/clinica";

export interface VaccineLater {
  PetID: number;
  PetName: string;
  PetType: string;
  UserID: string;
  OwnerName: string;
  OwnerPhone: string;
  VaccineName: string;
  DueDate: string;
  DueDateParsed: Date;
  DaysOverdue: number;
}

export async function fetchVaccineLaters(): Promise<VaccineLater[]> {
  console.log("[vaccine] Fetching vaccine laters from ClinicaOnline...");

  // Scan last 40 days — covers all 4 reminder stages (0d, 7d, 17d, 30d + buffer)
  const fromDate = getIsraelDate(-40);
  const toDate = getIsraelDate();

  const data = await callAsmx("GetVaccineLaters", {
    ForReport: 0,
    SortVaccine: 0,
    SortFollowup: 0,
    SortCity: 0,
    allBranches: 0,
    SortPatient: 0,
    PatientName: "",
    CheckConfirmed: 0,
    StartDate: "",
    StartID: 0,
    fromDate: formatDateMMDDYYYY(fromDate),
    toDate: formatDateMMDDYYYY(toDate),
    addOrSubstract: 0,
  });

  if (!Array.isArray(data)) {
    console.log("[vaccine] No data returned or unexpected format");
    return [];
  }

  console.log(`[vaccine] Got ${data.length} raw records`);

  const today = getIsraelDate();
  const results: VaccineLater[] = [];

  for (const item of data) {
    const phone = item.CellPhone || item.Phone || "";
    if (!phone || phone.length < 9) continue;

    // Skip confirmed
    if (item.Confirmed === 1) continue;

    // Skip if already has appointment scheduled
    if (item.NextAppointment && item.NextAppointment.trim()) continue;

    // NextDate = when vaccine expired
    const rawDate = item.NextDate || "";
    if (!rawDate) continue;

    const dueDate = new Date(rawDate);
    if (isNaN(dueDate.getTime())) continue;

    const diffMs = today.getTime() - dueDate.getTime();
    const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    results.push({
      PetID: item.PetID || 0,
      PetName: item.PetName || "",
      PetType: item.PetType || "",
      UserID: String(item.PatientID || ""),
      OwnerName: item.UserName || "",
      OwnerPhone: phone,
      VaccineName: item.VacName || "חיסון",
      DueDate: rawDate,
      DueDateParsed: dueDate,
      DaysOverdue: daysOverdue,
    });
  }

  console.log(`[vaccine] Found ${results.length} pets with expired vaccines (0-40 days)`);
  return results;
}

export async function hasVisitedSinceDueDate(petId: number, dueDate: Date): Promise<boolean> {
  try {
    const fromStr = formatDateMMDDYYYY(dueDate);
    const toStr = formatDateMMDDYYYY(getIsraelDate());

    const sessions = await callAsmx("LoadPetSessions", {
      Anam: "", All: 1,
      fromDate: fromStr, toDate: toStr,
      PetID: petId, withWatch: 0,
    });

    if (Array.isArray(sessions) && sessions.length > 0) {
      for (const s of sessions) {
        if (s.Vaccine?.Name) return true;
        const session = s.Session || {};
        if (session.Finds || session.Notes) return true;
      }
    }
  } catch (e) { console.error("[vaccine-fetcher] hasVisitedSinceDueDate check failed:", e instanceof Error ? e.message : e); }
  return false;
}
