import { load } from 'cheerio';

const USERNAME = process.env.CLINICA_USERNAME || '';
const PASSWORD = process.env.CLINICA_PASSWORD || '';
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || '53';
const BASE_URL = process.env.CLINICA_BASE_URL || 'https://clinicaonline.co.il';
const WBASE_URL = process.env.CLINICA_WBASE_URL || 'https://www.clinicaonline.co.il';

const SESSION_TTL = 1800_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

let cookies: string[] = [];
let sessionTime = 0;

function getCookieHeader(): string {
  return cookies.map(c => c.split(';')[0]).join('; ');
}

function extractAspFields(html: string): Record<string, string> {
  const $ = load(html);
  const fields: Record<string, string> = {};
  for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    const val = $(`input[name="${name}"]`).val();
    if (val) fields[name] = val as string;
  }
  return fields;
}

function collectCookies(res: Response) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const name = sc.split('=')[0];
    cookies = cookies.filter(c => !c.startsWith(name + '='));
    cookies.push(sc);
  }
}

async function followRedirects(res: Response): Promise<Response> {
  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    const url = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: getCookieHeader() }, redirect: 'manual' });
    collectCookies(res);
  }
  return res;
}

async function login(): Promise<void> {
  cookies = [];
  let res = await fetch(`${BASE_URL}/Login.aspx`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  collectCookies(res);
  res = await followRedirects(res);
  const loginHtml = await res.text();
  const asp = extractAspFields(loginHtml);

  const body1 = new URLSearchParams({ ...asp });
  body1.set('ctl00$MainContent$Login1$UserName', USERNAME);
  body1.set('ctl00$MainContent$Login1$Password', PASSWORD);
  body1.set('ctl00$MainContent$Login1$LoginButton', 'כניסה');

  res = await fetch(`${BASE_URL}/Login.aspx`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: getCookieHeader() },
    body: body1.toString(), redirect: 'manual',
  });
  collectCookies(res);
  res = await followRedirects(res);

  const selectHtml = await res.text();
  if (selectHtml.includes('Login.aspx')) throw new Error('Login failed');

  const asp2 = extractAspFields(selectHtml);
  const body2 = new URLSearchParams({ ...asp2 });
  body2.set('ctl00$MainContent$ClinicsList', CLINIC_ID);
  body2.set('ctl00$MainContent$Button1', 'שלח');

  res = await fetch(`${BASE_URL}/SelectClinic.aspx`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: getCookieHeader() },
    body: body2.toString(), redirect: 'manual',
  });
  collectCookies(res);
  res = await followRedirects(res);

  res = await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`, {
    headers: { 'User-Agent': UA, Cookie: getCookieHeader() }, redirect: 'manual',
  });
  collectCookies(res);
  sessionTime = Date.now();
  console.log('[clinica] Logged in successfully');
}

async function ensureSession(): Promise<void> {
  if (!sessionTime || Date.now() - sessionTime > SESSION_TTL) {
    await login();
  }
}

export async function callAsmx(method: string, params: Record<string, any> = {}): Promise<any> {
  const url = `${WBASE_URL}/Restricted/dbCalander.asmx/${method}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureSession();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA, Cookie: getCookieHeader() },
        body: JSON.stringify(params),
      });
      if (res.status === 401 || res.status === 403) {
        sessionTime = 0;
        if (attempt === 0) continue;
        throw new Error('Auth failed after retry');
      }
      const raw = await res.json();
      let d = raw.d ?? raw;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { console.error('[clinica] JSON parse failed:', e instanceof Error ? e.message : e); } }
      return d;
    } catch (e: any) {
      if (attempt === 0) { sessionTime = 0; continue; }
      throw e;
    }
  }
}

// ============ Date helpers (Israel timezone, MM/DD/YYYY for ClinicaOnline) ============

export function getIsraelDate(daysOffset = 0): Date {
  const now = new Date();
  const israel = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  israel.setDate(israel.getDate() + daysOffset);
  return israel;
}

