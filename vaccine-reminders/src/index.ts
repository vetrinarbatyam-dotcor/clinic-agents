import "dotenv/config";
import pg from "pg";
import { getIsraelDate, isShabbatOrHoliday } from "../../shared/clinica";
import { sendWhatsApp } from "../../shared/whatsapp";
import { fetchVaccineLaters, hasVisitedSinceDueDate } from "./vaccine-fetcher";
import { determineReminderStage, REMINDER_STAGES } from "./reminder-scheduler";
import { buildReminderMessage } from "./message-builder";

const DRY_RUN = process.argv.includes("--dry-run");
const GIL_PHONE = "0543123419";
const AGENT_NAME = "vaccine-reminders";

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "clinicpal",
  user: process.env.DB_USER || "clinicpal_user",
  password: process.env.DB_PASSWORD || "clinicpal2306",
});

async function getSentStages(petId: number, vaccineName: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT stage FROM vaccine_reminders
     WHERE pet_id = $1 AND vaccine_name = $2 AND status IN ('sent', 'pending', 'approved')`,
    [petId, vaccineName]
  );
  return rows.map((r: any) => r.stage);
}

async function insertReminder(record: {
  pet_id: number;
  pet_name: string;
  owner_name: string;
  owner_phone: string;
  vaccine_name: string;
  due_date: string;
  stage: number;
  status: string;
  message_text: string;
}): Promise<string | null> {
  const { rows } = await pool.query(
    `INSERT INTO vaccine_reminders (pet_id, pet_name, owner_name, owner_phone, vaccine_name, due_date, stage, status, message_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [record.pet_id, record.pet_name, record.owner_name, record.owner_phone,
     record.vaccine_name, record.due_date, record.stage, record.status, record.message_text]
  );
  return rows[0]?.id || null;
}

async function run() {
  const today = getIsraelDate();
  console.log(`[vaccine] Starting ${DRY_RUN ? "(DRY RUN)" : ""} — ${today.toLocaleDateString("he-IL")}`);

  if (isShabbatOrHoliday(today)) {
    console.log("[vaccine] Today is Shabbat/holiday. Skipping.");
    return;
  }

  const maxPerDay = 30;
  const toleranceDays = 2;

  // Fetch all pets with pending/overdue vaccines
  const vaccines = await fetchVaccineLaters();
  console.log(`[vaccine] Processing ${vaccines.length} pending vaccines...`);

  const pending: Array<{
    name: string;
    phone: string;
    pet: string;
    vaccine: string;
    stage: number;
    stageName: string;
    message: string;
  }> = [];
  const skipped: string[] = [];
  let processed = 0;

  for (const vaccine of vaccines) {
    if (pending.length >= maxPerDay) {
      console.log(`[vaccine] Reached daily limit of ${maxPerDay}`);
      break;
    }

    processed++;
    if (processed % 20 === 0) {
      console.log(`[vaccine] Processed ${processed}/${vaccines.length}...`);
    }

    // Check which stages were already sent
    const sentStages = await getSentStages(vaccine.PetID, vaccine.VaccineName);

    // Determine current reminder stage
    const stage = determineReminderStage(vaccine, sentStages, toleranceDays);
    if (!stage) {
      skipped.push(`${vaccine.OwnerName} (${vaccine.PetName}) — no stage match (overdue: ${vaccine.DaysOverdue}d)`);
      continue;
    }

    // For stages 2+ (after due date), check if pet visited the clinic
    if (stage.stage >= 2) {
      const visited = await hasVisitedSinceDueDate(vaccine.PetID, vaccine.DueDateParsed);
      if (visited) {
        await insertReminder({
          pet_id: vaccine.PetID,
          pet_name: vaccine.PetName,
          owner_name: vaccine.OwnerName,
          owner_phone: vaccine.OwnerPhone,
          vaccine_name: vaccine.VaccineName,
          due_date: vaccine.DueDate,
          stage: stage.stage,
          status: "skipped",
          message_text: "דילוג — הלקוח כבר ביקר במרפאה",
        });
        skipped.push(`${vaccine.OwnerName} (${vaccine.PetName}) — already visited`);
        continue;
      }
    }

    // Build the message
    const message = await buildReminderMessage(vaccine, stage, false);

    if (DRY_RUN) {
      console.log(`\n--- DRY RUN ---`);
      console.log(`Stage: ${stage.stage} (${stage.name})`);
      console.log(`To: ${vaccine.OwnerName} (${vaccine.OwnerPhone})`);
      console.log(`Pet: ${vaccine.PetName}`);
      console.log(`Vaccine: ${vaccine.VaccineName}`);
      console.log(`Due: ${vaccine.DueDate} (${vaccine.DaysOverdue}d overdue)`);
      console.log(`Message:\n${message}`);
      console.log(`---------------\n`);
      pending.push({
        name: vaccine.OwnerName,
        phone: vaccine.OwnerPhone,
        pet: vaccine.PetName,
        vaccine: vaccine.VaccineName,
        stage: stage.stage,
        stageName: stage.name,
        message,
      });
      continue;
    }

    // Insert as pending
    await insertReminder({
      pet_id: vaccine.PetID,
      pet_name: vaccine.PetName,
      owner_name: vaccine.OwnerName,
      owner_phone: vaccine.OwnerPhone,
      vaccine_name: vaccine.VaccineName,
      due_date: vaccine.DueDate,
      stage: stage.stage,
      status: "pending",
      message_text: message,
    });

    pending.push({
      name: vaccine.OwnerName,
      phone: vaccine.OwnerPhone,
      pet: vaccine.PetName,
      vaccine: vaccine.VaccineName,
      stage: stage.stage,
      stageName: stage.name,
      message,
    });
  }

  if (skipped.length > 0) {
    console.log(`[vaccine] Skipped ${skipped.length}:`);
    skipped.slice(0, 20).forEach((s) => console.log(`  - ${s}`));
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  if (DRY_RUN || pending.length === 0) {
    console.log(`[vaccine] Done. ${DRY_RUN ? "Dry run complete." : "No reminders to send."}`);
    await pool.end();
    return;
  }

  // Send summary to Gil
  const stageLabels: Record<number, string> = {
    1: "תזכורת מקדימה (שבוע לפני)",
    2: "תזכורת שנייה (3 ימים אחרי)",
    3: "תזכורת שלישית (17 ימים אחרי)",
    4: "תזכורת אחרונה (חודש אחרי)",
  };

  const lines = pending.map(
    (p, i) => `${i + 1}. ${p.name} — ${p.pet} — ${p.vaccine}\n   ${stageLabels[p.stage] || `שלב ${p.stage}`}`
  );

  const summary = [
    `💉 תזכורות חיסונים — ${today.toLocaleDateString("he-IL")}`,
    "",
    `⏳ ממתינות לאישור: ${pending.length}`,
    `⏭️ דולגו: ${skipped.length}`,
    "",
    ...lines,
    "",
    `👉 לאישור: http://167.86.69.208:3000`,
  ].join("\n");

  const result = await sendWhatsApp(GIL_PHONE, summary);
  console.log(`[vaccine] Summary sent to Gil: ${result.sent ? "OK" : result.error}`);

  console.log(`[vaccine] Done — ${pending.length} reminders pending`);
  await pool.end();
}

run().catch((e) => {
  console.error("[vaccine] Fatal error:", e);
  process.exit(1);
});
