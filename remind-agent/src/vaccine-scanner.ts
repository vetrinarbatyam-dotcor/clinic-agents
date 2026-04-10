import 'dotenv/config';
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from '../../shared/clinica';

export interface VaccineLater {
  UserName: string;
  CellPhone: string;
  Phone: string;
  Email: string;
  PetName: string;
  PetID: number;
  PetType: string;
  VacName: string;
  Date: string;       // last vaccine date
  NextDate: string;    // when it expired
  PatientID: string;
  Confirmed: number;
  NextAppointment: string;
  ID: number;
}

export interface GroupedReminder {
  ownerName: string;
  ownerPhone: string;
  patientId: string;
  pets: Array<{
    petName: string;
    petId: number;
    vaccines: Array<{
      vacName: string;
      lastDate: string;
      expiredDate: string;
    }>;
  }>;
}

/** Fetch vaccine laters from ClinicaOnline for the given date range */
export async function fetchVaccineLaters(fromDate: Date, toDate: Date): Promise<VaccineLater[]> {
  const fromStr = formatDateMMDDYYYY(fromDate);
  const toStr = formatDateMMDDYYYY(toDate);

  console.log(`[vaccine-scanner] Fetching laters from ${fromStr} to ${toStr}...`);

  const data = await callAsmx('GetVaccineLaters', {
    ForReport: 0,
    SortVaccine: 0,
    SortFollowup: 0,
    SortCity: 0,
    allBranches: 0,
    SortPatient: 0,
    PatientName: '',
    CheckConfirmed: 0,
    StartDate: '',
    StartID: 0,
    fromDate: fromStr,
    toDate: toStr,
    addOrSubstract: 0,
  });

  if (!Array.isArray(data)) {
    console.error('[vaccine-scanner] Unexpected response:', JSON.stringify(data).slice(0, 300));
    return [];
  }

  console.log(`[vaccine-scanner] Got ${data.length} raw records`);
  return data as VaccineLater[];
}

/** Filter and clean vaccine laters */
export function filterLaters(
  laters: VaccineLater[],
  options: {
    excludeWithAppointment?: boolean;
    excludeConfirmed?: boolean;
    minMonthsExpired?: number;
    onlyMandatory?: boolean;
  } = {}
): VaccineLater[] {
  const {
    excludeWithAppointment = true,
    excludeConfirmed = true,
    minMonthsExpired = 0,
    onlyMandatory = false,
  } = options;

  const MANDATORY_VACCINES = ['כלבת', 'משושה', 'מרובע', 'מתומן'];

  let filtered = laters.filter(item => {
    // Must have a phone number
    const phone = item.CellPhone || item.Phone || '';
    if (!phone || phone.length < 9) return false;

    // Skip confirmed
    if (excludeConfirmed && item.Confirmed === 1) return false;

    // Skip if already has an appointment
    if (excludeWithAppointment && item.NextAppointment && item.NextAppointment.trim()) return false;

    // Filter by minimum months expired
    if (minMonthsExpired > 0 && item.NextDate) {
      const expiredDate = new Date(item.NextDate);
      const now = new Date();
      const monthsDiff = (now.getTime() - expiredDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (monthsDiff < minMonthsExpired) return false;
    }

    // Only mandatory vaccines
    if (onlyMandatory) {
      const isMandate = MANDATORY_VACCINES.some(v => item.VacName.includes(v));
      if (!isMandate) return false;
    }

    return true;
  });

  console.log(`[vaccine-scanner] After filtering: ${filtered.length} records`);
  return filtered;
}

/** Group laters by owner (PatientID) to send one message per owner */
export function groupByOwner(laters: VaccineLater[]): GroupedReminder[] {
  const map = new Map<string, GroupedReminder>();

  for (const item of laters) {
    const key = item.PatientID;
    if (!map.has(key)) {
      map.set(key, {
        ownerName: item.UserName,
        ownerPhone: item.CellPhone || item.Phone || '',
        patientId: item.PatientID,
        pets: [],
      });
    }

    const group = map.get(key)!;
    let pet = group.pets.find(p => p.petId === item.PetID);
    if (!pet) {
      pet = { petName: item.PetName, petId: item.PetID, vaccines: [] };
      group.pets.push(pet);
    }

    // Avoid duplicate vaccine entries
    if (!pet.vaccines.some(v => v.vacName === item.VacName)) {
      pet.vaccines.push({
        vacName: item.VacName,
        lastDate: item.Date,
        expiredDate: item.NextDate,
      });
    }
  }

  const groups = Array.from(map.values());
  console.log(`[vaccine-scanner] Grouped into ${groups.length} owners`);
  return groups;
}
