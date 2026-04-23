#!/usr/bin/env bun
// Import insured-clients CSV from ClinicaOnline into clinicpal Postgres.
// For each phone: SearchByPhone → real UserID → GetPatientPets → upsert.
// Insurance_name trusted from CSV (source of truth), species/breed from API.

import { callAsmx } from '/home/claude-user/clinic-agents/shared/clinica.ts';
import { Client } from 'pg';
import { readFileSync } from 'fs';

const CSV_PATH = '/tmp/insured_report.csv';
const SLEEP_MS = 150;

function normPhone(s: string): string {
  return (s || '').replace(/[^0-9]/g, '');
}

function normalizeInsurance(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  const map: Record<string, string> = {
    'b friend': 'BeFriend', 'b פרנד': 'BeFriend', 'be friend': 'BeFriend',
    'befrand': 'BeFriend', 'בי פרנד': 'BeFriend', 'ביפרינד': 'BeFriend',
    'ביפרנד': 'BeFriend', 'ב פרנד': 'BeFriend',
    'פניקס': 'הפניקס', 'הפניקס': 'הפניקס',
  };
  return map[s] || (raw || '').trim();
}

function parseCsv(path: string): Array<{ name: string, phone: string, pet: string, insurance: string }> {
  // UTF-16 LE tab-delimited with BOM
  const buf = readFileSync(path);
  // Decode UTF-16 LE (skip BOM)
  const text = new TextDecoder('utf-16le').decode(buf.subarray(buf[0] === 0xFF && buf[1] === 0xFE ? 2 : 0));
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 5) continue;
    rows.push({
      name: parts[0]?.trim() || '',
      phone: (parts[2] || '').replace(/^="/, '').replace(/"$/, '').trim(),
      pet: parts[3]?.trim() || '',
      insurance: normalizeInsurance(parts[4] || ''),
    });
  }
  return rows;
}

async function sendWa(text: string) {
  const instance = process.env.CLINIC_WHATSAPP_INSTANCE;
  const token = process.env.CLINIC_WHATSAPP_TOKEN;
  if (!instance || !token) return;
  const url = `https://api.green-api.com/waInstance${instance}/sendMessage/${token}`;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: '972543123419@c.us', message: text }) });
  } catch {}
}

async function upsertClient(pg: Client, c: any) {
  await pg.query(`
    INSERT INTO clients (user_id, record_id, first_name, last_name, phone, cell_phone, cell_phone2,
      city, address, email, id_number, cust_number, not_active, sensitive, alert_type, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      record_id   = COALESCE(NULLIF(EXCLUDED.record_id, 0), clients.record_id),
      first_name  = COALESCE(NULLIF(EXCLUDED.first_name, ''), clients.first_name),
      last_name   = COALESCE(NULLIF(EXCLUDED.last_name, ''), clients.last_name),
      cell_phone  = COALESCE(NULLIF(EXCLUDED.cell_phone, ''), clients.cell_phone),
      city        = COALESCE(NULLIF(EXCLUDED.city, ''), clients.city),
      email       = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
      synced_at   = NOW()
  `, [
    c.UserID, c.recordID || 0,
    c.FirstName || '', c.LastName || '',
    c.Phone || '', c.CellPhone || '', c.CellPhone2 || '',
    c.City || '', c.Address || '', c.Email || '',
    c.IDNumber || '', c.NumCust || '',
    c.NotActive ? 1 : 0, c.Sensitive ? 1 : 0, c.AlertType || 0,
  ]);
}

