#!/usr/bin/env bun
// Enrich Postgres `clients` + `pets` from ClinicaOnline for every phone seen in VOXIA CDR.
// Runs weekly via cron; first run is manual and takes ~50 minutes.
// Fixes the "ישראל" placeholder problem by upserting real data per phone.

import { Database } from 'bun:sqlite';
import { callAsmx } from '/home/claude-user/clinic-agents/shared/clinica.ts';
import { pool } from '/home/claude-user/clinic-agents/shared/db';

const CALLS_DB = '/home/claude-user/clinic-agents/missed-caller/calls.db';
const LOOKBACK_DAYS = 90;
const EXTERNAL_PATTERN = "from_num GLOB '0[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' AND from_num != '035513649'";
const SLEEP_MS = 150; // polite delay between API calls

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normPhone(p: string): string {
  return (p || '').replace(/[^0-9]/g, '');
}

async function upsertClient(c: any): Promise<void> {
  const userId = c.UserID;
  if (!userId) return;
  await pool.query(`
    INSERT INTO clients (user_id, record_id, first_name, last_name, phone, cell_phone, cell_phone2,
      city, address, email, id_number, cust_number, not_active, sensitive, alert_type, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      record_id   = COALESCE(NULLIF(EXCLUDED.record_id, 0), clients.record_id),
      first_name  = COALESCE(NULLIF(EXCLUDED.first_name, ''), clients.first_name),
      last_name   = COALESCE(NULLIF(EXCLUDED.last_name, ''), clients.last_name),
      phone       = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone),
      cell_phone  = COALESCE(NULLIF(EXCLUDED.cell_phone, ''), clients.cell_phone),
      cell_phone2 = COALESCE(NULLIF(EXCLUDED.cell_phone2, ''), clients.cell_phone2),
      city        = COALESCE(NULLIF(EXCLUDED.city, ''), clients.city),
      address     = COALESCE(NULLIF(EXCLUDED.address, ''), clients.address),
      email       = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
      id_number   = COALESCE(NULLIF(EXCLUDED.id_number, ''), clients.id_number),
      cust_number = COALESCE(NULLIF(EXCLUDED.cust_number, ''), clients.cust_number),
      synced_at   = NOW()
  `, [
    userId, c.recordID || 0,
    c.FirstName || '', c.LastName || '',
    c.Phone || '', c.CellPhone || '', c.CellPhone2 || '',
    c.City || '', c.Address || '', c.Email || '',
    c.IDNumber || '', c.NumCust || '',
    c.NotActive ? 1 : 0, c.Sensitive ? 1 : 0, c.AlertType || 0,
  ]);
}

async function upsertPets(userId: string, pets: any[]): Promise<number> {
  let n = 0;
  for (const p of pets) {
    const petId = p.PetID;
    if (!petId) continue;
    const species = p.Type || '';          // ClinicaOnline: species is stored in "Type"
    const insurance = p.InsuranceName || '';
    const notActive = p.NotActive ? 1 : 0;
    try {
      await pool.query(`
        INSERT INTO pets (pet_id, user_id, name, species, breed, sex, weight, date_birth,
          elect_number, neutered, insurance_name, sensitive, jump_note, not_active, next_date, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
        ON CONFLICT (pet_id) DO UPDATE SET
          user_id        = EXCLUDED.user_id,
          name           = COALESCE(NULLIF(EXCLUDED.name, ''), pets.name),
          species        = COALESCE(NULLIF(EXCLUDED.species, ''), pets.species),
          breed          = COALESCE(NULLIF(EXCLUDED.breed, ''), pets.breed),
          sex            = COALESCE(NULLIF(EXCLUDED.sex, ''), pets.sex),
          weight         = COALESCE(NULLIF(EXCLUDED.weight::text, '')::numeric, pets.weight),
          date_birth     = COALESCE(NULLIF(EXCLUDED.date_birth, ''), pets.date_birth),
          elect_number   = COALESCE(NULLIF(EXCLUDED.elect_number, ''), pets.elect_number),
          neutered       = EXCLUDED.neutered,
          insurance_name = COALESCE(NULLIF(EXCLUDED.insurance_name, ''), pets.insurance_name),
          not_active     = EXCLUDED.not_active,
          synced_at      = NOW()
      `, [
        petId, userId, p.Name || '', species, p.Breed || '', p.Sex || '',
        Number(p.Weight) || null, p.DateBirth || '', p.ElectNumber || '',
        p.Neut ? 1 : 0, insurance, p.Sensitive ? 1 : 0, p.JumpNote || '',
        notActive, p.NextDate || '',
      ]);
      n++;
    } catch (e: any) {
      console.log(`  [pet ${petId}] skip: ${e.message || e}`);
    }
  }
  return n;
}

