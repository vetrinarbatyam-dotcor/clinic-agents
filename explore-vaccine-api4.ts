import "dotenv/config";
import { callAsmx } from "./shared/clinica";

// Iteratively discover all required params for GetVaccineLaters
console.log("=== Discovering GetVaccineLaters params ===");

let params: Record<string, any> = { ForReport: 0, SortVaccine: 0 };
let maxTries = 15;

for (let i = 0; i < maxTries; i++) {
  try {
    const data = await callAsmx("GetVaccineLaters", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nSUCCESS! params: ${JSON.stringify(params)}`);
      console.log(`Result type: ${type}`);
      if (Array.isArray(data)) {
        console.log(`Count: ${data.length}`);
        if (data.length > 0) {
          console.log(`Keys: ${Object.keys(data[0]).join(", ")}`);
          data.slice(0, 5).forEach((item, j) => {
            console.log(`[${j}]: ${JSON.stringify(item).slice(0, 800)}`);
          });
        }
      } else if (typeof data === "string") {
        console.log(`Value: ${data.slice(0, 1000)}`);
      } else {
        console.log(`Value: ${JSON.stringify(data).slice(0, 1000)}`);
      }
      break;
    } else if (data?.Message?.includes("Missing value for parameter")) {
      const match = data.Message.match(/parameter: '([^']+)'/);
      const missing = match ? match[1] : "unknown";
      console.log(`Step ${i+1}: need param '${missing}' (current: ${JSON.stringify(params)})`);
      // Try common defaults
      params[missing] = 0;
    } else if (data?.Message) {
      console.log(`Error at step ${i+1}: ${data.Message.slice(0, 300)}`);
      break;
    }
  } catch (e: any) {
    console.log(`Exception at step ${i+1}: ${(e?.message || "").slice(0, 200)}`);
    break;
  }
}

// Also try GetVaccineReminders
console.log("\n\n=== Discovering GetVaccineReminders params ===");
let params2: Record<string, any> = { ForReport: 0, SortVaccine: 0 };

for (let i = 0; i < maxTries; i++) {
  try {
    const data = await callAsmx("GetVaccineReminders", params2);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nSUCCESS! params: ${JSON.stringify(params2)}`);
      console.log(`Result type: ${type}`);
      if (Array.isArray(data)) {
        console.log(`Count: ${data.length}`);
        if (data.length > 0) {
          console.log(`Keys: ${Object.keys(data[0]).join(", ")}`);
          data.slice(0, 5).forEach((item, j) => {
            console.log(`[${j}]: ${JSON.stringify(item).slice(0, 800)}`);
          });
        }
      } else {
        console.log(`Value: ${JSON.stringify(data).slice(0, 1000)}`);
      }
      break;
    } else if (data?.Message?.includes("Missing value for parameter")) {
      const match = data.Message.match(/parameter: '([^']+)'/);
      const missing = match ? match[1] : "unknown";
      console.log(`Step ${i+1}: need param '${missing}' (current: ${JSON.stringify(params2)})`);
      params2[missing] = 0;
    } else if (data?.Message) {
      console.log(`Error at step ${i+1}: ${data.Message.slice(0, 300)}`);
      break;
    }
  } catch (e: any) {
    console.log(`Exception at step ${i+1}: ${(e?.message || "").slice(0, 200)}`);
    break;
  }
}
