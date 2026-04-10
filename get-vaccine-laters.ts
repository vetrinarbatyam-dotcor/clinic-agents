import "dotenv/config";
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from "./shared/clinica";

const today = getIsraelDate();
const todayStr = formatDateMMDDYYYY(today);
const yearAgoStr = formatDateMMDDYYYY(getIsraelDate(-365));

// Try different date combos and ForReport values
const tests = [
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, allBranches: 0, SortPatient: 0, PatientName: "", CheckConfirmed: 0, StartDate: "", StartID: 0, fromDate: "", toDate: "", addOrSubstract: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, allBranches: 0, SortPatient: 0, PatientName: "", CheckConfirmed: 0, StartDate: "", StartID: 0, fromDate: yearAgoStr, toDate: todayStr, addOrSubstract: 0 },
  { ForReport: 1, SortVaccine: 0, SortFollowup: 0, SortCity: 0, allBranches: 0, SortPatient: 0, PatientName: "", CheckConfirmed: 0, StartDate: "", StartID: 0, fromDate: "", toDate: "", addOrSubstract: 0 },
  { ForReport: 1, SortVaccine: 0, SortFollowup: 0, SortCity: 0, allBranches: 1, SortPatient: 0, PatientName: "", CheckConfirmed: 0, StartDate: "", StartID: 0, fromDate: "", toDate: "", addOrSubstract: 0 },
];

for (let t = 0; t < tests.length; t++) {
  const params = tests[t];
  try {
    const data = await callAsmx("GetVaccineLaters", params);
    const count = Array.isArray(data) ? data.length : "N/A";
    console.log(`\nTest ${t+1} (ForReport=${params.ForReport}, dates=${params.fromDate||"empty"}, allBranches=${params.allBranches}): count=${count}`);
    if (Array.isArray(data) && data.length > 0) {
      console.log(`Keys: ${Object.keys(data[0]).join(", ")}`);
      data.slice(0, 10).forEach((item, j) => {
        console.log(`  [${j}]: ${JSON.stringify(item).slice(0, 600)}`);
      });
    }
  } catch (e: any) {
    console.log(`Test ${t+1} Error: ${(e?.message || "").slice(0, 200)}`);
  }
}
