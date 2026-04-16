import type { VaccineLater } from "./vaccine-fetcher";
import type { ReminderStage } from "./reminder-scheduler";
import { formatDueDateHebrew, loadConfig } from "./reminder-scheduler";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// Load template from DB config, fallback to .txt file
async function loadTemplate(stage: ReminderStage): Promise<string> {
  // Try DB first
  const config = await loadConfig();
  if (config?.templates?.[String(stage.stage)]) {
    return config.templates[String(stage.stage)];
  }

  // Fallback to file
  try {
    return readFileSync(join(TEMPLATES_DIR, stage.templateFile), "utf-8");
  } catch {
    return "שלום {ownerName}! 🐾\nתזכורת לגבי החיסון של {petName} 💉\nחיסון: {vaccineList}\nנשמח לתאם תור! ☎️";
  }
}

function fillTemplate(
  template: string,
  vaccine: VaccineLater,
  stage: ReminderStage,
  extras: { cta?: string; optOut?: string } = {},
): string {
  const dueFormatted = formatDueDateHebrew(vaccine.DueDateParsed);

  // Build vaccine list: single name or bullet list for consolidated vaccines
  const allVaccines = vaccine.additionalVaccines?.length
    ? [vaccine.VaccineName, ...vaccine.additionalVaccines]
    : [vaccine.VaccineName];
  const vaccineList = allVaccines.length > 1
    ? allVaccines.map(v => `• ${v}`).join("\n")
    : vaccine.VaccineName;

  const filled = template
    .replace(/{ownerName}/g, vaccine.OwnerName)
    .replace(/{petName}/g, vaccine.PetName)
    .replace(/{vaccineName}/g, vaccine.VaccineName)
    .replace(/{vaccineList}/g, vaccineList)
    .replace(/{dueDate}/g, dueFormatted)
    .replace(/{stage}/g, String(stage.stage))
    .replace(/{stageName}/g, stage.name)
    .replace(/{cta}/g, extras.cta ?? "")
    .replace(/{optOut}/g, extras.optOut ?? "");

  // Collapse 3+ newlines (left by empty cta/optOut) into 2, trim trailing whitespace
  return filled.replace(/\n{3,}/g, "\n\n").trim();
}

async function enrichWithAI(vaccine: VaccineLater, stage: ReminderStage, baseMessage: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) return baseMessage;

  const stageDesc = `${stage.name} — ${stage.description}`;
  const prompt = `אתה עוזר למרפאה וטרינרית לשפר הודעת תזכורת חיסון.

סוג תזכורת: ${stageDesc}
שם בעלים: ${vaccine.OwnerName}
שם חיה: ${vaccine.PetName} (${vaccine.PetType || "חיה"})
חיסון: ${vaccine.VaccineName}
ימים ${vaccine.DaysOverdue > 0 ? "באיחור" : "עד למועד"}: ${Math.abs(vaccine.DaysOverdue)}

ההודעה הנוכחית:
${baseMessage}

שפר את ההודעה:
- שמור על הטון החם והנעים
- הוסף מגע אישי קטן שמתאים לסוג החיה ולשלב התזכורת
- אל תשנה את המבנה הבסיסי
- עברית בלבד
- החזר רק את ההודעה המשופרת, בלי הסברים`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const improved = data.content?.[0]?.text?.trim();
    if (improved && improved.length > 20) return improved;
  } catch (e: any) {
    console.error("[ai] vaccine enrichment failed:", e.message);
  }
  return baseMessage;
}

export async function buildReminderMessage(
  vaccine: VaccineLater,
  stage: ReminderStage,
  useAI: boolean = false
): Promise<string> {
  const config = await loadConfig();
  const template = await loadTemplate(stage);
  const filled = fillTemplate(template, vaccine, stage, {
    cta: config?.cta,
    optOut: config?.optOut,
  });

  if (useAI && ANTHROPIC_API_KEY) {
    return enrichWithAI(vaccine, stage, filled);
  }

  return filled;
}
