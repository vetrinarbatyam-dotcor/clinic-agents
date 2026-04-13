// PetConnect — Weekly sync: enrich clients + pets from ClinicaOnline API
// Fills: species, breed, date_birth, weight, sex, neutered, insurance_name, next_date (pets)
//        last_visit, num_pets, client_debt (clients)

import 'dotenv/config';
import { pool } from '../../shared/db';
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from '../../shared/clinica.ts';


// ============ Upsert client with full details ============
async function upsertClientFull(client: any): Promise<void> {
  const userId = client.UserID || client.userid;
  if (!userId) return;

  await pool.query(`
    INSERT INTO clients (user_id, record_id, first_name, last_name, phone, cell_phone, cell_phone2, city, address, email, id_number, cust_number, not_active, sensitive, alert_type, synced_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      record_id    = COALESCE(NULLIF(EXCLUDED.record_id, 0), clients.record_id),
      first_name   = COALESCE(NULLIF(EXCLUDED.first_name, ''), clients.first_name),
      last_name    = COALESCE(NULLIF(EXCLUDED.last_name, ''), clients.last_name),
      phone        = COALESCE(NULLIF(EXCLUDED.phone, ''), clients.phone),
      cell_phone   = COALESCE(NULLIF(EXCLUDED.cell_phone, ''), clients.cell_phone),
      cell_phone2  = COALESCE(NULLIF(EXCLUDED.cell_phone2, ''), clients.cell_phone2),
      city         = COALESCE(NULLIF(EXCLUDED.city, ''), clients.city),
      address      = COALESCE(NULLIF(EXCLUDED.address, ''), clients.address),
      email        = COALESCE(NULLIF(EXCLUDED.email, ''), clients.email),
      id_number    = COALESCE(NULLIF(EXCLUDED.id_number, ''), clients.id_number),
      cust_number  = COALESCE(NULLIF(EXCLUDED.cust_number, ''), clients.cust_number),
      synced_at    = NOW()
  `, [
    userId,
    client.recordID || client.RecordID || null,
    client.FirstName || '',
    client.LastName || '',
    client.Phone || '',
    client.CellPhone || '',
    client.CellPhone2 || '',
    client.City || '',
    client.Address || '',
    client.Email || '',
    client.IDNumber || '',
    client.CustNumber || '',
    client.NotActive || 0,
    client.Sensitive || 0,
    client.AlertType || 0,
  ]);
}

// ============ Sync clients via diary scan (5 years back) ============
// This is the comprehensive scan: walks every weekday in last N years,
// extracts all unique PatientIDs from the daily diary, then fetches
// full client details (Address, Email, etc.) for any new ones.
async function syncClientsFromDiary(yearsBack = 5): Promise<number> {
  console.log(`[sync] Scanning diary for last ${yearsBack} years to find all clients...`);

  const { rows: existing } = await pool.query('SELECT user_id FROM clients');
  const existingIds = new Set(existing.map(r => r.user_id));
  console.log(`[sync] Currently have ${existingIds.size} clients in DB`);

  // Collect unique patient IDs from diary
  const allPatientIds = new Set<string>();
  const totalDays = yearsBack * 365;
  const startDate = getIsraelDate(-totalDays);
  let daysScanned = 0;
  let lastLog = Date.now();

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);

    // Skip Saturdays (clinic closed)
    if (d.getDay() === 6) continue;

    const dateStr = formatDateMMDDYYYY(d);
    daysScanned++;

    try {
      const data = await callAsmx('GetAllClinicData', {
        ShowNotActive: 0, sSelected: dateStr, UserID: '', pannel: 0,
      });

      const events = data?.listEvents || [];
      for (const ev of events) {
        const pid = ev.PatientID;
        if (pid && pid.length > 10) {
          allPatientIds.add(pid);
        }
      }
    } catch {
      // Skip failed days
    }

    // Progress log every 10 seconds
    if (Date.now() - lastLog > 10000) {
      console.log(`[sync] Diary scan: ${daysScanned}/${totalDays * 6/7 | 0} days, ${allPatientIds.size} unique patients found`);
      lastLog = Date.now();
    }
  }

  console.log(`[sync] Diary scan complete: ${daysScanned} days, ${allPatientIds.size} unique patients`);

  // Fetch full details for new patients only
  const newIds = Array.from(allPatientIds).filter(id => !existingIds.has(id));
  console.log(`[sync] ${newIds.length} new patients to fetch (${allPatientIds.size - newIds.length} already in DB)`);

  let newCount = 0;
  let fetched = 0;

  for (const userId of newIds) {
    fetched++;
    if (fetched % 50 === 0) {
      console.log(`[sync] Fetching new clients: ${fetched}/${newIds.length}, ${newCount} added`);
    }

    try {
      const results = await callAsmx('SearchByPhone', {
        PhoneNumber: '', UserID: userId, LastName: '',
      });

      if (Array.isArray(results) && results.length > 0) {
        const client = results[0];
        client.UserID = userId; // Ensure UserID is set
        await upsertClientFull(client);
        existingIds.add(userId);
        newCount++;
      }
    } catch {
      // Skip failed lookups
    }
  }

  console.log(`[sync] Added ${newCount} new clients from diary scan`);

  // Also refresh existing clients' details (address/email may have been updated)
  console.log('[sync] Refreshing details for existing clients...');
  const existingArr = Array.from(existingIds);
  let refreshed = 0;

  for (let i = 0; i < existingArr.length; i++) {
    if (i % 100 === 0) {
      console.log(`[sync] Refreshing: ${i}/${existingArr.length}`);
    }

    try {
      const results = await callAsmx('SearchByPhone', {
        PhoneNumber: '', UserID: existingArr[i], LastName: '',
      });

      if (Array.isArray(results) && results.length > 0) {
        const client = results[0];
        client.UserID = existingArr[i];
        await upsertClientFull(client);
        refreshed++;
      }
    } catch {
      // Skip
    }
  }

  console.log(`[sync] Refreshed ${refreshed} existing clients`);
  return newCount;
}

