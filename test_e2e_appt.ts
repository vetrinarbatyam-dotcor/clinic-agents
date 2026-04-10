// E2E test: scan tomorrow, build all reminders, send ALL to control phone 0543123419
import { callAsmx, formatDateMMDDYYYY } from './shared/clinica';
import { sendWhatsApp } from './shared/whatsapp';
import { mapTreatment, selectTemplateKey } from './appointment-reminder/src/treatment-mapper';
import { fillTemplate, formatHebrewDate, getHebrewDayName } from './appointment-reminder/src/templates';
import { DEFAULT_CONFIG, VACCINE_CALENDAR } from './appointment-reminder/src/config';
import { pool } from './appointment-reminder/src/db';

const CONTROL_PHONE = '0543123419';

function parseClinicaDate(s: string): Date {
  const m = s.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return new Date(s);
  const [_, mo, d, y, h, mi, se, ap] = m;
  let hh = Number(h);
  if (ap.toUpperCase() === 'PM' && hh < 12) hh += 12;
  if (ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
  return new Date(Number(y), Number(mo)-1, Number(d), hh, Number(mi), Number(se));
}

const target = new Date(Date.now() + 24*3600_000);
const dayStr = formatDateMMDDYYYY(target);
console.log(`📅 Scanning ${dayStr} (tomorrow)`);

const r = await callAsmx('GetAllClinicData', {
  ShowNotActive: 0, sSelected: dayStr, UserID: VACCINE_CALENDAR, pannel: 0,
});
const events: any[] = r.listEvents || [];
console.log(`Found ${events.length} events`);

// Build header summary
const summary = `🧪 *בדיקת E2E — סוכן תזכורות תורים*\n📅 תורים ל-${dayStr}\nסה"כ: ${events.filter(e=>e.PatientID).length} תורים\nהכל נשלח לטלפון בקרה (לא ללקוחות)\n\nשולח דוגמאות ↓`;
console.log('\n=== sending header ===');
const h = await sendWhatsApp(CONTROL_PHONE, summary);
console.log(h);

let sent = 0, skipped = 0;
const breakdown: Record<string, number> = {};

for (const ev of events) {
  if (!ev.PatientID) { skipped++; continue; }
  const begin = parseClinicaDate(ev.BeginDate);
  const type = mapTreatment(ev);
  breakdown[type] = (breakdown[type]||0)+1;
  const tplKey = selectTemplateKey(type, '6');
  const tpl = DEFAULT_CONFIG.templates[tplKey];

  let petName = 'החיה שלך';
  const m2 = (ev.eventNotes || '').match(/שם החיה:\s*([^\n,|]+)/);
  if (m2) petName = m2[1].trim();

  // Look up real phone (just to log it, NOT to send)
  let realPhone = ev.cellphone || ev.phone || '';
  if (!realPhone && ev.PatientID) {
    const q = await pool.query('SELECT phone FROM clients WHERE user_id = $1 LIMIT 1', [ev.PatientID]);
    realPhone = q.rows[0]?.phone || '(no phone in DB)';
  }

  const header = `🔍 *תור #${ev.EventID}* | ${type}\n👤 לקוח: ${ev.Description}\n🐾 חיה: ${petName}\n📞 טלפון אמיתי: ${realPhone || '(אין)'}\n────────────`;

  const msg = fillTemplate(tpl, {
    client_name: ev.Description || '',
    pet_name: petName,
    date: formatHebrewDate(begin),
    time: begin.toTimeString().slice(0,5),
    day_name: getHebrewDayName(begin),
    treatment_name: ev.TreatmentName || '',
  });

  const fullMsg = `${header}\n${msg}`;

  // Log to DB (shadow)
  await pool.query(`
    INSERT INTO appt_reminders_sent
    (event_id, phone, patient_id, pet_name, therapist_id, treatment_type,
     appointment_at, reminder_type, status, message_body)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'24h','test_e2e',$8)
    ON CONFLICT (event_id, reminder_type) DO UPDATE SET status='test_e2e', sent_at=NOW(), message_body=EXCLUDED.message_body
  `, [ev.EventID, CONTROL_PHONE, ev.PatientID, petName, ev.UserID || VACCINE_CALENDAR, type, begin.toISOString(), fullMsg]);

  // Actually send to control phone
  const res = await sendWhatsApp(CONTROL_PHONE, fullMsg);
  if (res.sent) sent++;
  console.log(`#${ev.EventID} ${type} → ${res.sent ? '✅' : '❌ ' + res.error}`);

  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 1500));
}

const footer = `\n📊 *סיכום בדיקה*\n✅ נשלחו: ${sent}\n⏭ דולגו (אין לקוח): ${skipped}\n\n📈 פילוח טיפולים:\n${Object.entries(breakdown).map(([k,v])=>`• ${k}: ${v}`).join('\n')}`;
console.log(footer);
await sendWhatsApp(CONTROL_PHONE, footer);

console.log('\n✅ E2E done');
process.exit(0);