async function sendWa(phone: string, text: string) {
  const instance = process.env.CLINIC_WHATSAPP_INSTANCE;
  const token = process.env.CLINIC_WHATSAPP_TOKEN;
  if (!instance || !token) { console.log('[wa] no creds, skipping'); return; }
  const chatId = phone.replace(/[^0-9]/g, '').replace(/^0/, '972') + '@c.us';
  const url = `https://api.green-api.com/waInstance${instance}/sendMessage/${token}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: text }),
    });
    console.log('[wa] notified', phone);
  } catch (e: any) {
    console.log('[wa] error:', e.message || e);
  }
}

async function main() {
  const t0 = Date.now();
  console.log('========================================');
  console.log('  Caller Enrichment from ClinicaOnline');
  console.log('========================================');
  console.log(`lookback: ${LOOKBACK_DAYS} days, source: ${CALLS_DB}`);

  const db = new Database(CALLS_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT DISTINCT from_num FROM call_summary
    WHERE ts >= datetime('now', '-${LOOKBACK_DAYS} days')
      AND ${EXTERNAL_PATTERN}
  `).all() as Array<{ from_num: string }>;
  db.close();

  const phones = Array.from(new Set(rows.map(r => normPhone(r.from_num)).filter(p => p.length >= 9)));
  console.log(`${phones.length} unique external phones to enrich`);

  let found = 0, notFound = 0, petsUpserted = 0, errors = 0;
  let i = 0;
  for (const phone of phones) {
    i++;
    if (i % 50 === 0) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`[${i}/${phones.length}] elapsed=${elapsed}s  found=${found}  notFound=${notFound}  pets=${petsUpserted}`);
    }
    try {
      const res = await callAsmx('SearchByPhone', { PhoneNumber: phone, UserID: '', LastName: '' });
      if (!Array.isArray(res) || res.length === 0) { notFound++; continue; }
      const client = res[0];
      if (!client.UserID) { notFound++; continue; }

      // Skip obvious placeholders
      if (client.recordID === 8033 || (client.FirstName === 'ישראל' && client.LastName === '.')) {
        notFound++;
        continue;
      }

      await upsertClient(client);
      const pets = await callAsmx('GetPatientPets', { userid: client.UserID });
      if (Array.isArray(pets) && pets.length > 0) {
        petsUpserted += await upsertPets(client.UserID, pets);
      }
      found++;
    } catch (e: any) {
      errors++;
      if (errors <= 5) console.log(`  [${phone}] error: ${e.message || e}`);
    }
    await sleep(SLEEP_MS);
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  const summary =
    `✅ העשרת לקוחות הושלמה\n` +
    `—\n` +
    `טלפונים ייחודיים: ${phones.length}\n` +
    `נמצאו במערכת: ${found}\n` +
    `לא נמצאו: ${notFound}\n` +
    `חיות שעודכנו: ${petsUpserted}\n` +
    `שגיאות: ${errors}\n` +
    `משך: ${Math.floor(elapsed/60)} דק' ${elapsed%60} ש'\n` +
    `—\n` +
    `עכשיו הדשבורד יציג ביטוח לכל מתקשר שנמצא במערכת.`;

  console.log(summary);

  // Notify Gil
  await sendWa('0543123419', summary);

  await pool.end();
}

main().catch(async (e) => {
  console.error('[enrich] fatal:', e);
  await sendWa('0543123419', `❌ העשרת לקוחות נכשלה: ${e.message || e}`);
  try { await pool.end(); } catch {}
  process.exit(1);
});
