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
  DaysOverdue: number; // negative = days until due, positive = days overdue
  additionalVaccines?: string[]; // populated after consolidation
}

export async function fetchVaccineLaters(): Promise<VaccineLater[]> {
  console.log("[vaccine] Fetching vaccine laters from ClinicaOnline...");

  const today = getIsraelDate();

  // Two fetches:
  // 1. GetVaccineReminders for upcoming (next 10 days) — includes future vaccines
  // 2. GetVaccineLaters for overdue (last 35 days) — only returns expired vaccines
  const upcomingFrom = getIsraelDate();
  const upcomingTo = getIsraelDate(10);
  const overdueFrom = getIsraelDate(-35);
  const overdueTo = getIsraelDate();

  const [upcomingData, overdueData] = await Promise.all([
    callAsmx("GetVaccineReminders", {
      ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0,
      allBranches: 0, SortPatient: 0, PatientName: "",
      CheckConfirmed: 0, StartDate: "", StartID: 0,
      fromDate: formatDateMMDDYYYY(upcomingFrom),
      toDate: formatDateMMDDYYYY(upcomingTo),
      addOrSubstract: 1, CurrentVacc: 0, Merge: 0,
    }),
    callAsmx("GetVaccineLaters", {
      ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0,
      allBranches: 0, SortPatient: 0, PatientName: "",
      CheckConfirmed: 0, StartDate: "", StartID: 0,
      fromDate: formatDateMMDDYYYY(overdueFrom),
      toDate: formatDateMMDDYYYY(overdueTo),
      addOrSubstract: 0,
    }),
  ]);

  const allData = [
    ...(Array.isArray(upcomingData) ? upcomingData : []),
    ...(Array.isArray(overdueData) ? overdueData : []),
  ];

  console.log(`[vaccine] Got ${allData.length} raw records (upcoming + overdue)`);

  const results: VaccineLater[] = [];
  const seen = new Set<string>(); // dedup by PetID + VaccineName

  for (const item of allData) {
    const phone = item.CellPhone || item.Phone || "";
    if (!phone || phone.length < 9) continue;

    // Skip confirmed
    if (item.Confirmed === 1) continue;

    // Skip if already has appointment scheduled
    if (item.NextAppointment && item.NextAppointment.trim()) continue;

    // NextDate = when vaccine is due
    const rawDate = item.NextDate || "";
    if (!rawDate) continue;

    const dueDate = new Date(rawDate);
    if (isNaN(dueDate.getTime())) continue;

    const diffMs = today.getTime() - dueDate.getTime();
    const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const dedupKey = `${item.PetID}_${item.VacName || "vaccine"}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

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

  console.log(`[vaccine] Found ${results.length} vaccines in reminder window (-10 to +35 days)`);
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

export async function hasUpcomingAppointment(petId: number, daysAhead: number = 14): Promise<boolean> {
  try {
    const fromStr = formatDateMMDDYYYY(getIsraelDate());
    const toStr = formatDateMMDDYYYY(getIsraelDate(daysAhead));

    const sessions = await callAsmx("LoadPetSessions", {
      Anam: "", All: 1,
      fromDate: fromStr, toDate: toStr,
      PetID: petId, withWatch: 0,
    });

    if (Array.isArray(sessions) && sessions.length > 0) {
      return true;
    }
  } catch (e) { console.error("[vaccine-fetcher] hasUpcomingAppointment check failed:", e instanceof Error ? e.message : e); }
  return false;
}

/**
 * Consolidate vaccines for the same pet within +/-7 days of each other.
 * Returns a reduced list where grouped vaccines are merged into one entry.
 */
export function consolidateVaccines(vaccines: VaccineLater[]): VaccineLater[] {
  // Group by OwnerPhone + PetID
  const groups = new Map<string, VaccineLater[]>();
  for (const v of vaccines) {
    const key = `${v.OwnerPhone}_${v.PetID}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  const result: VaccineLater[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Sort by due date
    group.sort((a, b) => a.DueDateParsed.getTime() - b.DueDateParsed.getTime());

    // Cluster vaccines within 7 days of each other
    const clusters: VaccineLater[][] = [];
    let currentCluster: VaccineLater[] = [group[0]];

    for (let i = 1; i < group.length; i++) {
      const daysDiff = Math.abs(
        Math.floor((group[i].DueDateParsed.getTime() - currentCluster[0].DueDateParsed.getTime()) / (1000 * 60 * 60 * 24))
      );
      if (daysDiff <= 7) {
        currentCluster.push(group[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [group[i]];
      }
    }
    clusters.push(currentCluster);

    // For each cluster, keep the earliest as representative, add others as additionalVaccines
    for (const cluster of clusters) {
      const representative = cluster[0];
      if (cluster.length > 1) {
        representative.additionalVaccines = cluster.slice(1).map(v => v.VaccineName);
      }
      result.push(representative);
    }
  }

  return result;
}
