import { callAsmx, formatDateMMDDYYYY } from '../../shared/clinica';
import { pool, loadConfig, logRun } from './db';
import { mapTreatment, selectTemplateKey } from './treatment-mapper';
import { fillTemplate, formatHebrewDate, getHebrewDayName } from './templates';
import { DEFAULT_CONFIG, VACCINE_CALENDAR, type ApptReminderConfig } from './config';
import { sendWhatsApp } from '../../shared/whatsapp';

function parseClinicaDate(s: string): Date {
  // "4/9/2026 10:40:00 AM" — MM/D/YYYY h:mm:ss AM/PM
  const m = s.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return new Date(s);
  let [_, mo, d, y, h, mi, se, ap] = m;
  let hh = Number(h);
  if (ap.toUpperCase() === 'PM' && hh < 12) hh += 12;
  if (ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
  return new Date(Number(y), Number(mo)-1, Number(d), hh, Number(mi), Number(se));
}

async function getPhoneForPatient(patientId: string): Promise<string | null> {
  if (!patientId) return null;
  const r = await pool.query("SELECT COALESCE(NULLIF(cell_phone,''), NULLIF(cell_phone2,''), NULLIF(phone,'')) AS phone FROM clients WHERE user_id = $1 LIMIT 1", [patientId]);
  return r.rows[0]?.phone || null;
}

export async function scanAndProcess(opts: { dryRun?: boolean } = {}) {
  const cfgRow = await loadConfig();
  const cfg: ApptReminderConfig = { ...DEFAULT_CONFIG, ...(cfgRow || {}) };
  if (!cfg.enabled) {
    console.log('[scanner] disabled');
    return { scanned: 0, queued: 0 };
  }

  const now = new Date();
  // Target window: ~24h ahead (±1h)
  const target = new Date(now.getTime() + 24 * 3600_000);
  const dayStr = formatDateMMDDYYYY(target);
  console.log(`[scanner] mode=${cfg.mode} target_day=${dayStr}`);

  const calId = cfg.target_calendars[0] || VACCINE_CALENDAR;
  const resp = await callAsmx('GetAllClinicData', {
    ShowNotActive: 0, sSelected: dayStr, UserID: calId, pannel: 0,
  });
  const events: any[] = resp?.listEvents || [];
  console.log(`[scanner] got ${events.length} events for ${dayStr}`);

  let queued = 0;
  const windowStart = new Date(target.getTime() - 60*60_000);
  const windowEnd = new Date(target.getTime() + 60*60_000);

  for (const ev of events) {
    if (queued >= cfg.max_reminders_per_run) break;
    const begin = parseClinicaDate(ev.BeginDate);
    if (begin < windowStart || begin > windowEnd) continue;
    if (cfg.skip_confirmed_manually && ev.Confirmed === 1) continue;
    if (!ev.PatientID) continue; // placeholder slot

    // Already sent?
    const exists = await pool.query(
      `SELECT 1 FROM appt_reminders_sent WHERE event_id=$1 AND reminder_type='24h'`,
      [ev.EventID],
    );
    if (exists.rowCount) continue;

    // Phone resolution
    let phone = ev.cellphone || ev.phone || '';
    if (!phone) phone = (await getPhoneForPatient(ev.PatientID)) || '';
    if (!phone) {
      // No phone — alert clinic instead of silently skipping
      const alertMsg = `⚠️ לא נשלחה תזכורת
לקוח: ${ev.Description}
תור: ${begin.toLocaleString('he-IL')}
סיבה: אין מספר טלפון במערכת
Event: ${ev.EventID}`;
      if (cfg.mode === 'live') {
        try { await sendWhatsApp(cfg.team_alert_phone, alertMsg); } catch {}
      } else {
        console.log('[no-phone alert]', alertMsg);
      }
      await logRun('no_phone_alert', null, { event_id: ev.EventID, client: ev.Description });
      continue;
    }

    const treatmentType = mapTreatment(ev);
    const tplKey = selectTemplateKey(treatmentType, cfg.template_mode);
    const tpl = cfg.templates[tplKey] || cfg.templates.generic;

    // Pet name from eventNotes ("...שם החיה: X")
    let petName = 'החיה שלך';
    const m = (ev.eventNotes || '').match(/שם החיה:\s*([^\n,|]+)/);
    if (m) petName = m[1].trim();

    const msg = fillTemplate(tpl, {
      client_name: ev.Description || '',
      pet_name: petName,
      date: formatHebrewDate(begin),
      time: begin.toTimeString().slice(0,5),
      day_name: getHebrewDayName(begin),
      treatment_name: ev.TreatmentName || '',
    });

    if (opts.dryRun || cfg.mode === 'shadow') {
      console.log(`\n--- [SHADOW] event ${ev.EventID} → ${phone} (${treatmentType})`);
      console.log(msg);
    } else if (cfg.mode === 'live') {
      // TODO: green API send
    }

    await pool.query(`
      INSERT INTO appt_reminders_sent
      (event_id, phone, patient_id, pet_name, therapist_id, treatment_type,
       appointment_at, reminder_type, status, message_body)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'24h',$8,$9)
      ON CONFLICT (event_id, reminder_type) DO NOTHING
    `, [ev.EventID, phone, ev.PatientID, petName, ev.UserID || calId,
        treatmentType, begin.toISOString(), cfg.mode === 'live' ? 'sent' : 'shadow', msg]);

    await logRun('reminder_queued', phone, { event_id: ev.EventID, type: treatmentType, mode: cfg.mode });
    queued++;
  }

  console.log(`[scanner] done — queued=${queued}`);
  return { scanned: events.length, queued };
}

if (import.meta.main) {
  scanAndProcess({ dryRun: process.argv.includes('--dry-run') })
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