async function upsertPet(pg: Client, userId: string, pet: any, insuranceFromCsv: string) {
  const insurance = insuranceFromCsv || pet.InsuranceName || '';
  await pg.query(`
    INSERT INTO pets (pet_id, user_id, name, species, breed, sex, weight, date_birth,
      elect_number, neutered, insurance_name, sensitive, jump_note, not_active, next_date, synced_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
    ON CONFLICT (pet_id) DO UPDATE SET
      user_id        = EXCLUDED.user_id,
      name           = COALESCE(NULLIF(EXCLUDED.name, ''), pets.name),
      species        = COALESCE(NULLIF(EXCLUDED.species, ''), pets.species),
      breed          = COALESCE(NULLIF(EXCLUDED.breed, ''), pets.breed),
      sex            = COALESCE(NULLIF(EXCLUDED.sex, ''), pets.sex),
      insurance_name = COALESCE(NULLIF(EXCLUDED.insurance_name, ''), pets.insurance_name),
      not_active     = EXCLUDED.not_active,
      synced_at      = NOW()
  `, [
    pet.PetID, userId, pet.Name || '', pet.Type || '', pet.Breed || '',
    pet.Sex || '', Number(pet.Weight) || null, pet.DateBirth || '',
    pet.ElectNumber || '', pet.Neut ? 1 : 0, insurance, pet.Sensitive ? 1 : 0,
    pet.JumpNote || '', pet.NotActive ? 1 : 0, pet.NextDate || '',
  ]);
}

async function main() {
  const t0 = Date.now();
  console.log('========================================');
  console.log('  Import Insured Clients from ClinicaOnline CSV');
  console.log('========================================');

  const rawRows = parseCsv(CSV_PATH);
  console.log(`CSV rows: ${rawRows.length}`);

  // Group by phone — each phone has multiple pets
  const byPhone = new Map<string, Array<{ name: string, pet: string, insurance: string }>>();
  for (const r of rawRows) {
    const digits = normPhone(r.phone);
    if (!digits || digits.length < 9) continue;
    if (!byPhone.has(digits)) byPhone.set(digits, []);
    byPhone.get(digits)!.push(r);
  }
  console.log(`Unique phones: ${byPhone.size}`);

  const pg = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await pg.connect();

  let found = 0, notFound = 0, petsUpserted = 0, errors = 0;
  let i = 0;
  for (const [phone, rows] of byPhone) {
    i++;
    if (i % 50 === 0) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`[${i}/${byPhone.size}] elapsed=${elapsed}s  found=${found}  notFound=${notFound}  pets=${petsUpserted}`);
    }
    try {
      const res: any = await callAsmx('SearchByPhone', { PhoneNumber: phone, UserID: '', LastName: '' });
      if (!Array.isArray(res) || !res.length) { notFound++; continue; }
      const client = res[0];
      // Skip known placeholder
      if (client.recordID === 8033 || (client.FirstName === 'ישראל' && client.LastName === '.')) {
        notFound++;
        continue;
      }
      await upsertClient(pg, client);

      const pets: any = await callAsmx('GetPatientPets', { userid: client.UserID });
      const apiPets = Array.isArray(pets) ? pets : [];

      // Build name→insurance map from CSV rows
      const csvByPet = new Map<string, string>();
      for (const r of rows) {
        if (r.pet) csvByPet.set(r.pet.trim(), r.insurance);
      }

      // Upsert each API pet, use CSV insurance if matching pet name exists
      for (const p of apiPets) {
        const petName = (p.Name || '').trim();
        const csvIns = csvByPet.get(petName) || '';
        await upsertPet(pg, client.UserID, p, csvIns);
        petsUpserted++;
      }
      found++;
    } catch (e: any) {
      errors++;
      if (errors <= 5) console.log(`  [${phone}] error: ${e.message || e}`);
    }
    await new Promise(r => setTimeout(r, SLEEP_MS));
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  const summary =
    `✅ ייבוא מבוטחים הושלם\n—\n` +
    `שורות CSV: ${rawRows.length}\n` +
    `טלפונים ייחודיים: ${byPhone.size}\n` +
    `נמצאו במערכת: ${found}\n` +
    `לא נמצאו: ${notFound}\n` +
    `חיות עודכנו: ${petsUpserted}\n` +
    `שגיאות: ${errors}\n` +
    `משך: ${Math.floor(elapsed/60)} דק' ${elapsed%60} ש'\n—\n` +
    `עכשיו הדשבורד מציג ביטוחים לכל מתקשר מבוטח.`;

  console.log(summary);
  await sendWa(summary);
  await pg.end();
}

main().catch(async (e) => {
  console.error('[import] fatal:', e);
  await sendWa(`❌ ייבוא מבוטחים נכשל: ${e.message || e}`);
  process.exit(1);
});
