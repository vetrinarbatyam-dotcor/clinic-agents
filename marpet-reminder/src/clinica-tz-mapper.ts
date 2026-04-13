/**
 * clinica-tz-mapper.ts
 * Extracts owner TZ (national ID) from ClinicaOnline with 5-tier fallback.
 * Results cached in Supabase marpet_owner_map table.
 *
 * TZ sources (priority order):
 *   1. clinica_id_field    -- IDNumber in SearchByNameClinic ASMX response
 *   2. clinica_claims      -- IdNumber in GetInsuredReportForExcel (Marpet insurance records)
 *   3. client_notes        -- 9-digit Luhn-valid number in client Notes field
 *   4. pet_notes           -- 9-digit Luhn-valid number in pet Sagir/JumpNote/Panel fields
 *   5. marpet_discovery    -- discovered via Marpet history_list scraping
 */

import { callAsmx } from '../../shared/clinica';
import { supabase } from '../../shared/supabase';
import { pool } from '../../shared/db';


// Israeli ID: 9 digits with Luhn-like checksum
const TZ_REGEX = /\b(\d{9})\b/g;

function extractTzFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const matches = [...text.matchAll(TZ_REGEX)];
  for (const m of matches) {
    const tz = m[1];
    if (isValidIsraeliId(tz)) return tz;
  }
  return null;
}

