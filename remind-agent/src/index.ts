import 'dotenv/config';
import { getIsraelDate, isShabbatOrHoliday } from '../../shared/clinica';
import { sendWhatsApp } from '../../shared/whatsapp';
import { getAgent, insertPendingMessage, wasMessageSentToday } from '../../shared/supabase';
import { fetchVaccineLaters, filterLaters, groupByOwner } from './vaccine-scanner';
import { runDeepScan } from './vaccine-deep-scan';
import { buildMessage } from './message-builder';

const DRY_RUN = process.argv.includes('--dry-run');
const DEEP_SCAN = process.argv.includes('--deep-scan');
const FROM_CRON = process.argv.includes('--cron');
const GIL_PHONE = '0543123419';

function parseYearsArg(): number {
  const idx = process.argv.indexOf('--years');
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1]) || 3;
  }
  return 3;
}

async function run() {
  const today = getIsraelDate();
  const mode = DEEP_SCAN ? 'deep-scan' : 'regular';
  console.log(`[remind] Starting ${mode} ${DRY_RUN ? '(DRY RUN)' : ''} — ${today.toLocaleDateString('he-IL')}`);

  if (!DEEP_SCAN && isShabbatOrHoliday(today)) {
    console.log('[remind] Today is Shabbat/holiday. Skipping.');
    return;
  }

  const agent = await getAgent('remind-agent');
  if (!agent) {
    console.error('[remind] Agent not found in DB. Add it to the agents table first.');
    return;
  }
  if (!agent.is_active) {
    console.log('[remind] Agent is disabled.');
    return;
  }

  const config = agent.config || {};

  // Double-toggle gate: when invoked from cron (--cron), BOTH flags must be on in DB.
  // Manual runs (without --cron) bypass this gate. This prevents accidental automated
  // runs while allowing on-demand operation from dashboard/CLI.
  if (FROM_CRON) {
    if (!config.cron_enabled || !config.cron_confirmed) {
      console.log(`[remind] --cron invocation blocked: cron_enabled=${!!config.cron_enabled}, cron_confirmed=${!!config.cron_confirmed}. Set BOTH to true in remind-agent config to enable scheduled runs.`);
      return;
    }
    console.log('[remind] --cron invocation passed double-toggle gate.');
  }
  let grouped;
  let category: 'vaccine-expired' | 'deep-scan';

  if (DEEP_SCAN) {
    category = 'deep-scan';
    const years = parseYearsArg();
    grouped = await runDeepScan({
      years,
      minMonthsExpired: config.minMonthsExpired ?? 3,
      onlyMandatory: config.onlyMandatory ?? false,
      excludeWithAppointment: config.excludeWithAppointment ?? true,
      dryRun: DRY_RUN,
    });
  } else {
    category = 'vaccine-expired';
    const fromDate = getIsraelDate(-365);
    const toDate = getIsraelDate();
    const raw = await fetchVaccineLaters(fromDate, toDate);
    const filtered = filterLaters(raw, {
      excludeWithAppointment: true,
      excludeConfirmed: true,
    });
    grouped = groupByOwner(filtered);
  }

  const pending: Array<{ name: string; phone: string; pets: string; message: string }> = [];
  const skipped: string[] = [];

  for (const reminder of grouped) {
    if (!reminder.ownerPhone || reminder.ownerPhone.length < 9) {
      skipped.push(`${reminder.ownerName} — no phone`);
      continue;
    }

    const alreadySent = await wasMessageSentToday(agent.id, reminder.ownerPhone);
    if (alreadySent) {
      skipped.push(`${reminder.ownerName} — already sent today`);
      continue;
    }

    const message = buildMessage(reminder, category);
    const petSummary = reminder.pets
      .map(p => `${p.petName} (${p.vaccines.map(v => v.vacName).join(', ')})`)
      .join('; ');

    if (DRY_RUN) {
      console.log(`\n--- DRY RUN ---`);
      console.log(`To: ${reminder.ownerName} (${reminder.ownerPhone})`);
      console.log(`Pets: ${petSummary}`);
      console.log(`Category: ${category}`);
      console.log(`Message:\n${message}`);
      console.log(`---------------\n`);
      continue;
    }

    await insertPendingMessage({
      agent_id: agent.id,
      client_name: reminder.ownerName,
      client_phone: reminder.ownerPhone,
      pet_name: reminder.pets.map(p => p.petName).join(', '),
      category,
      message_text: message,
      status: 'pending',
      approved_by: null,
      sent_at: null,
    });

    pending.push({
      name: reminder.ownerName,
      phone: reminder.ownerPhone,
      pets: petSummary,
      message,
    });
  }

  if (skipped.length > 0) {
    console.log(`[remind] Skipped ${skipped.length}:`);
    skipped.slice(0, 20).forEach(s => console.log(`  - ${s}`));
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  if (DRY_RUN || pending.length === 0) {
    console.log(`[remind] Done. ${DRY_RUN ? `Dry run: ${grouped.length} reminders found.` : 'No messages to send.'}`);
    return;
  }

  // Send summary to Gil
  if (config.notifyGil !== false) {
    const modeLabel = DEEP_SCAN ? '🔍 חיפוש מיוחד' : '💉 תזכורות חיסונים';
    const lines = pending.slice(0, 15).map((p, i) =>
      `${i + 1}. ${p.name} (${p.phone}) — ${p.pets}`
    );

    const summary = [
      `${modeLabel} — ${today.toLocaleDateString('he-IL')}`,
      '',
      `⏳ ממתינות לאישור: ${pending.length}`,
      ...(pending.length > 15 ? [`(מציג 15 מתוך ${pending.length})`] : []),
      '',
      ...lines,
      '',
      `👉 לאישור: http://167.86.69.208:3000`,
    ].join('\n');

    const result = await sendWhatsApp(GIL_PHONE, summary);
    console.log(`[remind] Summary sent to Gil: ${result.sent ? 'OK' : result.error}`);
  }

  console.log(`[remind] Done — ${pending.length} messages pending approval`);
}

run().catch(e => {
  console.error('[remind] Fatal error:', e);
  process.exit(1);
});
