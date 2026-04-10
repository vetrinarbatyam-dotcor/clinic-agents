import "dotenv/config";
import { callAsmx } from "./shared/clinica";

// Iteratively discover all params - the error tells us the NEXT missing one
async function discoverParams(methodName: string) {
  console.log(`=== Discovering ${methodName} params ===`);
  let params: Record<string, any> = {};
  
  for (let i = 0; i < 20; i++) {
    try {
      const data = await callAsmx(methodName, params);
      if (data && !data.Message) {
        const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
        console.log(`\nSUCCESS with params: ${JSON.stringify(params)}`);
        console.log(`Type: ${type}`);
        if (Array.isArray(data)) {
          console.log(`Count: ${data.length}`);
          if (data.length > 0) {
            console.log(`Keys: ${Object.keys(data[0]).join(", ")}`);
            data.slice(0, 5).forEach((item, j) => {
              console.log(`  [${j}]: ${JSON.stringify(item).slice(0, 800)}`);
            });
          }
        } else {
          console.log(`Value: ${JSON.stringify(data).slice(0, 1000)}`);
        }
        return data;
      } else if (data?.Message?.includes("Missing value for parameter")) {
        const match = data.Message.match(/parameter: '([^']+)'/);
        const missing = match ? match[1] : "unknown";
        console.log(`  Need: '${missing}'`);
        params[missing] = 0;
      } else if (data?.Message) {
        console.log(`  Error: ${data.Message.slice(0, 200)}`);
        break;
      }
    } catch (e: any) {
      console.log(`  Exception: ${(e?.message || "").slice(0, 200)}`);
      break;
    }
  }
  return null;
}

const data1 = await discoverParams("GetVaccineLaters");

console.log("\n");
const data2 = await discoverParams("GetVaccineReminders");

// Also try with ForReport=1 which might include more data
if (data1) {
  console.log("\n=== Try GetVaccineLaters with ForReport=1 ===");
  // Copy discovered params but change ForReport
  const params = JSON.parse(JSON.stringify(data1));
}