function isValidIsraeliId(id: string): boolean {
  if (id.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

export type FoundVia =
  | 'clinica_id_field'
  | 'clinica_claims'
  | 'client_notes'
  | 'pet_notes'
  | 'marpet_discovery';

export interface TzMapping {
  clientId: string;
  ownerTz: string;
  foundVia: FoundVia;
  lastVerified: string;
}

// ============================================================
// Tier 2: Claims scrape from ClinicaOnline Marpet insurance
// Uses GetInsuredReportForExcel which returns IdNumber per client.
// Field is "IdNumber" (not "IDNumber") in the InsuredVisit type.
// ============================================================

interface ClaimsRecord {
  fullName: string;
  phone: string;
  idNumber: string;
}

let claimsCache: ClaimsRecord[] | null = null;
let claimsCacheTime = 0;
const CLAIMS_CACHE_TTL = 3_600_000; // 1 hour

export async function loadMarpetClaimsMap(): Promise<ClaimsRecord[]> {
  if (claimsCache && Date.now() - claimsCacheTime < CLAIMS_CACHE_TTL) {
    return claimsCache;
  }
  try {
    // GetInsuredReportForExcel returns InsuredVisit records with IdNumber
    // insuranceName "מרפאט" is how the clinic registered Marpet insurance
    const records = await callAsmx('GetInsuredReportForExcel', {
      Branch: 0,
      insuranceName: 'מרפאט',
    }) as any[];

    if (!Array.isArray(records)) {
      claimsCache = [];
      return [];
    }

    claimsCache = records
      .filter((r: any) => r.IdNumber && String(r.IdNumber).trim().length > 0)
      .map((r: any) => ({
        fullName: String(r.FullName || '').trim().toLowerCase(),
        phone: normalizePhone(String(r.Phone || '')),
        idNumber: String(r.IdNumber).trim(),
      }));

    claimsCacheTime = Date.now();
    console.log('[tz-mapper] Loaded', claimsCache.length, 'Marpet claim records with IdNumber');
    return claimsCache;
  } catch (e) {
    console.error('[tz-mapper] Failed to load claims:', e);
    claimsCache = [];
    return [];
  }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '').replace(/^972/, '0');
}

export async function getTzFromClaims(
  clientPhone: string,
  clientName: string
): Promise<string | null> {
  const map = await loadMarpetClaimsMap();
  const normPhone = normalizePhone(clientPhone);
  const normName = clientName.trim().toLowerCase();

  // Primary: match by phone (last 9 digits)
  if (normPhone.length >= 9) {
    const last9 = normPhone.slice(-9);
    const byPhone = map.find((r) => r.phone.slice(-9) === last9);
    if (byPhone && isValidIsraeliId(byPhone.idNumber)) {
      return byPhone.idNumber;
    }
  }

  // Secondary: match by full name (both directions)
  if (normName.length > 2) {
    const byName = map.find(
      (r) => r.fullName === normName ||
             r.fullName.includes(normName) ||
             normName.includes(r.fullName)
    );
    if (byName && isValidIsraeliId(byName.idNumber)) {
      return byName.idNumber;
    }
  }

  return null;
}

// ============================================================
// Main resolution pipeline
// ============================================================

export async function getOrFetchTzMapping(clientId: string, patientId: string): Promise<TzMapping | null> {
  // Check Supabase cache first
  const { data: cached } = await supabase
    .from('marpet_owner_map')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (cached && cached.owner_tz) {
    return {
      clientId: cached.client_id,
      ownerTz: cached.owner_tz,
      foundVia: cached.found_via,
      lastVerified: cached.last_verified,
    };
  }

  const mapping = await resolveTz(clientId, patientId);
  if (!mapping) return null;

  try {
    await supabase.from('marpet_owner_map').upsert({
      client_id: clientId,
      owner_tz: mapping.ownerTz,
      found_via: mapping.foundVia,
      last_verified: new Date().toISOString(),
    }, { onConflict: 'client_id' });
  } catch (e) {
    // Table might not exist yet
  }

  return mapping;
}

async function resolveTz(clientId: string, patientId: string): Promise<TzMapping | null> {
  const now = new Date().toISOString();

  // Tier 0: local DB id_number column (usually empty, fast check)
  try {
    const res = await pool.query(
      'SELECT id_number FROM clients WHERE user_id = $1 LIMIT 1',
      [patientId]
    );
    if (res.rows.length > 0 && res.rows[0].id_number) {
      const tz = extractTzFromText(res.rows[0].id_number);
      if (tz) return { clientId, ownerTz: tz, foundVia: 'clinica_id_field', lastVerified: now };
    }
  } catch (e) { console.error("[tz-mapper] DB id_number lookup failed:", e instanceof Error ? e.message : e); }

  // Tier 1: SearchByNameClinic — IDNumber field + Notes
  let clientPhone = '';
  let clientName = '';
  try {
    const clientData = await callAsmx('SearchByNameClinic', { UserName: '', UserID: patientId, LastName: '' });
    const clients = Array.isArray(clientData) ? clientData : [clientData];
    for (const c of clients) {
      if (!c) continue;
      // IDNumber field (capital I D Number)
      const idField = c.IDNumber || c.Id || c.CitizenID || c.TZ || c.Tz;
      if (idField && String(idField).trim().length > 0) {
        const tz = extractTzFromText(String(idField));
        if (tz) return { clientId, ownerTz: tz, foundVia: 'clinica_id_field', lastVerified: now };
      }
      // Save phone/name for claims tier
      clientPhone = c.CellPhone || c.Phone || clientPhone;
      clientName = `${c.FirstName || ''} ${c.LastName || ''}`.trim() || clientName;
      // Notes text
      const notes = [c.Notes, c.Remarks, c.NotesPersonal].filter(Boolean).join(' ');
      const tzFromNotes = extractTzFromText(notes);
      if (tzFromNotes) return { clientId, ownerTz: tzFromNotes, foundVia: 'client_notes', lastVerified: now };
    }
  } catch (e) { console.error("[tz-mapper] SearchByNameClinic failed:", e instanceof Error ? e.message : e); }

  // Tier 2: ClinicaOnline Marpet claims (GetInsuredReportForExcel)
  // Field is "IdNumber" (camelCase) in InsuredVisit response
  if (clientPhone || clientName) {
    try {
      const tzFromClaims = await getTzFromClaims(clientPhone, clientName);
      if (tzFromClaims) {
        return { clientId, ownerTz: tzFromClaims, foundVia: 'clinica_claims', lastVerified: now };
      }
    } catch (e) { console.error("[tz-mapper] getTzFromClaims failed:", e instanceof Error ? e.message : e); }
  }

  // Tier 3: Pet notes (Sagir, JumpNote, Panel fields)
  try {
    const pets = await callAsmx('GetPatientPets', { userid: patientId });
    for (const pet of (pets || [])) {
      const petText = [pet.Sagir, pet.JumpNote, pet.Panel, pet.Remarks, pet.Notes, pet.Comments]
        .filter(Boolean).join(' ');
      const tz = extractTzFromText(petText);
      if (tz) return { clientId, ownerTz: tz, foundVia: 'pet_notes', lastVerified: now };
    }
  } catch (e) { console.error("[tz-mapper] pet notes TZ lookup failed:", e instanceof Error ? e.message : e); }

  return null;
}

// ============================================================
// Bulk discovery: run TZ resolution on dog owners only
// ============================================================

export interface DogOwnerResult {
  clientId: string;
  patientId: string;
  name: string;
  phone: string;
  ownerTz?: string;
  foundVia?: FoundVia;
}

export async function discoverTzForDogOwners(limit = 50): Promise<DogOwnerResult[]> {
  const sql = `
    SELECT DISTINCT ON (c.user_id)
      c.user_id AS patient_id,
      c.user_id AS client_id,
      TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS full_name,
      COALESCE(NULLIF(c.cell_phone, ''), NULLIF(c.phone, '')) AS phone
    FROM clients c
    JOIN pets p ON p.user_id = c.user_id
    WHERE c.not_active = 0
      AND TRIM(p.species) = ANY(ARRAY['כלב','כלבה','לברדור','פומרנין','מלטז','שיצו','גולדן','פודל','בוקסר'])
      AND (c.cell_phone IS NOT NULL AND c.cell_phone != ''
           OR c.phone IS NOT NULL AND c.phone != '')
    ORDER BY c.user_id, c.last_visit DESC NULLS LAST
    LIMIT $1
  `;

  let rows: any[] = [];
  try {
    const res = await pool.query(sql, [limit]);
    rows = res.rows;
  } catch (e) {
    console.error('[tz-mapper] DB error fetching dog owners:', e);
    return [];
  }

  // Pre-load claims map once for all clients
  await loadMarpetClaimsMap();

  const results: DogOwnerResult[] = [];
  for (const row of rows) {
    const base: DogOwnerResult = {
      clientId: row.client_id,
      patientId: row.patient_id,
      name: row.full_name?.trim() || row.patient_id,
      phone: row.phone || '',
    };

    const mapping = await resolveTz(row.client_id, row.patient_id);
    if (mapping) {
      base.ownerTz = mapping.ownerTz;
      base.foundVia = mapping.foundVia;
      // Cache in Supabase
      try {
        await supabase.from('marpet_owner_map').upsert({
          client_id: row.client_id,
          owner_tz: mapping.ownerTz,
          found_via: mapping.foundVia,
          last_verified: new Date().toISOString(),
        }, { onConflict: 'client_id' });
      } catch (e) { console.error("[tz-mapper] supabase upsert failed:", e instanceof Error ? e.message : e); }
    }

    results.push(base);
  }
  return results;
}

export interface ClientWithPhone {
  clientId: string;
  patientId: string;
  name: string;
  phone: string;
  idNumber?: string;
}

export async function getRecentClients(): Promise<ClientWithPhone[]> {
  try {
    const sql = `
      SELECT DISTINCT c.user_id AS patient_id, c.user_id AS client_id,
        TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS full_name,
        COALESCE(NULLIF(c.cell_phone, ''), NULLIF(c.phone, '')) AS phone, c.id_number
      FROM clients c
      WHERE c.not_active = 0
        AND c.last_visit >= NOW() - INTERVAL '12 months'
        AND (c.cell_phone IS NOT NULL AND c.cell_phone != ''
             OR c.phone IS NOT NULL AND c.phone != '')
      ORDER BY full_name
    `;
    const res = await pool.query(sql);
    return res.rows.map(r => ({
      clientId: r.client_id,
      patientId: r.patient_id,
      name: r.full_name.trim() || r.client_id,
      phone: r.phone,
      idNumber: r.id_number,
    }));
  } catch (e) {
    console.error('[tz-mapper] Error fetching clients:', e);
    return [];
  }
}

export async function closePool() {
  await pool.end();
}
