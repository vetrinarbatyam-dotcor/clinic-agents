import 'dotenv/config';
import { callAsmx } from './shared/clinica';

// Warm up session
await callAsmx('GetLastPatients', { move: 0, fromDate: '' });

const methods = [
  'GetLastPatients', 'SearchByPhone', 'SearchByNameClinic', 'GetPatientPets',
  'GetPatientDetails', 'GetPatientHistory', 'GetAllPatients', 'GetPatients',
  'LoadPatient', 'GetClientDebts', 'GetClientBalance',
  'LoadPetDetails', 'LoadPetSessions', 'LoadPetVaccines', 'GetPetHistory',
  'LoadPetSession', 'GetPetLabs', 'LoadPetLabs', 'GetPetDocs',
  'GetPetPrescriptions', 'LoadPetPrescriptions', 'GetPetWeight',
  'GetPetAllergies', 'LoadPetAllergies',
  'EditPetSession', 'GetSessionDetails', 'LoadSession',
  'GetVisitTypes', 'GetReasons',
  'GetDayEvents', 'GetWeekEvents', 'GetMonthEvents',
  'GetCalendarEvents', 'LoadCalendar', 'GetSchedule',
  'GetAppointments', 'GetFreeSlots', 'GetAvailableSlots',
  'AddEvent', 'DeleteEvent', 'UpdateEvent',
  'GetTherapists', 'GetTherapistList', 'LoadTherapists',
  'GetStaff', 'GetDoctors',
  'GetInvoices', 'GetPayments', 'GetPriceList',
  'GetProducts', 'GetServices', 'GetItems',
  'LoadPriceList', 'GetClientDebts',
  'GetInsurancesList', 'GetInsuranceClaims', 'GetMarpet',
  'GetReport', 'GetDailyReport', 'GetStatistics',
  'GetDailySummary', 'GetMonthlyReport',
  'GetReminders', 'GetAlerts', 'GetNotifications',
  'GetFollowUps', 'GetNextVisits',
  'GetLabResults', 'LoadLabResults', 'GetLabOrders',
  'GetInventory', 'GetStock', 'GetMedicines',
  'GetMessages', 'GetSMS', 'GetEmailLog',
  'GetSettings', 'GetClinicInfo', 'GetClinicDetails',
  'GetCategories', 'GetSpecies', 'GetBreeds',
  'GetHospitalized', 'LoadHospitalized',
  'GetNotes', 'GetTasks', 'GetTodos',
  'GetWaitingList', 'GetQueue',
  'GetFormTemplates', 'GetForms',
  // More specific ones
  'GetVaccineTypes', 'GetTreatmentTypes', 'GetDiagnoses',
  'GetPetTypes', 'GetAnimalTypes', 'LoadAnimalTypes',
  'GetCities', 'GetCountries',
  'GetUserDetails', 'GetCurrentUser', 'GetLoggedUser',
  'GetClinicsList', 'GetClinics',
  'GetDebtList', 'GetDebts', 'LoadDebts',
  'GetDocuments', 'LoadDocuments',
  'GetPrescription', 'GetRx',
  'SearchPatient', 'SearchPet', 'SearchByID',
  'GetDaySchedule', 'GetDayAppointments', 'LoadDayEvents',
  'GetEventTypes', 'GetEventCategories',
  'GetAllEvents', 'LoadEvents', 'LoadAllEvents',
  'GetYomanEvents', 'LoadYoman', 'GetYoman',
  'GetDiary', 'LoadDiary', 'GetDiaryEvents',
  'GetTodayEvents', 'GetTodayPatients', 'GetTodayVisits',
  'GetRecentVisits', 'GetLastVisits', 'GetLastSessions',
  'GetSessionsByDate', 'GetVisitsByDate', 'LoadVisitsByDate',
  'GetAllSessions', 'LoadAllSessions',
  'GetClinicSessions', 'LoadClinicSessions',
  'GetDaySessions', 'LoadDaySessions',
];

const unique = [...new Set(methods)];
const working: string[] = [];
const needParams: string[] = [];

for (const m of unique) {
  try {
    const data = await callAsmx(m, {});
    const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
    let info = `${m} -> ${type}`;
    if (Array.isArray(data) && data.length > 0) {
      info += ` | keys: ${Object.keys(data[0]).slice(0, 10).join(', ')}`;
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      info += ` | keys: ${Object.keys(data).slice(0, 10).join(', ')}`;
    }
    working.push(info);
  } catch (e: any) {
    const msg = e?.message || '';
    if (msg.includes('Missing value for parameter')) {
      const match = msg.match(/parameter:\s*'([^']+)'/);
      const param = match ? match[1] : '?';
      needParams.push(`${m} -> needs: ${param}`);
    }
    // else: method doesn't exist, skip
  }
}

console.log('\n=== WORKING (no params) ===');
working.forEach(w => console.log(w));

console.log('\n=== NEED PARAMETERS ===');
needParams.forEach(n => console.log(n));

console.log(`\nTotal: ${working.length} working, ${needParams.length} need params, ${unique.length - working.length - needParams.length} not found`);
