import "dotenv/config";
import { pool } from "../../shared/db";


async function run() {
  console.log("[snooze-release] Starting...");

  // Find snoozed entries whose snooze period has expired
  const { rows } = await pool.query(`
    SELECT id, phone, pet_name, vaccine_name FROM appt_booker_outbound_queue
    WHERE status = 'snoozed' AND snoozed_until <= NOW()
  `);

  console.log(`[snooze-release] Found ${rows.length} expired snoozes`);

  for (const row of rows) {
    await pool.query(
      `UPDATE appt_booker_outbound_queue
       SET status = 'sent_again', snoozed_until = NULL
       WHERE id = $1`,
      [row.id]
    );
    console.log(
      `[snooze-release] Released: ${row.phone} ${row.pet_name} ${row.vaccine_name}`
    );
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
