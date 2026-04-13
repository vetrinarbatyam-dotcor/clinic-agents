// Data Warehouse Agent — Main sync engine
// Pulls all data from ClinicaOnline into local PostgreSQL clone
//
// Usage:
//   bun run warehouse:initial      # 7-year full initial sync (~5-6 hours)
//   bun run warehouse:hourly       # Appointments only (~30s)
//   bun run warehouse:daily        # Yesterday + clients + debts (~10min)
//   bun run warehouse:weekly       # Full pet rescan (~45min)
//   bun run warehouse:therapists   # Therapists only (~10s)

import 'dotenv/config';
import { pool } from '../../shared/db';
import { callAsmx, formatDateMMDDYYYY, getIsraelDate } from '../../shared/clinica.ts';


// ============ Sync run tracking ============
async function startRun(layer: string, tableName: string | null = null, triggeredBy = 'cron'): Promise<number> {
  const { rows } = await pool.query(`
    INSERT INTO sync_runs (layer, table_name, status, triggered_by)
    VALUES ($1, $2, 'running', $3)
    RETURNING id
  `, [layer, tableName, triggeredBy]);
  return rows[0].id;
}

async function finishRun(id: number, status: 'success' | 'failed', counts: { added?: number; updated?: number; failed?: number }, error?: string) {
  await pool.query(`
    UPDATE sync_runs
    SET status = $1, finished_at = NOW(),
        duration_sec = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
        rows_added = $2, rows_updated = $3, rows_failed = $4,
        error_message = $5
    WHERE id = $6
  `, [status, counts.added || 0, counts.updated || 0, counts.failed || 0, error || null, id]);
}

// ============ Therapists ============
export async function syncTherapists(): Promise<{ added: number; updated: number }> {
  const runId = await startRun('therapists', 'therapists');
  let added = 0, updated = 0;

  try {
    const ther = await callAsmx('LoadTherapists', {});
    if (!Array.isArray(ther)) throw new Error('LoadTherapists returned non-array');

    for (const t of ther) {
      const id = t.TherapistID || t.therapistID;
      if (!id) continue;

      const result = await pool.query(`
        INSERT INTO therapists (therapist_id, name, id_number, type, is_registered, branches, rights, raw, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (therapist_id) DO UPDATE SET
          name = EXCLUDED.name,
          id_number = EXCLUDED.id_number,
          type = EXCLUDED.type,
          is_registered = EXCLUDED.is_registered,
          branches = EXCLUDED.branches,
          rights = EXCLUDED.rights,
          raw = EXCLUDED.raw,
          synced_at = NOW()
        RETURNING (xmax = 0) as inserted
      `, [
        id,
        t.TherapistName || '',
        t.TherapistIDNumber || '',
        t.Type || '',
        t.TherapistRegisterd || 0,
        JSON.stringify(t.listBranches || []),
        JSON.stringify(t.Rights || {}),
        JSON.stringify(t),
      ]);

      if (result.rows[0].inserted) added++;
      else updated++;
    }

    await finishRun(runId, 'success', { added, updated });
    console.log(`[therapists] ${added} added, ${updated} updated`);
    return { added, updated };
  } catch (e: any) {
    await finishRun(runId, 'failed', { added, updated }, e.message);
    throw e;
  }
}

