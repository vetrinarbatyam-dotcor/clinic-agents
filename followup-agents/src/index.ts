import 'dotenv/config';
import { getVisitsForDate, getIsraelDate, formatDateMMDDYYYY, isShabbatOrHoliday } from '../../shared/clinica';
import { sendWhatsApp } from '../../shared/whatsapp';
import { getAgent, insertPendingMessage, wasMessageSentToday } from '../../shared/supabase';
import { classifyVisit } from './classifier';
import { buildMessage } from './message-builder';

const DRY_RUN = process.argv.includes('--dry-run');
const GIL_PHONE = '0543123419';

async function run() {
  const today = getIsraelDate();
  console.log(`[followup] Starting ${DRY_RUN ? '(DRY RUN)' : ''} — ${today.toLocaleDateString('he-IL')}`);

  // Don't run on Shabbat/holidays
  if (isShabbatOrHoliday(today)) {
    console.log('[followup] Today is Shabbat/holiday. Skipping.');
    return;
  }

  // Get agent config from Supabase
  const agent = await getAgent('followup-agents');
  if (!agent) {
    console.error('[followup] Agent not found in DB.');
    return;
  }
  if (!agent.is_active) {
    console.log('[followup] Agent is disabled.');
    return;
  }

  // Determine which dates to check:
  // - Usually: yesterday
  // - If today is Sunday: check Thursday + Friday (skip Shabbat)
  const datesToCheck: Date[] = [];
  const yesterday = getIsraelDate(-1);

  if (today.getDay() === 0) {
    // Sunday — check Friday and Thursday (Shabbat was skipped)
    const friday = getIsraelDate(-1); // Saturday → we skip, so check Friday
    const thursday = getIsraelDate(-2);
    // Actually: Sunday -1 = Saturday, -2 = Friday, -3 = Thursday
    datesToCheck.push(getIsraelDate(-2)); // Friday
    // If Friday visits already got follow-up, they won't be sent again (duplicate check)
    // Also check Saturday in case there were emergency visits
    datesToCheck.push(getIsraelDate(-1)); // Saturday (might have visits like ברדס)
  } else {
    datesToCheck.push(yesterday);
  }

  const pending: Array<{ name: string; phone: string; pet: string; category: string; message: string }> = [];
  const skipped: string[] = [];

  for (const checkDate of datesToCheck) {
    const dateStr = formatDateMMDDYYYY(checkDate);
    console.log(`[followup] Checking visits for ${dateStr} (${checkDate.toLocaleDateString('he-IL')})`);

    const visits = await getVisitsForDate(dateStr);

    for (const visit of visits) {
      const classified = await classifyVisit(visit);
      if (!classified) {
        skipped.push(`${visit.ownerName} (${visit.petName}) — skipped`);
        continue;
      }

      if (!classified.ownerPhone) {
        skipped.push(`${classified.ownerName} (${classified.petName}) — no phone`);
        continue;
      }

      // Check duplicate
      const alreadySent = await wasMessageSentToday(agent.id, classified.ownerPhone);
      if (alreadySent) {
        console.log(`[followup] Skip duplicate: ${classified.ownerName}`);
        continue;
      }

      // Build message
      const useAI = agent.config?.messageMode !== 'templates';
      const message = await buildMessage(classified, useAI);

      if (DRY_RUN) {
        console.log(`\n--- DRY RUN ---`);
        console.log(`Category: ${classified.category}`);
        console.log(`To: ${classified.ownerName} (${classified.ownerPhone})`);
        console.log(`Pet: ${classified.petName}`);
        console.log(`Therapist: ${visit.therapistName}`);
        console.log(`Items: ${visit.items.length}`);
        console.log(`Details:\n${classified.details.slice(0, 300)}`);
        console.log(`Message:\n${message}`);
        console.log(`---------------\n`);
        continue;
      }

      await insertPendingMessage({
        agent_id: agent.id,
        client_name: classified.ownerName,
        client_phone: classified.ownerPhone,
        pet_name: classified.petName,
        category: classified.category,
        message_text: message,
        status: 'pending',
        approved_by: null,
        sent_at: null,
      });

      pending.push({
        name: classified.ownerName,
        phone: classified.ownerPhone,
        pet: classified.petName,
        category: classified.category,
        message,
      });
    }
  }

  if (skipped.length > 0) {
    console.log(`[followup] Skipped ${skipped.length}:`);
    skipped.forEach(s => console.log(`  - ${s}`));
  }

  if (DRY_RUN || pending.length === 0) {
    console.log(`[followup] Done. ${DRY_RUN ? 'Dry run complete.' : 'No messages to send.'}`);
    return;
  }

  // Send summary to Gil
  if (agent.config?.notifyGil !== false) {
    const categoryLabels: Record<string, string> = {
      medical: 'מקרה רפואי',
      'new-client': 'לקוח חדש',
      surgery: 'ניתוח',
    };

    const lines = pending.map((p, i) =>
      `${i + 1}. ${p.name} (${p.phone}) — ${categoryLabels[p.category] || p.category} — ${p.pet}`
    );

    const summary = [
      `🐾 הודעות מעקב — ${today.toLocaleDateString('he-IL')}`,
      '',
      `⏳ ממתינות לאישור: ${pending.length}`,
      '',
      ...lines,
      '',
      `👉 לאישור: http://167.86.69.208:3000`,
    ].join('\n');

    const result = await sendWhatsApp(GIL_PHONE, summary);
    console.log(`[followup] Summary sent to Gil: ${result.sent ? 'OK' : result.error}`);
  }

  console.log(`[followup] Done — ${pending.length} messages pending approval`);
}

run().catch(e => {
  console.error('[followup] Fatal error:', e);
  process.exit(1);
});
