import "dotenv/config";
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from "./shared/clinica";

const today = getIsraelDate();
const yearAgo = getIsraelDate(-365);
const twoYearsAgo = getIsraelDate(-730);
const todayStr = formatDateMMDDYYYY(today);
const yearAgoStr = formatDateMMDDYYYY(yearAgo);
const twoYearsAgoStr = formatDateMMDDYYYY(twoYearsAgo);

console.log("Dates:", { todayStr, yearAgoStr, twoYearsAgoStr });

// Test LoadPetVaccines with dates
const testPetId = 861457; // בטי
const vaccineTests = [
  { PetID: testPetId, fromDate: yearAgoStr },
  { PetID: testPetId, fromDate: yearAgoStr, toDate: todayStr },
  { PetID: testPetId, fromDate: twoYearsAgoStr, toDate: todayStr },
];

console.log("\n=== LoadPetVaccines with dates ===");
for (const params of vaccineTests) {
  try {
    const data = await callAsmx("LoadPetVaccines", params);
    const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
    console.log(`\nOK LoadPetVaccines(${JSON.stringify(params)}) -> ${type}`);
    if (Array.isArray(data) && data.length > 0) {
      console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
      data.forEach((v, i) => console.log(`   [${i}]: ${JSON.stringify(v).slice(0, 500)}`));
    } else if (data && typeof data === "object") {
      if (data.Message) {
        console.log(`   error: ${data.Message.slice(0, 300)}`);
      } else {
        console.log(`   value: ${JSON.stringify(data).slice(0, 500)}`);
      }
    }
    break; // Stop on first success
  } catch (e: any) {
    console.log(`FAIL: ${(e?.message || "").slice(0, 200)}`);
  }
}

// Test GetVaccineLaters and GetVaccineReminders with various params
console.log("\n=== GetVaccineLaters with various params ===");
const laterTests = [
  { type: 1 },
  { Type: 1 },
  { type: "1" },
  { lateType: 1 },
  { filterType: 1 },
  { selectlaters: 1 },
  { Selectlaters: 1 },
  { filter: 1 },
  { Filter: 1 },
  { Status: 1 },
  { status: 1 },
  { All: 1 },
  { mode: 1 },
  { byType: 1 },
  {},
  { type: 1, fromDate: yearAgoStr },
  { fromDate: yearAgoStr, toDate: todayStr },
];

for (const params of laterTests) {
  try {
    const data = await callAsmx("GetVaccineLaters", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nOK GetVaccineLaters(${JSON.stringify(params)}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 500)}`);
      } else {
        console.log(`   value: ${JSON.stringify(data).slice(0, 500)}`);
      }
      break;
    } else if (data?.Message) {
      console.log(`ERR GetVaccineLaters(${JSON.stringify(params)}): ${data.Message.slice(0, 200)}`);
    }
  } catch (e: any) {
    // skip
  }
}

// Try GetVaccineReminders
console.log("\n=== GetVaccineReminders with various params ===");
for (const params of laterTests) {
  try {
    const data = await callAsmx("GetVaccineReminders", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nOK GetVaccineReminders(${JSON.stringify(params)}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 500)}`);
      }
      break;
    } else if (data?.Message) {
      console.log(`ERR GetVaccineReminders(${JSON.stringify(params)}): ${data.Message.slice(0, 200)}`);
    }
  } catch {}
}

// Try related methods that might work
console.log("\n=== Other methods ===");
const otherMethods = [
  { name: "GetLaters", params: { type: 1 } },
  { name: "GetLaters", params: { LaterType: 1 } },
  { name: "GetLaters", params: { laterType: 1 } },
  { name: "GetLaters", params: { mode: 1 } },
  { name: "GetLaters", params: {} },
  { name: "LoadLaters", params: { type: 1 } },
  { name: "LoadLaters", params: {} },
  { name: "GetLatePatients", params: {} },
  { name: "GetLatePatients", params: { type: 1 } },
  { name: "LoadVaccineLaters", params: {} },
  { name: "GetVaccineLateList", params: {} },
  { name: "GetLateVaccinations", params: {} },
  { name: "GetInsuredVaccinesReport", params: { fromDate: yearAgoStr, toDate: todayStr } },
];

for (const m of otherMethods) {
  try {
    const data = await callAsmx(m.name, m.params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`OK ${m.name}(${JSON.stringify(m.params)}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 500)}`);
      }
    } else if (data?.Message?.includes("Missing value")) {
      console.log(`NEEDS_PARAM ${m.name}: ${data.Message.slice(0, 200)}`);
    }
  } catch {}
}
