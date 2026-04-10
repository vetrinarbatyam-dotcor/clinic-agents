import "dotenv/config";
import { callAsmx } from "./shared/clinica";

const methods = [
  { name: "GetLaters", params: {} },
  { name: "GetLaters", params: { type: 1 } },
  { name: "GetLaters", params: { Type: "1" } },
  { name: "GetVaccineLaters", params: {} },
  { name: "GetVaccineReminders", params: {} },
  { name: "GetReminders", params: {} },
  { name: "LoadLaters", params: {} },
  { name: "LoadReminders", params: {} },
  { name: "GetVaccines", params: {} },
  { name: "LoadVaccines", params: {} },
  { name: "GetVaccinationList", params: {} },
  { name: "GetExpiredVaccines", params: {} },
  { name: "GetVaccineList", params: {} },
  { name: "GetLateVaccines", params: {} },
  { name: "GetPendingVaccines", params: {} },
  { name: "GetReminderList", params: {} },
  { name: "GetAllVaccines", params: {} },
];

console.log("Testing vaccine-related ASMX methods...\n");
for (const m of methods) {
  try {
    const data = await callAsmx(m.name, m.params);
    const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
    let info = `OK ${m.name}(${JSON.stringify(m.params)}) -> ${type}`;
    if (Array.isArray(data) && data.length > 0) {
      info += `\n   keys: ${Object.keys(data[0]).join(", ")}`;
      info += `\n   sample: ${JSON.stringify(data[0]).slice(0, 400)}`;
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      info += `\n   keys: ${Object.keys(data).join(", ")}`;
    } else if (typeof data === "string") {
      info += `\n   value: ${data.slice(0, 300)}`;
    }
    console.log(info);
  } catch (e: any) {
    const msg = e?.message || "";
    if (msg.includes("Missing value")) {
      console.log(`NEEDS_PARAM ${m.name}(${JSON.stringify(m.params)}) -> ${msg.slice(0, 150)}`);
    }
  }
}

// Try LoadPetVaccines with real pet IDs from DB
console.log("\n=== Testing LoadPetVaccines with real pets ===");
const { default: pg } = await import("pg");
const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "clinicpal",
  user: process.env.DB_USER || "clinicpal_user",
  password: process.env.DB_PASSWORD || "clinicpal2306",
});

const { rows: pets } = await pool.query("SELECT pet_id, name FROM pets WHERE not_active IS NULL OR not_active = 0 LIMIT 5");
await pool.end();

for (const pet of pets) {
  try {
    const data = await callAsmx("LoadPetVaccines", { PetID: pet.pet_id });
    if (data) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`\nOK LoadPetVaccines(${pet.pet_id}=${pet.name}) -> ${type}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`   keys: ${Object.keys(data[0]).join(", ")}`);
        console.log(`   first: ${JSON.stringify(data[0]).slice(0, 500)}`);
      } else {
        console.log(`   value: ${JSON.stringify(data).slice(0, 500)}`);
      }
    }
  } catch (e: any) {
    console.log(`FAIL LoadPetVaccines(${pet.pet_id}=${pet.name}): ${(e?.message || "").slice(0, 200)}`);
  }
}