// ============ Helper: parse a session into normalized rows ============
function parseSession(s: any, petId: number) {
  const session = s.Session || {};
  const sessionId = session.SessionID || s.SessionID || 0;
  const dateStr = session.Date || s.Date || '';
  const date = parseClinicaDate(dateStr);

  const visit = {
    sessionId,
    petId,
    userId: session.PatientID || s.PatientID || null,
    date,
    therapistId: session.TherapistID || null,
    therapistName: session.TherapistName || '',
    finds: session.Finds || '',
    notes: session.Notes || '',
    anamneza: session.Anamneza || '',
    reason: session.Reason || '',
    totalAmount: parseFloat(session.TotalAmount || '0') || 0,
    raw: s,
  };

  const items: any[] = [];
  for (const item of session.Items || []) {
    items.push({
      sessionId,
      petId,
      itemName: item.FieldName || item.Name || '',
      itemId: item.ItemID || item.itemID || null,
      amount: parseFloat(item.Amount || '1') || 1,
      price: parseFloat(item.Price || '0') || 0,
      total: (parseFloat(item.Amount || '1') || 1) * (parseFloat(item.Price || '0') || 0),
      category: item.Category || item.GroupName || '',
      visitDate: date,
      raw: item,
    });
  }

  const vaccine = (s.Vaccine && (s.Vaccine.Name || s.Vaccine.VaccineName)) ? {
    sessionId,
    petId,
    vaccineName: s.Vaccine.Name || s.Vaccine.VaccineName || '',
    vaccineId: s.Vaccine.ID || s.Vaccine.VaccineID || s.Vaccine.FieldID || null,
    vaccineDate: parseClinicaDate(s.Vaccine.Date || '') || date,
    nextDueDate: parseClinicaDate(s.Vaccine.NextDate || ''),
    batchNumber: String(s.Vaccine.BatchAmount || s.Vaccine.Batch || ''),
    manufacturer: s.Vaccine.Manufacturer || '',
    raw: s.Vaccine,
  } : null;

  const prescriptions: any[] = [];
  for (const p of s.Pres || []) {
    prescriptions.push({
      sessionId,
      petId,
      drugName: p.Name || p.DrugName || '',
      dose: p.Dose || '',
      frequency: p.Frequency || '',
      duration: p.Duration || '',
      instructions: p.Instructions || p.Notes || '',
      prescribedDate: date,
      raw: p,
    });
  }

  const labs: any[] = [];
  for (const l of s.Labs || []) {
    if (!l.FieldName && !l.TestName) continue;
    const value = String(l.FieldValue ?? l.Value ?? '');
    const numeric = parseFloat(value);
    const isAbnormal = !isNaN(numeric) && (
      (typeof l.LowValue === 'number' && numeric < l.LowValue) ||
      (typeof l.HighValue === 'number' && numeric > l.HighValue)
    );
    labs.push({
      sessionId,
      petId,
      testName: `${l.TestName || ''} - ${l.FieldName || ''}`.trim().replace(/^- /, ''),
      resultValue: value,
      unit: l.Unit || '',
      normalRange: (l.LowValue !== undefined && l.HighValue !== undefined) ? `${l.LowValue}-${l.HighValue}` : '',
      isAbnormal,
      testDate: parseClinicaDate(l.Date || '') || date,
      raw: l,
    });
  }

  return { visit, items, vaccine, prescriptions, labs };
}