// Legacy function — kept for compatibility, uses limited alphabet scan
async function syncNewClients(): Promise<number> {
  return syncClientsFromDiary(5);
}

// ============ Sync pets for all clients ============
async function syncPets(): Promise<number> {
  console.log('[sync] Syncing pets for all clients...');

  const { rows: clients } = await pool.query('SELECT user_id FROM clients WHERE not_active = 0 OR not_active IS NULL');
  let updated = 0;
  let checked = 0;

  for (const client of clients) {
    checked++;
    if (checked % 50 === 0) {
      console.log(`[sync] Pets: ${checked}/${clients.length} clients checked, ${updated} pets updated`);
    }

    try {
      const pets = await callAsmx('GetPatientPets', { userid: client.user_id });
      if (!Array.isArray(pets)) continue;

      for (const pet of pets) {
        const petId = pet.PetID || pet.petID;
        if (!petId) continue;

        await pool.query(`
          INSERT INTO pets (pet_id, user_id, name, not_active)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (pet_id) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, pets.name),
            not_active = COALESCE(EXCLUDED.not_active, pets.not_active),
            synced_at = NOW()
        `, [
          petId,
          client.user_id,
          pet.PetName || pet.petName || pet.Name || '',
          pet.NotActive || 0,
        ]);
      }
      updated += pets.length;
    } catch {
      // Skip failed clients
    }
  }

  console.log(`[sync] Synced ${updated} pets from ${checked} clients`);
  return updated;
}

// ============ Enrich pet details (breed, species, birth, weight, insurance) ============
async function enrichPetDetails(): Promise<number> {
  console.log('[sync] Enriching pet details from ClinicaOnline...');

  const { rows: pets } = await pool.query(`
    SELECT pet_id FROM pets
    WHERE (not_active = 0 OR not_active IS NULL)
  `);

  let enriched = 0;
  let checked = 0;

  for (const pet of pets) {
    checked++;
    if (checked % 50 === 0) {
      console.log(`[sync] Details: ${checked}/${pets.length} pets, ${enriched} enriched`);
    }

    try {
      const details = await callAsmx('LoadPetDetails', { PetID: pet.pet_id });
      if (!details) continue;

      // API returns: Type (not PetType/Species), Breed, DateBirth (with time), Weight, Sex (number), Neut, InsuranceName
      const species = details.Type || details.PetType || details.petType || '';
      const breed = details.Breed || details.breed || '';
      // DateBirth comes as "10/19/2010 12:00:00 AM" — strip time part
      const rawBirth = details.DateBirth || details.dateBirth || details.BirthDate || '';
      const dateBirth = rawBirth.includes(' ') ? rawBirth.split(' ')[0] : rawBirth;
      const weight = parseFloat(details.Weight || details.weight || '0') || 0;
      const sex = String(details.Sex ?? details.sex ?? '');
      const neutered = details.Neut || details.Neutered || details.neutered || 0;
      const insuranceName = details.InsuranceName || details.insuranceName || '';
      const nextDate = details.NextDate || details.nextDate || '';
      const electNumber = details.ElectNumber || details.electNumber || '';

      await pool.query(`
        UPDATE pets SET
          species = CASE WHEN $1 != '' THEN $1 ELSE species END,
          breed = CASE WHEN $2 != '' THEN $2 ELSE breed END,
          date_birth = CASE WHEN $3 != '' THEN $3 ELSE date_birth END,
          weight = CASE WHEN $4 > 0 THEN $4 ELSE weight END,
          sex = CASE WHEN $5 != '' AND $5 != '0' THEN $5 ELSE sex END,
          neutered = CASE WHEN $6 > 0 THEN $6 ELSE neutered END,
          insurance_name = CASE WHEN $7 != '' THEN $7 ELSE insurance_name END,
          next_date = CASE WHEN $8 != '' THEN $8 ELSE next_date END,
          elect_number = CASE WHEN $9 != '' THEN $9 ELSE elect_number END,
          synced_at = NOW()
        WHERE pet_id = $10
      `, [species, breed, dateBirth, weight, sex, neutered, insuranceName, nextDate, electNumber, pet.pet_id]);

      enriched++;
    } catch {
      // Skip failed lookups
    }
  }

  console.log(`[sync] Enriched ${enriched}/${pets.length} pets`);
  return enriched;
}