export function formatDateMMDDYYYY(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${m}/${d}/${date.getFullYear()}`;
}

export function isShabbatOrHoliday(date: Date): boolean {
  // Saturday = 6
  if (date.getDay() === 6) return true;
  // TODO: add Israeli holidays
  return false;
}

export function getNextBusinessDay(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (isShabbatOrHoliday(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

// ============ Visit data types ============

export interface SessionVisit {
  petId: number;
  petName: string;
  ownerName: string;
  ownerPhone: string;
  userId: string;
  sessionDate: string;
  finds: string;
  notes: string;
  anamneza: string;
  items: any[];
  vaccineName: string | null;
  therapistName: string;
  dateOfRegistration: string;
}

// ============ Main: Get all visits for a date by scanning all pets ============

export async function getVisitsForDate(dateStr: string): Promise<SessionVisit[]> {
  console.log(`[clinica] Scanning all pets for sessions on ${dateStr}...`);

  // Get all pets + client info from local DB
  const { pool } = await import('./db');

  const { rows: pets } = await pool.query(`
    SELECT p.pet_id, p.name as pet_name, p.user_id,
           c.first_name, c.last_name, c.cell_phone, c.phone
    FROM pets p
    JOIN clients c ON p.user_id = c.user_id
    WHERE (p.not_active IS NULL OR p.not_active = 0)
  `);

  console.log(`[clinica] Found ${pets.length} active pets in DB`);

  const visits: SessionVisit[] = [];
  const seenUsers = new Set<string>();
  let checked = 0;

  for (const pet of pets) {
    checked++;
    if (checked % 50 === 0) {
      console.log(`[clinica] Checked ${checked}/${pets.length} pets, found ${visits.length} visits...`);
    }

    try {
      const sessions = await callAsmx('LoadPetSessions', {
        Anam: '', All: 1,
        fromDate: dateStr, toDate: dateStr,
        PetID: pet.pet_id, withWatch: 0,
      });

      if (!Array.isArray(sessions) || sessions.length === 0) continue;

      const s = sessions[0];
      const session = s.Session || {};
      const vaccine = s.Vaccine;

      // Deduplicate by user (same owner, multiple pets on same day → one follow-up)
      if (seenUsers.has(pet.user_id)) continue;
      seenUsers.add(pet.user_id);

      visits.push({
        petId: pet.pet_id,
        petName: pet.pet_name || session.PetName || '',
        ownerName: `${pet.first_name || ''} ${pet.last_name || ''}`.trim(),
        ownerPhone: pet.cell_phone || pet.phone || '',
        userId: pet.user_id,
        sessionDate: session.Date || s.Date || '',
        finds: session.Finds || '',
        notes: session.Notes || '',
        anamneza: session.Anamneza || '',
        items: session.Items || [],
        vaccineName: vaccine?.Name || null,
        therapistName: session.TherapistName || '',
        dateOfRegistration: '', // Will be fetched if needed
      });
    } catch {
      // Skip failed pet lookups
    }
  }

  console.log(`[clinica] Scan complete: ${visits.length} visits found from ${checked} pets`);
  return visits;
}

// ============ Helpers ============

export async function getClientRegistrationDate(userId: string): Promise<string> {
  try {
    const results = await callAsmx('SearchByPhone', { PhoneNumber: '', UserID: userId, LastName: '' });
    if (Array.isArray(results) && results.length > 0) {
      return results[0].DateOfRegistration || '';
    }
  } catch (e) { console.error("[clinica] getClientRegistrationDate failed:", e instanceof Error ? e.message : e); }
  return '';
}

export async function getPetSessions(petId: number, days = 365): Promise<any[]> {
  const to = getIsraelDate();
  const from = getIsraelDate(-days);
  const data = await callAsmx('LoadPetSessions', {
    Anam: '', All: 1,
    fromDate: formatDateMMDDYYYY(from),
    toDate: formatDateMMDDYYYY(to),
    PetID: petId, withWatch: 0,
  });
  return Array.isArray(data) ? data : [];
}

export async function getPetDetails(petId: number): Promise<any> {
  return callAsmx('LoadPetDetails', { PetID: petId });
}
