import "dotenv/config";
import { callAsmx } from "./shared/clinica";

// Try with all discovered params at once
const paramsToTry = [
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0, OnlyNotDone: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0, OnlyNotDone: 0, AllBranches: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0, OnlyNotDone: 0, AllBranches: 0, DogsOnly: 0, CatsOnly: 0 },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0, OnlyNotDone: 0, AllBranches: 0, DogsOnly: 0, CatsOnly: 0, fromDate: "", toDate: "" },
  { ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0, SortPatient: 0, OnlyNotDone: 0, AllBranches: 0, DogsOnly: 0, CatsOnly: 0, fromDate: "", toDate: "", CustomerName: "" },
];

for (const params of paramsToTry) {
  try {
    const data = await callAsmx("GetVaccineLaters", params);
    if (data && !data.Message) {
      const type = Array.isArray(data) ? `array[${data.length}]` : typeof data;
      console.log(`SUCCESS: ${JSON.stringify(params)}`);
      console.log(`Type: ${type}, Count: ${Array.isArray(data) ? data.length : "N/A"}`);
      if (Array.isArray(data) && data.length > 0) {
        console.log(`Keys: ${Object.keys(data[0]).join(", ")}`);
        data.slice(0, 3).forEach((item, j) => {
          console.log(`  [${j}]: ${JSON.stringify(item).slice(0, 800)}`);
        });
      }
      break;
    } else if (data?.Message?.includes("Missing value")) {
      const match = data.Message.match(/parameter: '([^']+)'/);
      console.log(`Still missing: ${match?.[1]} (tried: ${Object.keys(params).join(",")})`);
    } else if (data?.Message) {
      console.log(`Other error: ${data.Message.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.log(`Exception: ${(e?.message || "").slice(0, 200)}`);
  }
}
