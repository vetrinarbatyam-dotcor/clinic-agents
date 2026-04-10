/**
 * marpet-scraper.ts
 * Logs in to https://tools.marpet.co.il and fetches vaccine eligibility per owner TZ.
 * Session is cached in memory for the duration of a single run.
 */

const MARPET_BASE = 'https://tools.marpet.co.il';
const LOGIN_URL = `${MARPET_BASE}/Login-Veterinarians.php?returnurl=../vet/index.php`;
const SEARCH_URL = `${MARPET_BASE}/vet/index.php`;
const DATES_URL = `${MARPET_BASE}/vet/inc/dates_of_entitles.php`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const RATE_LIMIT_MS = 1000;

export interface PetEligibility {
  petName: string;
  gender: string;
  breed: string;
  vaccines: VaccineStatus[];
}

export interface VaccineStatus {
  name: string;
  eligible: boolean;
  nextDate: string | null;
}

export interface MarpetOwnerResult {
  ownerTz: string;
  pets: PetEligibility[];
  fetchedAt: string;
  error?: string;
}

// Dog vaccine names by position in dates_of_entitles response
const DOG_VACCINE_NAMES = ['כלבת', 'משושה', 'ת. הפארק', 'תילוע'];
// Cat vaccine names by position
const CAT_VACCINE_NAMES = ['מרובע', 'תילוע'];

let sessionCookie = '';
let lastRequestTime = 0;
let isLoggedIn = false;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

function extractCookies(res: Response): string {
  const cookies: string[] = [];
  const setCookieHeaders = res.headers.getSetCookie?.() || [];
  for (const sc of setCookieHeaders) {
    cookies.push(sc.split(';')[0]);
  }
  return cookies.join('; ');
}

function mergeCookies(existing: string, newCookies: string): string {
  const map = new Map<string, string>();
  for (const part of existing.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) map.set(k.trim(), v.join('='));
  }
  for (const part of newCookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) map.set(k.trim(), v.join('='));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export async function loginMarpet(): Promise<void> {
  const username = process.env.MARPET_USERNAME;
  const password = process.env.MARPET_PASSWORD;
  if (!username || !password) {
    throw new Error('[marpet] MARPET_USERNAME / MARPET_PASSWORD not set in .env');
  }

  console.log('[marpet] Logging in...');

  // Step 1: GET login page to establish session cookie
  await rateLimit();
  const getRes = await fetch(LOGIN_URL, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const newCookies1 = extractCookies(getRes);
  if (newCookies1) sessionCookie = mergeCookies(sessionCookie, newCookies1);
  // Follow any redirect from GET
  if (getRes.status >= 300 && getRes.status < 400) {
    const loc = getRes.headers.get('location') || '';
    const getRes2 = await fetch(loc.startsWith('http') ? loc : `${MARPET_BASE}${loc}`, {
      headers: { Cookie: sessionCookie, 'User-Agent': UA },
      redirect: 'manual',
    });
    const nc2 = extractCookies(getRes2);
    if (nc2) sessionCookie = mergeCookies(sessionCookie, nc2);
  }

  // Step 2: POST with correct form fields (name=username, lastname=password, no __token)
  const body = new URLSearchParams({
    returnurl2: '',
    name: username,
    lastname: password,
  });

  await rateLimit();
  const loginPost = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie,
      Referer: LOGIN_URL,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': MARPET_BASE,
    },
    body: body.toString(),
    redirect: 'manual',
  });
  const newCookies2 = extractCookies(loginPost);
  if (newCookies2) sessionCookie = mergeCookies(sessionCookie, newCookies2);

  if (loginPost.status === 302 || loginPost.status === 301) {
    // Login succeeded - follow redirect to /vet/index.php
    let redirectLoc = loginPost.headers.get('location') || '';
    // Fix relative path: ../vet/index.php -> /vet/index.php
    if (redirectLoc.startsWith('..')) {
      redirectLoc = '/' + redirectLoc.replace(/^\.*\//, '');
    }
    if (!redirectLoc.startsWith('http')) {
      redirectLoc = `${MARPET_BASE}${redirectLoc}`;
    }
    await rateLimit();
    const vetPageRes = await fetch(redirectLoc, {
      headers: { Cookie: sessionCookie, 'User-Agent': UA },
      redirect: 'follow',
    });
    const nc3 = extractCookies(vetPageRes);
    if (nc3) sessionCookie = mergeCookies(sessionCookie, nc3);
    isLoggedIn = true;
    console.log('[marpet] Logged in successfully, reached:', vetPageRes.url);
  } else if (loginPost.status === 200) {
    const body2 = await loginPost.text();
    if (body2.includes('להזין') || body2.includes('Login-Veterinarians')) {
      throw new Error('[marpet] Login failed -- invalid credentials (MARPET_USERNAME/MARPET_PASSWORD)');
    }
    isLoggedIn = true;
    console.log('[marpet] Logged in (200 response)');
  } else {
    throw new Error(`[marpet] Login failed -- unexpected status ${loginPost.status}`);
  }
}

