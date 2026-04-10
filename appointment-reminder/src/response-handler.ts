import { callAsmx } from '../../shared/clinica';
import { pool, loadConfig, logRun } from './db';
import { DEFAULT_CONFIG, type ApptReminderConfig } from './config';
import { sendWhatsApp } from '../../shared/whatsapp';

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

  // Unknown
  if (cfg.mode === 'live') {
    await sendWhatsApp(phone, cfg.reply_unknown);
    if (cfg.alert_team_on_unknown_reply) await sendWhatsApp(cfg.team_alert_phone, `❓ תגובה לא ברורה מ-${phone}: '${msg}'`);
  }
  await logRun('reply_unknown', phone, { msg });
  return { matched: true, action: 'unknown' };
}