function parseClinicaDate(s: string): string | null {
  if (!s) return null;
  const datePart = s.split(' ')[0];
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1]), mo = parseInt(m[2]);
  if (d > 31 || mo > 12) return null;
  return `${m[3]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}


// ============ Upsert visit and related rows ============
async function upsertSession(parsed: ReturnType<typeof parseSession>): Promise<void> {
  const { visit, items, vaccine, prescriptions, labs } = parsed;
  if (!visit.sessionId || !visit.date) return;

  await pool.query(`
    INSERT INTO visits (session_id, pet_id, user_id, visit_date, therapist_id, therapist_name, finds, notes, anamneza, reason, total_amount, raw, synced_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
    ON CONFLICT (session_id) DO UPDATE SET
      finds = EXCLUDED.finds,
      notes = EXCLUDED.notes,
      anamneza = EXCLUDED.anamneza,
      total_amount = EXCLUDED.total_amount,
      raw = EXCLUDED.raw,
      synced_at = NOW()
  `, [
    visit.sessionId, visit.petId, visit.userId, visit.date, visit.therapistId, visit.therapistName,
    visit.finds, visit.notes, visit.anamneza, visit.reason, visit.totalAmount,
    JSON.stringify(visit.raw),
  ]);

  // Delete existing items for this session before re-inserting (handles updates)
  await pool.query('DELETE FROM visit_items WHERE session_id = $1', [visit.sessionId]);
  for (const item of items) {
    if (!item.itemName) continue;
    await pool.query(`
      INSERT INTO visit_items (session_id, pet_id, item_name, item_id, amount, price, total, category, visit_date, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (session_id, item_name, price) DO NOTHING
    `, [item.sessionId, item.petId, item.itemName, item.itemId, item.amount, item.price, item.total, item.category, item.visitDate, JSON.stringify(item.raw)]);
  }

  if (vaccine && vaccine.vaccineName) {
    await pool.query(`
      INSERT INTO vaccines (session_id, pet_id, vaccine_name, vaccine_id, vaccine_date, next_due_date, batch_number, manufacturer, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (pet_id, vaccine_name, vaccine_date) DO UPDATE SET
        next_due_date = EXCLUDED.next_due_date,
        batch_number = EXCLUDED.batch_number,
        synced_at = NOW()
    `, [vaccine.sessionId, vaccine.petId, vaccine.vaccineName, vaccine.vaccineId, vaccine.vaccineDate, vaccine.nextDueDate, vaccine.batchNumber, vaccine.manufacturer, JSON.stringify(vaccine.raw)]);
  }

  for (const p of prescriptions) {
    if (!p.drugName) continue;
    await pool.query(`
      INSERT INTO prescriptions (session_id, pet_id, drug_name, dose, frequency, duration, instructions, prescribed_date, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (session_id, drug_name) DO NOTHING
    `, [p.sessionId, p.petId, p.drugName, p.dose, p.frequency, p.duration, p.instructions, p.prescribedDate, JSON.stringify(p.raw)]);
  }

  for (const l of labs) {
    if (!l.testName) continue;
    await pool.query(`
      INSERT INTO lab_results (session_id, pet_id, test_name, result_value, unit, normal_range, is_abnormal, test_date, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (session_id, test_name) DO NOTHING
    `, [l.sessionId, l.petId, l.testName, l.resultValue, l.unit, l.normalRange, l.isAbnormal, l.testDate, JSON.stringify(l.raw)]);
  }
}

// ============ Sync visits for pets (the heavy lifting) ============
export async function syncVisitsForPets(petIds: number[], yearsBack: number, layer: string): Promise<{ added: number; updated: number; failed: number }> {
  const runId = await startRun(layer, 'visits');
  let added = 0, updated = 0, failed = 0;

  const fromDate = formatDateMMDDYYYY(getIsraelDate(-yearsBack * 365));
  const toDate = formatDateMMDDYYYY(getIsraelDate(7)); // include next week
  console.log(`[warehouse] Scanning ${petIds.length} pets, ${yearsBack} years back (${fromDate} → ${toDate})`);

  let processed = 0;
  let lastLog = Date.now();

  for (const petId of petIds) {
    processed++;

    if (Date.now() - lastLog > 15000) {
      const pct = Math.round(processed / petIds.length * 100);
      console.log(`[warehouse] visits: ${processed}/${petIds.length} pets (${pct}%) | added=${added} updated=${updated} failed=${failed}`);
      lastLog = Date.now();
    }

    try {
      const sessions = await callAsmx('LoadPetSessions', {
        Anam: '', All: 1,
        fromDate, toDate,
        PetID: petId, withWatch: 0,
      });

      if (!Array.isArray(sessions)) continue;

      for (const s of sessions) {
        try {
          const parsed = parseSession(s, petId);
          if (!parsed.visit.sessionId) continue;
          await upsertSession(parsed);
          added++;
        } catch (e: any) {
          failed++;
        }
      }
    } catch {
      failed++;
    }
  }

  await finishRun(runId, 'success', { added, updated, failed });
  console.log(`[warehouse] visits done: added=${added} failed=${failed}`);
  return { added, updated, failed };
}

// ============ Sync appointments from diary ============
export async function syncAppointments(daysFrom: number, daysTo: number, layer: string): Promise<{ added: number; updated: number }> {
  const runId = await startRun(layer, 'appointments');
  let added = 0, updated = 0;

  console.log(`[warehouse] Scanning diary: ${daysFrom > 0 ? '+' : ''}${daysFrom} to ${daysTo > 0 ? '+' : ''}${daysTo} days`);

  for (let i = daysFrom; i <= daysTo; i++) {
    const d = getIsraelDate(i);
    if (d.getDay() === 6) continue; // skip Saturday

    const dateStr = formatDateMMDDYYYY(d);

    try {
      const data = await callAsmx('GetAllClinicData', {
        ShowNotActive: 0, sSelected: dateStr, UserID: '', pannel: 0,
      });

      const events = data?.listEvents || [];
      for (const ev of events) {
        if (!ev.EventID) continue;

        const beginDate = new Date(ev.BeginDate);
        const endDate = ev.EndDate ? new Date(ev.EndDate) : null;

        const result = await pool.query(`
          INSERT INTO appointments (event_id, user_id, pet_id, therapist_id, begin_date, end_date, description, event_notes, treatment_id, status, is_new_patient, confirmed, raw, synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          ON CONFLICT (event_id) DO UPDATE SET
            status = EXCLUDED.status,
            confirmed = EXCLUDED.confirmed,
            event_notes = EXCLUDED.event_notes,
            raw = EXCLUDED.raw,
            synced_at = NOW()
          RETURNING (xmax = 0) as inserted
        `, [
          ev.EventID,
          ev.PatientID || null,
          ev.PetID || null,
          ev.UserID || null,
          beginDate,
          endDate,
          ev.Description || '',
          ev.eventNotes || '',
          ev.TreatmentID || null,
          ev.Status || 0,
          ev.NewPatient || 0,
          ev.Confirmed || 0,
          JSON.stringify(ev),
        ]);

        if (result.rows[0].inserted) added++;
        else updated++;
      }
    } catch (e) { console.error("[warehouse] appointment sync failed:", e instanceof Error ? e.message : e); }
  }

  await finishRun(runId, 'success', { added, updated });
  console.log(`[warehouse] appointments: ${added} added, ${updated} updated`);
  return { added, updated };
}

// ============ Main entry ============
export async function runInitialSync(yearsBack = 7) {
  const startTime = Date.now();
  console.log('========================================');
  console.log('  Data Warehouse — INITIAL SYNC');
  console.log(`  Years: ${yearsBack} | Started: ${new Date().toISOString()}`);
  console.log('========================================');

  // 1. Therapists (fast)
  await syncTherapists();

  // 2. All pets — visits, items, vaccines, prescriptions, labs
  const { rows: pets } = await pool.query('SELECT pet_id FROM pets WHERE not_active = 0 OR not_active IS NULL ORDER BY pet_id');
  console.log(`[warehouse] Found ${pets.length} active pets`);

  await syncVisitsForPets(pets.map(p => p.pet_id), yearsBack, 'initial');

  // 3. Appointments — all of history + 90 days future
  const totalDays = yearsBack * 365;
  await syncAppointments(-totalDays, 90, 'initial');

  // Mark initial sync done
  await pool.query(`
    UPDATE warehouse_config SET value = 'true'::jsonb, updated_at = NOW()
    WHERE key = 'initial_sync_done'
  `);

  const elapsed = Math.round((Date.now() - startTime) / 60000);
  console.log(`========================================`);
  console.log(`  INITIAL SYNC DONE in ${elapsed} minutes`);
  console.log(`========================================`);
}

export async function runHourly() {
  console.log('[warehouse] HOURLY sync — appointments today + tomorrow');
  await syncAppointments(0, 1, 'hourly');
}

export async function runDaily() {
  console.log('[warehouse] DAILY sync — yesterday visits + recent appointments');
  // Yesterday's visits for pets that had appointments
  const { rows } = await pool.query(`
    SELECT DISTINCT pet_id FROM appointments
    WHERE begin_date::date >= CURRENT_DATE - INTERVAL '2 days'
    AND pet_id IS NOT NULL
  `);
  if (rows.length > 0) {
    await syncVisitsForPets(rows.map(r => r.pet_id), 0.02, 'daily'); // ~7 days back
  }
  await syncAppointments(-7, 30, 'daily');
}

export async function runWeekly() {
  console.log('[warehouse] WEEKLY sync — full pet rescan');
  const { rows: pets } = await pool.query('SELECT pet_id FROM pets WHERE not_active = 0 OR not_active IS NULL');
  await syncVisitsForPets(pets.map(p => p.pet_id), 1, 'weekly');
  await syncAppointments(-30, 90, 'weekly');
  await syncTherapists();
}

// CLI
const mode = process.argv[2] || 'help';
const yearsArg = parseInt(process.argv[3] || '7');

(async () => {
  try {
    switch (mode) {
      case 'initial': await runInitialSync(yearsArg); break;
      case 'hourly': await runHourly(); break;
      case 'daily': await runDaily(); break;
      case 'weekly': await runWeekly(); break;
      case 'therapists': await syncTherapists(); break;
      case 'appointments': await syncAppointments(-30, 90, 'manual'); break;
      default:
        console.log('Usage: bun run sync-warehouse.ts <initial|hourly|daily|weekly|therapists|appointments> [years]');
    }
  } catch (e: any) {
    console.error('[warehouse] Fatal:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
