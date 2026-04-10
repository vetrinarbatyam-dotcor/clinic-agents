/**
 * marpet-tz-discovery.ts
 * Discovers owner TZ numbers by scraping Marpet's claims history.
 * The history list contains pet_id -> owner_tz mappings.
 *
 * Strategy: fetch history_list.php with date windows, extract pet_ids
 * and match them back to ClinicaOnline pets via name/phone.
 */

import { load } from 'cheerio';

const MARPET_BASE = 'https://tools.marpet.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const RATE_LIMIT_MS = 1500;

let _sessionCookie = '';
let _lastRequest = 0;

// Called after loginMarpet() — shares the session via exported setter
export function setMarpetSession(cookie: string) {
  _sessionCookie = cookie;
}

async function rateLimit() {
  const elapsed = Date.now() - _lastRequest;
  if (elapsed < RATE_LIMIT_MS) await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  _lastRequest = Date.now();
}

export interface MarpetClient {
  petId: string;
  petName: string;
  ownerName: string;
  ownerTz: string;
  species: string;
}

/**
 * Fetch clients from Marpet history for a date range.
 * history_list returns ~99 records per page.
 */
export async function fetchMarpetClients(fromDate: string, toDate: string): Promise<MarpetClient[]> {
  const url = new URL(`${MARPET_BASE}/vet/history_list.php`);
  url.searchParams.set('p_from_date', fromDate);
  url.searchParams.set('p_to_date', toDate);
  url.searchParams.set('checkVacc', 'on');
  url.searchParams.set('checkMedd', 'on');
  url.searchParams.set('treay_type', 'all');
  url.searchParams.set('pm', '0');

  await rateLimit();
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': UA, Cookie: _sessionCookie },
    redirect: 'follow',
  });

  if (!res.ok) {
    console.warn(`[marpet-discovery] history_list returned ${res.status}`);
    return [];
  }

  const html = await res.text();
  return parseHistoryList(html);
}

function parseHistoryList(html: string): MarpetClient[] {
  const $ = load(html);
  const clients: MarpetClient[] = [];
  const seen = new Set<string>();

  // Try table rows
  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;

    const text = $(row).text();
    // Look for rows with pet_id links (se...)
    const petIdMatch = $(row).find('a[href*="pet_id="]').attr('href');
    if (petIdMatch) {
      const petIdM = petIdMatch.match(/pet_id=(se\d+)/);
      if (!petIdM) return;
      const petId = petIdM[1];
      if (seen.has(petId)) return;
      seen.add(petId);

      // Extract owner name and TZ from cells
      const cellTexts = $(row).find('td').map((_, td) => $(td).text().trim()).get();
      clients.push({
        petId,
        petName: cellTexts[1] || '',
        ownerName: cellTexts[2] || '',
        ownerTz: cellTexts[3] || '',
        species: cellTexts[4] || '',
      });
    }
  });

  return clients;
}

/**
 * Fetch claims for a specific pet to get owner info.
 * Returns owner TZ if found in the claims page.
 */
export async function fetchPetOwnerTz(petId: string): Promise<string | null> {
  await rateLimit();
  const res = await fetch(`${MARPET_BASE}/vet/claims_list.php?pet_id=${petId}`, {
    headers: { 'User-Agent': UA, Cookie: _sessionCookie },
    redirect: 'follow',
  });
  if (!res.ok) return null;

  const html = await res.text();
  const $ = load(html);

  // Look for TZ (9 digits) in the page
  const pageText = $('body').text();
  const tzMatches = pageText.match(/\b(\d{9})\b/g);
  if (tzMatches) {
    for (const tz of tzMatches) {
      if (isValidIsraeliId(tz)) return tz;
    }
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