interface PetInfo {
  petName: string;
  gender: string;
  breed: string;
  getDatesParam: string; // e.g. "1646-premium-dog-1"
  isCat: boolean;
}

/**
 * Parse the search result HTML to extract pet info and get_dates call parameters.
 * The JS in the page contains: get_dates("1646-premium-dog-1");
 * The HTML contains: <b style="font-size:16px">גוצ'י</b> (זכר) כלב, שיצו
 */
function parsePetsFromHtml(html: string): PetInfo[] {
  const pets: PetInfo[] = [];

  // Extract all get_dates calls: get_dates("1646-premium-dog-1")
  const getDatesMatches = [...html.matchAll(/get_dates\("([^"]+)"\)/g)];
  if (getDatesMatches.length === 0) return pets;

  // Extract pet names and info: <b style="font-size:16px">PET_NAME</b> (זכר/נקבה) SPECIES, BREED
  // The pattern appears once per pet in the results section
  const petInfoMatches = [...html.matchAll(/<b style="font-size:16px">([^<]+)<\/b>\s*\((זכר|נקבה)\)\s*([^<\n]+)/g)];

  // Filter out owner names (they don't have gender in parens after them)
  // Owner rows look like: <b>אבי אללוף</b> (אשקלון)  -- city in parens
  // Pet rows: <b>גוצ'י</b> (זכר) כלב, שיצו
  const petRows = petInfoMatches.filter(m => m[2] === 'זכר' || m[2] === 'נקבה');

  for (let i = 0; i < getDatesMatches.length; i++) {
    const getDatesParam = getDatesMatches[i][1];
    // Determine if cat from the param: contains "cat"
    const isCat = getDatesParam.includes('-cat-');

    // Match with pet info by index
    const petRow = petRows[i];
    const petName = petRow ? petRow[1].trim() : `חיה ${i + 1}`;
    const gender = petRow ? petRow[2] : '';
    const speciesBreed = petRow ? petRow[3].trim() : '';

    pets.push({
      petName,
      gender,
      breed: speciesBreed,
      getDatesParam,
      isCat,
    });
  }

  return pets;
}

/**
 * Parse dates_of_entitles response into vaccine statuses.
 * Response format (after stripping BOM): #date0;date1;date2;date3;;\n
 * For dogs: [0]=כלבת, [1]=משושה, [2]=ת.הפארק, [3]=תילוע
 * For cats: [0]=מרובע, [1]=תילוע
 * Special values: "0/0/0" = eligible now (senior), "NOT" = not eligible
 * A date DD/MM/YYYY: if <= today = eligible (show as "זכאי"), if future = next eligible date
 */
function interpretDates(rawResponse: string, isCat: boolean): VaccineStatus[] {
  // Strip BOM and split by #
  const clean = rawResponse.replace(/\ufeff/g, '').trim();
  // Split by # to get per-pet sections (usually one section for this single-pet call)
  const sections = clean.split('#').filter(s => s.trim().length > 3);
  if (sections.length === 0) return [];

  const section = sections[0];
  const parts = section.split(';').map(s => s.trim());

  const vaccineNames = isCat ? CAT_VACCINE_NAMES : DOG_VACCINE_NAMES;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const vaccines: VaccineStatus[] = [];

  for (let i = 0; i < vaccineNames.length; i++) {
    const datePart = parts[i] || '';
    const vaccineName = vaccineNames[i];

    if (!datePart || datePart === 'NOT') {
      vaccines.push({ name: vaccineName, eligible: false, nextDate: null });
      continue;
    }

    if (datePart === '0/0/0') {
      // Senior/special — eligible now
      vaccines.push({ name: vaccineName, eligible: true, nextDate: null });
      continue;
    }

    // Parse DD/MM/YYYY
    const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dateMatch) {
      vaccines.push({ name: vaccineName, eligible: false, nextDate: datePart });
      continue;
    }

    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    const year = parseInt(dateMatch[3], 10);
    const nextDate = new Date(year, month, day);

    if (nextDate <= today) {
      // Date is in the past or today — eligible now
      vaccines.push({ name: vaccineName, eligible: true, nextDate: datePart });
    } else {
      // Future date — not yet eligible
      vaccines.push({ name: vaccineName, eligible: false, nextDate: datePart });
    }
  }

  return vaccines;
}

