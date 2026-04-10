import 'dotenv/config';
import { load } from 'cheerio';

const USERNAME = process.env.CLINICA_USERNAME || '';
const PASSWORD = process.env.CLINICA_PASSWORD || '';
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || '53';
const BASE_URL = process.env.CLINICA_BASE_URL || 'https://clinicaonline.co.il';
const WBASE_URL = process.env.CLINICA_WBASE_URL || 'https://www.clinicaonline.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

let cookies: string[] = [];

function getCookieHeader(): string {
  return cookies.map(c => c.split(';')[0]).join('; ');
}

function collectCookies(res: Response) {
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const name = sc.split('=')[0];
    cookies = cookies.filter(c => !c.startsWith(name + '='));
    cookies.push(sc);
  }
}

function extractAspFields(html: string): Record<string, string> {
  const $ = load(html);
  const fields: Record<string, string> = {};
  for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION', '__EVENTTARGET', '__EVENTARGUMENT', '__sc']) {
    const val = $(`input[name="${name}"]`).val();
    if (val) fields[name] = val as string;
  }
  return fields;
}

// Login
async function login() {
  const loginUrl = `${BASE_URL}/Login.aspx`;
  let res = await fetch(loginUrl, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  collectCookies(res);
  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    const url = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: getCookieHeader() }, redirect: 'manual' });
    collectCookies(res);
  }
  const loginHtml = await res.text();
  const asp = extractAspFields(loginHtml);

  const loginData = new URLSearchParams({
    ...asp,
    'ctl00$MainContent$Login1$UserName': USERNAME,
    'ctl00$MainContent$Login1$Password': PASSWORD,
    'ctl00$MainContent$Login1$LoginButton': 'כניסה',
  });

  res = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: getCookieHeader() },
    body: loginData.toString(),
    redirect: 'manual',
  });
  collectCookies(res);

  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    const url = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: getCookieHeader() }, redirect: 'manual' });
    collectCookies(res);
  }

  const selectHtml = await res.text();
  const asp2 = extractAspFields(selectHtml);
  const selectData = new URLSearchParams({
    ...asp2,
    'ctl00$MainContent$ClinicsList': CLINIC_ID,
    'ctl00$MainContent$Button1': 'שלח',
  });

  res = await fetch(`${BASE_URL}/SelectClinic.aspx`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: getCookieHeader() },
    body: selectData.toString(),
    redirect: 'manual',
  });
  collectCookies(res);

  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    const url = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: getCookieHeader() }, redirect: 'manual' });
    collectCookies(res);
  }

  // Warm up
  res = await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`, {
    headers: { 'User-Agent': UA, Cookie: getCookieHeader() },
    redirect: 'manual',
  });
  collectCookies(res);

  console.log('[login] OK');
}

await login();

// Now fetch the diary page with auth cookies
const diaryPages = [
  '/vetclinic/managers/admin.aspx',
  '/Restricted/Calander.aspx',
  '/Restricted/Calendar.aspx',
];

for (const page of diaryPages) {
  const url = `${WBASE_URL}${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: getCookieHeader() },
    redirect: 'follow',
  });
  const html = await res.text();
  console.log(`\n=== ${page} === status: ${res.status}, length: ${html.length}`);

  // Look for ASMX calls in the JavaScript
  const asmxCalls = html.match(/dbCalander\.asmx\/\w+/g);
  if (asmxCalls) {
    console.log('ASMX calls found:', [...new Set(asmxCalls)]);
  }

  // Look for other asmx endpoints
  const otherAsmx = html.match(/\w+\.asmx\/\w+/g);
  if (otherAsmx) {
    console.log('All ASMX methods:', [...new Set(otherAsmx)]);
  }

  // Look for function names related to diary/calendar
  const funcs = html.match(/function\s+(get|load|fetch|show)\w*Day\w*/gi);
  if (funcs) {
    console.log('Day functions:', funcs);
  }
}
