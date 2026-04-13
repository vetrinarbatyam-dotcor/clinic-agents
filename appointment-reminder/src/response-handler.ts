import { callAsmx } from '../../shared/clinica';
import { pool, loadConfig, logRun } from './db';
import { DEFAULT_CONFIG, type ApptReminderConfig } from './config';
import { sendWhatsApp } from '../../shared/whatsapp';
import { classifyReply } from './claude-fallback';

export async function handleIncomingReply(phone: string, msg: string) {
  const cfgRow = await loadConfig();
  const cfg: ApptReminderConfig = { ...DEFAULT_CONFIG, ...(cfgRow || {}) };

  const r = await pool.query(`
    SELECT * FROM appt_reminders_sent
    WHERE phone=$1 AND replied_at IS NULL
      AND sent_at > NOW() - INTERVAL '48 hours'
    ORDER BY sent_at DESC LIMIT 1
  `, [phone]);
  const recent = r.rows[0];
  if (!recent) {
    await logRun('reply_no_match', phone, { msg });
    return { matched: false };
  }

  const norm = msg.trim().toLowerCase();
  const eventId = Number(recent.event_id);

  if (['1', 'כן', 'מאשר', 'מאשרת'].includes(norm)) {
    await callAsmx('setConfirmed', { EventID: eventId });
    await pool.query(`UPDATE appt_reminders_sent SET status='confirmed', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
    if (cfg.mode === 'live') await sendWhatsApp(phone, cfg.reply_confirmed);
    await logRun('reply_confirmed', phone, { event_id: eventId });
    return { matched: true, action: 'confirmed' };
  }

  if (['3', 'בטל', 'לבטל', 'ביטול'].includes(norm)) {
    await callAsmx('CancelEvent', { EventID: eventId, eventType: 1, creator: 0 });
    await pool.query(`UPDATE appt_reminders_sent SET status='canceled', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
    if (cfg.mode === 'live') {
      await sendWhatsApp(phone, cfg.reply_canceled);
      if (cfg.alert_team_on_cancel) await sendWhatsApp(cfg.team_alert_phone, `🔔 ביטול תור ${eventId} מ-${phone}`);
    }
    await logRun('reply_canceled', phone, { event_id: eventId });
    return { matched: true, action: 'canceled' };
  }

  if (['2', 'לדחות', 'דחה', 'דחייה'].includes(norm)) {
    await pool.query(`UPDATE appt_reminders_sent SET status='snoozed', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
    if (cfg.mode === 'live') await sendWhatsApp(phone, cfg.reply_snoozed);
    await logRun('reply_snoozed', phone, { event_id: eventId });
    return { matched: true, action: 'snoozed' };
  }

  // Unknown reply — try Claude AI classification before falling back to static message
  try {
    const classification = await classifyReply(msg, {
      pet_name: recent.pet_name,
      appointment_at: recent.appointment_at,
    });

    if (classification && classification.intent !== 'unknown') {
      // Claude understood the intent — route accordingly
      if (classification.intent === 'confirm') {
        await callAsmx('setConfirmed', { EventID: eventId });
        await pool.query(`UPDATE appt_reminders_sent SET status='confirmed', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
        if (cfg.mode === 'live') await sendWhatsApp(phone, classification.human_response);
        await logRun('reply_confirmed_ai', phone, { event_id: eventId, original: msg, ai_intent: 'confirm' });
        return { matched: true, action: 'confirmed', via: 'ai' };
      }

      if (classification.intent === 'cancel') {
        await callAsmx('CancelEvent', { EventID: eventId, eventType: 1, creator: 0 });
        await pool.query(`UPDATE appt_reminders_sent SET status='canceled', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
        if (cfg.mode === 'live') {
          await sendWhatsApp(phone, classification.human_response);
          if (cfg.alert_team_on_cancel) await sendWhatsApp(cfg.team_alert_phone, `🔔 ביטול תור ${eventId} מ-${phone} (AI: "${msg}")`);
        }
        await logRun('reply_canceled_ai', phone, { event_id: eventId, original: msg, ai_intent: 'cancel' });
        return { matched: true, action: 'canceled', via: 'ai' };
      }

      if (classification.intent === 'snooze') {
        await pool.query(`UPDATE appt_reminders_sent SET status='snoozed', replied_at=NOW(), reply_text=$2 WHERE id=$1`, [recent.id, msg]);
        if (cfg.mode === 'live') await sendWhatsApp(phone, classification.human_response);
        await logRun('reply_snoozed_ai', phone, { event_id: eventId, original: msg, ai_intent: 'snooze' });
        return { matched: true, action: 'snoozed', via: 'ai' };
      }
    }

    // Claude also returned unknown — use its human_response if available
    if (classification?.human_response) {
      if (cfg.mode === 'live') {
        await sendWhatsApp(phone, classification.human_response);
        if (cfg.alert_team_on_unknown_reply) await sendWhatsApp(cfg.team_alert_phone, `❓ תגובה לא ברורה מ-${phone}: '${msg}' (AI fallback)`);
      }
      await logRun('reply_unknown_ai', phone, { msg, ai_response: classification.human_response });
      return { matched: true, action: 'unknown', via: 'ai' };
    }
  } catch (err) {
    console.error('[response-handler] Claude fallback error:', err instanceof Error ? err.message : err);
    // Fall through to static unknown reply
  }

  // Final fallback — static unknown reply
  if (cfg.mode === 'live') {
    await sendWhatsApp(phone, cfg.reply_unknown);
    if (cfg.alert_team_on_unknown_reply) await sendWhatsApp(cfg.team_alert_phone, `❓ תגובה לא ברורה מ-${phone}: '${msg}'`);
  }
  await logRun('reply_unknown', phone, { msg });
  return { matched: true, action: 'unknown' };
}
