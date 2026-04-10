/**
 * marpet-audit/src/post-audit.ts
 *
 * Runs AFTER claude-headless audit pipeline finishes.
 * Reads bikoret_{date}.xlsx → writes to Supabase + WhatsApp Gil + emails the file.
 *
 * Usage: bun run post-audit.ts YYYY-MM-DD
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { supabase } from '../../shared/supabase';
import { sendWhatsApp } from '../../shared/whatsapp';
// @ts-ignore
import * as XLSX from 'xlsx';

const GIL_PHONE = '0543123419';
const EMAIL_TO = 'vetcenter85@gmail.com';
const MARPAT_DIR = '/home/claude-user/marpat';

const dateIso = process.argv[2];
if (!dateIso) {
  console.error('Usage: bun run post-audit.ts YYYY-MM-DD');
  process.exit(1);
}
const [yyyy, mm, dd] = dateIso.split('-');
const dateHuman = `${dd}/${mm}/${yyyy}`;
const excelPath = `${MARPAT_DIR}/bikoret_${dateIso}.xlsx`;

async function main() {
  const { data: runRow, error: runErr } = await supabase
    .from('marpet_audit_runs')
    .upsert(
      { audit_date: dateIso, status: 'running', run_started_at: new Date().toISOString() },
      { onConflict: 'audit_date' }
    )
    .select()
    .single();
  if (runErr) throw runErr;
  const runId = runRow.id;

  if (!existsSync(excelPath)) {
    await supabase.from('marpet_audit_runs').update({
      status: 'failed',
      error_message: `Excel not found: ${excelPath}`,
      run_finished_at: new Date().toISOString(),
    }).eq('id', runId);
    await sendWhatsApp(GIL_PHONE, `❌ ביקורת מרפט ${dateHuman} נכשלה — לא נוצר Excel.\nלוג: ${MARPAT_DIR}/logs/run-${dateIso}.log`);
    process.exit(1);
  }

  const wb = XLSX.readFile(excelPath);
  const lost = wb.Sheets['תביעות אבודות'] ? XLSX.utils.sheet_to_json<any>(wb.Sheets['תביעות אבודות']) : [];
  const missVac = wb.Sheets['חיסונים חסרים'] ? XLSX.utils.sheet_to_json<any>(wb.Sheets['חיסונים חסרים']) : [];
  const orphans = wb.Sheets['יתומים במרפאט'] ? XLSX.utils.sheet_to_json<any>(wb.Sheets['יתומים במרפאט']) : [];

  const totalLostNis = lost.reduce((s, r) => s + (Number(r['מחיר'] || r['מחיר פריט'] || 0) || 0), 0);

  const findings: any[] = [];
  for (const r of lost) findings.push({
    run_id: runId, audit_date: dateIso, category: 'lost_claim',
    client_name: r['שם הלקוח'] || r['שם לקוח'], pet_name: r['שם החיה'],
    item_name: r['פריט'] || r['פריט במחירון'],
    price_nis: Number(r['מחיר'] || r['מחיר פריט'] || 0) || null,
    raw_data: r,
  });
  for (const r of missVac) findings.push({
    run_id: runId, audit_date: dateIso, category: 'missing_vaccine',
    client_name: r['שם הלקוח'] || r['שם לקוח'], pet_name: r['שם החיה'],
    item_name: r['חיסון'] || r['פריט'], raw_data: r,
  });
  for (const r of orphans) findings.push({
    run_id: runId, audit_date: dateIso, category: 'orphan',
    client_name: r['שם הלקוח'] || r['שם לקוח'], pet_name: r['שם החיה'],
    item_name: r['פריט'] || r['חיסון'], raw_data: r,
  });

  if (findings.length) {
    await supabase.from('marpet_audit_findings').delete().eq('audit_date', dateIso);
    const { error: findErr } = await supabase.from('marpet_audit_findings').insert(findings);
    if (findErr) console.error('findings insert error:', findErr);
  }

  let waMsg = `ביקורת מרפט ✅ — ${dateHuman}\n\n`;
  waMsg += `תביעות אבודות: ${lost.length} (₪${totalLostNis.toFixed(0)})\n`;
  waMsg += `חיסונים חסרים: ${missVac.length}\n`;
  waMsg += `יתומים במרפאט: ${orphans.length}\n\n`;
  if (lost.length) {
    waMsg += `פירוט:\n`;
    for (const r of lost.slice(0, 10)) {
      waMsg += `• ${r['שם הלקוח'] || ''} | ${r['שם החיה'] || ''} | ${r['פריט'] || ''} | ₪${r['מחיר'] || 0}\n`;
    }
    if (lost.length > 10) waMsg += `...ועוד ${lost.length - 10}\n`;
  }
  waMsg += `\nהדוח המלא נשלח ל-${EMAIL_TO}`;
  const waResult = await sendWhatsApp(GIL_PHONE, waMsg);

  let emailSent = false;
  try {
    const subject = `ביקורת מרפט יומית — ${dateHuman}`;
    const body = `ביקורת מרפט ל-${dateHuman}\n\nתביעות אבודות: ${lost.length} (₪${totalLostNis.toFixed(0)})\nחיסונים חסרים: ${missVac.length}\nיתומים במרפאט: ${orphans.length}\n\nמצורף קובץ הביקורת המלא.`;
    const sendPrompt = `Use Gmail MCP to send email NOW without confirmation. To: ${EMAIL_TO}. Subject: ${subject}. Body: ${body}. Attachment: ${excelPath}. Output "EMAIL_SENT" after sending.`;
    const out = execSync(`claude -p ${JSON.stringify(sendPrompt)} --output-format text`, { encoding: 'utf8', timeout: 180_000 });
    emailSent = /EMAIL_SENT/.test(out);
  } catch (e: any) {
    console.error('email send failed:', e.message);
  }

  await supabase.from('marpet_audit_runs').update({
    status: 'success',
    run_finished_at: new Date().toISOString(),
    lost_claims: lost.length,
    missing_vaccines: missVac.length,
    orphans: orphans.length,
    total_lost_nis: totalLostNis,
    excel_path: excelPath,
    email_sent: emailSent,
    whatsapp_sent: waResult.sent,
  }).eq('id', runId);

  console.log(`[post-audit] done. lost=${lost.length} missVac=${missVac.length} orphans=${orphans.length} email=${emailSent} wa=${waResult.sent}`);
}

main().catch(async (e) => {
  console.error(e);
  await sendWhatsApp(GIL_PHONE, `❌ post-audit ${dateHuman}: ${e.message}`);
  process.exit(1);
});
