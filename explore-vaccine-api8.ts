import "dotenv/config";
import { callAsmx } from "./shared/clinica";

async function discover(method: string) {
  let params: Record<string, any> = {};
  for (let i = 0; i < 25; i++) {
    try {
      const data = await callAsmx(method, params);
      if (data && !data.Message) {
        const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
        console.log(`\nSUCCESS ${method}`);
        console.log(`Params: ${JSON.stringify(params)}`);
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
        return { params, data };
      } else if (data?.Message) {
        const msg = data.Message;
        const paramMatch = msg.match(/parameter: '([^']+)'/i);
        if (paramMatch) {
          const missing = paramMatch[1];
          console.log(`  [${i+1}] Need: '${missing}'`);
          params[missing] = 0;
        } else {
          console.log(`  [${i+1}] Error: ${msg.slice(0, 300)}`);
          break;
        }
      }
    } catch (e: any) {
      console.log(`  [${i+1}] Exception: ${(e?.message || "").slice(0, 200)}`);
      break;
    }
  }
  console.log(`Final params: ${JSON.stringify(params)}`);
  return null;
}

const result = await discover("GetVaccineLaters");