// ============ Update last_visit for all clients ============
async function updateLastVisits(): Promise<number> {
  console.log('[sync] Updating last visit dates...');

  const { rows: clients } = await pool.query(`
    SELECT c.user_id, array_agg(p.pet_id) as pet_ids
    FROM clients c
    JOIN pets p ON p.user_id = c.user_id AND (p.not_active = 0 OR p.not_active IS NULL)
    WHERE c.not_active = 0 OR c.not_active IS NULL
    GROUP BY c.user_id
  `);

  const toDate = formatDateMMDDYYYY(getIsraelDate());
  const fromDate = formatDateMMDDYYYY(getIsraelDate(-730)); // 2 years back
  let updated = 0;
  let checked = 0;

  for (const client of clients) {
    checked++;
    if (checked % 50 === 0) {
      console.log(`[sync] Visits: ${checked}/${clients.length} clients, ${updated} updated`);
    }

    let latestVisit: Date | null = null;

    for (const petId of client.pet_ids) {
      try {
        const sessions = await callAsmx('LoadPetSessions', {
          Anam: '', All: 1,
          fromDate, toDate,
          PetID: petId, withWatch: 0,
        });

        if (!Array.isArray(sessions)) continue;

        for (const s of sessions) {
          const dateStr = s.Session?.Date || s.Date;
          if (!dateStr) continue;
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) continue;

          if (!latestVisit || d > latestVisit) latestVisit = d;
        }
      } catch {
        // Skip
      }
    }

    if (latestVisit) {
      await pool.query(`
        UPDATE clients SET
          last_visit = $1,
          num_pets = $2,
          synced_at = NOW()
        WHERE user_id = $3
      `, [
        latestVisit.toISOString().split('T')[0],
        client.pet_ids.length,
        client.user_id,
      ]);
      updated++;
    }
  }

  console.log(`[sync] Updated last_visit for ${updated}/${clients.length} clients`);
  return updated;
}

// ============ Update client debts ============
async function updateDebts(): Promise<number> {
  console.log('[sync] Updating client debts...');

  const { rows: clients } = await pool.query('SELECT user_id FROM clients WHERE not_active = 0 OR not_active IS NULL');
  let updated = 0;
  let checked = 0;

  for (const client of clients) {
    checked++;
    if (checked % 100 === 0) {
      console.log(`[sync] Debts: ${checked}/${clients.length}`);
    }

    try {
      const debt = await callAsmx('GetClientDebts', { PatientID: client.user_id });
      const amount = parseFloat(debt?.Balance || debt?.balance || '0') || 0;

      if (amount !== 0) {
        await pool.query('UPDATE clients SET client_debt = $1, synced_at = NOW() WHERE user_id = $2', [amount, client.user_id]);
        updated++;
      }
    } catch {
      // Skip
    }
  }

  console.log(`[sync] Updated debts for ${updated} clients`);
  return updated;
}

// ============ Main ============
async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const skipNewClients = args.includes('--skip-new-clients');
  const skipVisits = args.includes('--skip-visits');
  const skipDebts = args.includes('--skip-debts');
  const onlyDetails = args.includes('--only-details');

  console.log('========================================');
  console.log('  PetConnect - Client Data Sync');
  console.log('  סנכרון נתוני לקוחות מקליניקה אונליין');
  console.log('========================================');
  console.log(`Started at: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`);
  console.log('');

  const results: Record<string, number> = {};

  if (onlyDetails) {
    results.enrichedPets = await enrichPetDetails();
  } else {
    if (!skipNewClients) {
      results.newClients = await syncNewClients();
    }

    results.syncedPets = await syncPets();
    results.enrichedPets = await enrichPetDetails();

    if (!skipVisits) {
      results.updatedVisits = await updateLastVisits();
    }

    if (!skipDebts) {
      results.updatedDebts = await updateDebts();
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log('');
  console.log('========================================');
  console.log('  סיכום סנכרון');
  console.log('----------------------------------------');
  for (const [key, val] of Object.entries(results)) {
    console.log(`  ${key}: ${val}`);
  }
  console.log(`  Duration: ${elapsed}s`);
  console.log('========================================');

  await pool.end();
}

main().catch(e => {
  console.error('[sync] Fatal error:', e);
  process.exit(1);
});