export async function fetchEligibilityForOwner(ownerTz: string): Promise<MarpetOwnerResult> {
  if (!isLoggedIn) {
    await loginMarpet();
  }

  const searchBody = new URLSearchParams({
    id_: ownerTz,
    chip: '',
    magnetic_code: '',
    card_code: '',
  });

  await rateLimit();
  const searchRes = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie,
      Referer: SEARCH_URL,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    body: searchBody.toString(),
    redirect: 'follow',
  });
  const newCookies = extractCookies(searchRes);
  sessionCookie = mergeCookies(sessionCookie, newCookies);
  const resultHtml = await searchRes.text();

  if (resultHtml.includes('Login-Veterinarians')) {
    console.log('[marpet] Session expired, re-logging in...');
    isLoggedIn = false;
    await loginMarpet();
    return fetchEligibilityForOwner(ownerTz);
  }

  // Not found in Marpet portal
  if (resultHtml.includes('לא נמצאו לקוחות')) {
    return {
      ownerTz,
      pets: [],
      fetchedAt: new Date().toISOString(),
      error: 'not found in marpet',
    };
  }

  // Parse pet info and get_dates params from the search result HTML
  const petInfos = parsePetsFromHtml(resultHtml);

  if (petInfos.length === 0) {
    return {
      ownerTz,
      pets: [],
      fetchedAt: new Date().toISOString(),
      error: 'owner found but no pets parsed',
    };
  }

  // For each pet, call dates_of_entitles.php to get actual eligibility dates
  const pets: PetEligibility[] = [];

  for (const petInfo of petInfos) {
    await rateLimit();
    const datesRes = await fetch(DATES_URL, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookie,
        Referer: SEARCH_URL,
      },
      body: `pet_id=${encodeURIComponent(petInfo.getDatesParam)}`,
    });
    const datesRaw = await datesRes.text();
    const vaccines = interpretDates(datesRaw, petInfo.isCat);

    pets.push({
      petName: petInfo.petName,
      gender: petInfo.gender,
      breed: petInfo.breed,
      vaccines,
    });
  }

  return {
    ownerTz,
    pets,
    fetchedAt: new Date().toISOString(),
  };
}

export function resetSession() {
  sessionCookie = '';
  isLoggedIn = false;
}

// Export session cookie for use by other modules
export function getSessionCookie(): string {
  return sessionCookie;
}
