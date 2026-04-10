// Backfill vaccines + lab_results from existing visits.raw JSONB
// No API calls — pure local processing
//
// Why: original sync had two bugs:
//   1. Vaccine dates use D/M/YYYY (Israeli) not M/D/YYYY → parser failed
//   2. Lab fields are FieldName/FieldValue/LowValue/HighValue, not Name/Value
// Fix: re-extract from the raw session JSONB we stored.

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'clinicpal',
  user: process.env.DB_USER || 'clinicpal_user',
  password: process.env.DB_PASSWORD || 'clinicpal2306',
  max: 5,
});

// Smart date parser — handles both formats
// Israeli (D/M/YYYY) is used for Vaccine.Date and Vaccine.NextDate
// American (M/D/YYYY HH:MM) is used for Session.Date and Labs.Date
function parseIsraeliDate(s: string): string | null {
  if (!s) return null;
  const datePart = s.split(' ')[0];
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  // D/M/YYYY → YYYY-MM-DD
  const d = parseInt(m[1]), mo = parseInt(m[2]);
  if (d > 31 || mo > 12) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseAmericanDate(s: string): string | null {
  if (!s) return null;
  const datePart = s.split(' ')[0];
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  // M/D/YYYY → YYYY-MM-DD
  const mo = parseInt(m[1]), d = parseInt(m[2]);
  if (mo > 12 || d > 31) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function backfill() {
  console.log('=== Backfill: vaccines + lab_results from visits.raw ===');
  const startTime = Date.now();

  // Clear existing partial data
  console.log('[backfill] Clearing existing vaccines + lab_results tables...');
  await pool.query('TRUNCATE vaccines RESTART IDENTITY');
  await pool.query('TRUNCATE lab_results RESTART IDENTITY');
  await pool.query('TRUNCATE prescriptions RESTART IDENTITY');

  // Stream visits in batches to avoid loading all 58K into memory
  const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM visits WHERE raw IS NOT NULL');
  const total = parseInt(countRows[0].count);
  console.log(`[backfill] Processing ${total} visits...`);

  const BATCH = 1000;
  let offset = 0;
  let vaccineCount = 0;
  let labCount = 0;
  let presCount = 0;
  let vaccineErrors = 0;
  let labErrors = 0;

  while (offset < total) {
    const { rows } = await pool.query(
      `SELECT session_id, pet_id, visit_date, raw FROM visits
       WHERE raw IS NOT NULL ORDER BY session_id LIMIT $1 OFFSET $2`,
      [BATCH, offset]
    );

    for (const row of rows) {
      const raw = row.raw;
      if (!raw || typeof raw !== 'object') continue;

      // ====== Vaccine ======
      const vac = raw.Vaccine;
      if (vac && (vac.Name || vac.VaccineName)) {
        try {
          const vDate = parseIsraeliDate(vac.Date) || row.visit_date;
          const nextDate = parseIsraeliDate(vac.NextDate);

          await pool.query(`
            INSERT INTO vaccines (session_id, pet_id, vaccine_name, vaccine_id, vaccine_date, next_due_date, batch_number, manufacturer, raw)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (pet_id, vaccine_name, vaccine_date) DO UPDATE SET
              next_due_date = EXCLUDED.next_due_date,
              raw = EXCLUDED.raw,
              synced_at = NOW()
          `, [
            row.session_id,
            row.pet_id,
            vac.Name || vac.VaccineName || '',
            vac.ID || vac.FieldID || null,
            vDate,
            nextDate,
            String(vac.BatchAmount || ''),
            vac.Manufacturer || '',
            JSON.stringify(vac),
          ]);
          vaccineCount++;
        } catch (e: any) {
          vaccineErrors++;
        }
      }

      // ====== Labs ======
      if (Array.isArray(raw.Labs)) {
        for (const lab of raw.Labs) {
          if (!lab.FieldName && !lab.TestName) continue;
          try {
            const labDate = parseAmericanDate(lab.Date) || row.visit_date;
            const value = String(lab.FieldValue ?? lab.Value ?? '');
            const low = lab.LowValue;
            const high = lab.HighValue;
            const numeric = parseFloat(value);
            const isAbnormal = !isNaN(numeric) && (
              (typeof low === 'number' && numeric < low) ||
              (typeof high === 'number' && numeric > high)
            );

            await pool.query(`
              INSERT INTO lab_results (session_id, pet_id, test_name, result_value, unit, normal_range, is_abnormal, test_date, raw)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
              row.session_id,
              row.pet_id,
              `${lab.TestName || ''} - ${lab.FieldName || ''}`.trim().replace(/^- /, ''),
              value,
              lab.Unit || '',
              low !== undefined && high !== undefined ? `${low}-${high}` : '',
              isAbnormal,
              labDate,
              JSON.stringify(lab),
            ]);
            labCount++;
          } catch {
            labErrors++;
          }
        }
      }

      // ====== Prescriptions (Pres array) ======
      if (Array.isArray(raw.Pres)) {
        for (const p of raw.Pres) {
          const drug = p.Name || p.DrugName || p.FieldName || '';
          if (!drug) continue;
          try {
            await pool.query(`
              INSERT INTO prescriptions (session_id, pet_id, drug_name, dose, frequency, duration, instructions, prescribed_date, raw)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
              row.session_id,
              row.pet_id,
              drug,
              String(p.Dose || p.Amount || ''),
              String(p.Frequency || ''),
              String(p.Duration || p.Days || ''),
              p.Instructions || p.Notes || '',
              row.visit_date,
              JSON.stringify(p),
            ]);
            presCount++;
          } catch {}
        }
      }
    }

    offset += BATCH;
    const pct = Math.round(offset / total * 100);
    console.log(`[backfill] ${offset}/${total} (${pct}%) | vaccines=${vaccineCount} labs=${labCount} pres=${presCount}`);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('========================================');
  console.log('  BACKFILL DONE');
  console.log(`  vaccines:      ${vaccineCount} (errors: ${vaccineErrors})`);
  console.log(`  lab_results:   ${labCount} (errors: ${labErrors})`);
  console.log(`  prescriptions: ${presCount}`);
  console.log(`  duration:      ${elapsed}s`);
  console.log('========================================');

  // Log to sync_runs
  await pool.query(`
    INSERT INTO sync_runs (layer, table_name, status, started_at, finished_at, duration_sec, rows_added, triggered_by)
    VALUES ('backfill', 'vaccines+labs+pres', 'success', NOW() - ($1 || ' seconds')::interval, NOW(), $1, $2, 'manual')
  `, [elapsed, vaccineCount + labCount + presCount]);

  await pool.end();
}

backfill().catch(e => {
  console.error('[backfill] Fatal:', e);
  process.exit(1);
});
