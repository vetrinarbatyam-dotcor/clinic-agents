import "dotenv/config";
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from "./shared/clinica";

const today = getIsraelDate();
const yearAgo = getIsraelDate(-365);
const twoYearsAgo = getIsraelDate(-730);
const todayStr = formatDateMMDDYYYY(today);
const yearAgoStr = formatDateMMDDYYYY(yearAgo);

// Test GetVaccineLaters with ForReport
console.log("=== GetVaccineLaters with ForReport ===");
const laterTests = [
  { ForReport: true },
  { ForReport: false },
  { ForReport: 0 },
  { ForReport: 1 },
  { ForReport: "0" },
  { ForReport: "1" },
  { ForReport: "true" },
  { ForReport: "false" },
];

for (const params of laterTests) {
  try {
    const data = await callAsmx("GetVaccineLaters", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nSUCCESS GetVaccineLaters(${JSON.stringify(params)}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   count: ${data.length}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 600)}`);
        if (data.length > 1) console.log(`   second: ${JSON.stringify(data[1]).slice(0, 600)}`);
        if (data.length > 2) console.log(`   third: ${JSON.stringify(data[2]).slice(0, 600)}`);
      } else if (typeof data === "string") {
        console.log(`   value: ${data.slice(0, 500)}`);
      } else {
        console.log(`   value: ${JSON.stringify(data).slice(0, 500)}`);
      }
      break;
    } else if (data?.Message) {
      console.log(`ERR (${JSON.stringify(params)}): ${data.Message.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.log(`FAIL (${JSON.stringify(params)}): ${(e?.message || "").slice(0, 200)}`);
  }
}

// Test LoadPetVaccines with fromDate + toDate
console.log("\n=== LoadPetVaccines with dates ===");
const testPetId = 861457;
try {
  const data = await callAsmx("LoadPetVaccines", { PetID: testPetId, fromDate: yearAgoStr, toDate: todayStr });
  if (data && !data.Message) {
    const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
    console.log(`SUCCESS LoadPetVaccines -> ${type}`);
    if (Array.isArray(data) && data.length > 0) {
      console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
      data.forEach((v, i) => console.log(`   [${i}]: ${JSON.stringify(v).slice(0, 500)}`));
    } else {
      console.log(`   value: ${JSON.stringify(data).slice(0, 500)}`);
    }
  } else if (data?.Message) {
    console.log(`ERR: ${data.Message.slice(0, 300)}`);
  }
} catch (e: any) {
  console.log(`FAIL: ${(e?.message || "").slice(0, 200)}`);
}

// Also try GetVaccineReminders with ForReport
console.log("\n=== GetVaccineReminders with ForReport ===");
for (const params of laterTests) {
  try {
    const data = await callAsmx("GetVaccineReminders", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`SUCCESS GetVaccineReminders(${JSON.stringify(params)}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   count: ${data.length}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 600)}`);
      }
      break;
    } else if (data?.Message) {
      console.log(`ERR (${JSON.stringify(params)}): ${data.Message.slice(0, 200)}`);
    }
  } catch {}
}
