import 'dotenv/config';
import { load } from 'cheerio';
import { callAsmx } from './shared/clinica';

const BASE_URL = process.env.CLINICA_BASE_URL || 'https://clinicaonline.co.il';
const WBASE_URL = process.env.CLINICA_WBASE_URL || 'https://www.clinicaonline.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const USERNAME = process.env.CLINICA_USERNAME || '';
const PASSWORD = process.env.CLINICA_PASSWORD || '';
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || '53';

let cookies: string[] = [];
function gc() { return cookies.map(c => c.split(';')[0]).join('; '); }
function cc(res: Response) { for (const sc of res.headers.getSetCookie?.() || []) { const n = sc.split('=')[0]; cookies = cookies.filter(c => !c.startsWith(n + '=')); cookies.push(sc); } }

function ea(html: string) {
  const $ = load(html);
  const f: Record<string, string> = {};
  for (const n of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    const v = $(`input[name="${n}"]`).val();
    if (v) f[n] = v as string;
  }
  return f;
}

async function follow(res: Response): Promise<Response> {
  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    const url = loc.startsWith('http') ? loc : `${BASE_URL}${loc}`;
    res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: gc() }, redirect: 'manual' });
    cc(res);
  }
  return res;
}

// Login
let res = await fetch(`${BASE_URL}/Login.aspx`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
cc(res); res = await follow(res);
const lh = await res.text(); const asp = ea(lh);
const b1 = new URLSearchParams({ ...asp });
b1.set('ctl00$MainContent$Login1$UserName', USERNAME);
b1.set('ctl00$MainContent$Login1$Password', PASSWORD);
b1.set('ctl00$MainContent$Login1$LoginButton', 'כניסה');
res = await fetch(`${BASE_URL}/Login.aspx`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: gc() }, body: b1.toString(), redirect: 'manual' });
cc(res); res = await follow(res);
const sh = await res.text(); const asp2 = ea(sh);
const b2 = new URLSearchParams({ ...asp2 });
b2.set('ctl00$MainContent$ClinicsList', CLINIC_ID);
b2.set('ctl00$MainContent$Button1', 'שלח');
res = await fetch(`${BASE_URL}/SelectClinic.aspx`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: gc() }, body: b2.toString(), redirect: 'manual' });
cc(res); res = await follow(res);

// Now fetch the admin page with cookies
res = await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`, { headers: { 'User-Agent': UA, Cookie: gc() } });
cc(res);
const adminHtml = await res.text();
console.log('Admin page loaded, length:', adminHtml.length);

// Extract ALL inline JavaScript and search for GetDayEvents
const allJs = adminHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
console.log('Script blocks found:', allJs.length);

for (let i = 0; i < allJs.length; i++) {
  const js = allJs[i];
  if (js.includes('GetDayEvents') || js.includes('getDayEvents') || js.includes('DayEvent')) {
    console.log(`\n=== Script block ${i} contains GetDayEvents ===`);
    // Extract surrounding context
    const idx = js.indexOf('GetDayEvents');
    if (idx >= 0) {
      const start = Math.max(0, idx - 300);
      const end = Math.min(js.length, idx + 500);
      console.log(js.slice(start, end));
    }
  }
}

// Also search the entire HTML for GetDayEvents references
const allRefs = adminHtml.match(/GetDayEvents[^;]{0,500}/g);
if (allRefs) {
  console.log('\n=== All GetDayEvents references in HTML ===');
  allRefs.forEach((r, i) => console.log(`[${i}]`, r.slice(0, 300)));
}

// Search for any calendar/day-related JS function definitions
const dayFuncs = adminHtml.match(/function\s+\w*[Dd]ay\w*\([^)]*\)\s*\{[^}]{0,500}/g);
if (dayFuncs) {
  console.log('\n=== Day-related functions ===');
  dayFuncs.forEach((f, i) => console.log(`[${i}]`, f.slice(0, 300)));
}

// Look for external JS files that might contain the calendar logic
const externalJs = adminHtml.match(/src="([^"]*\.js[^"]*)"/g);
if (externalJs) {
  console.log('\n=== External JS files ===');
  for (const src of [...new Set(externalJs)]) {
    const url = src.replace('src="', '').replace('"', '');
    if (url.includes('jquery') || url.includes('cdnjs')) continue;
    console.log(url);
    // Fetch and search for GetDayEvents
    try {
      const fullUrl = url.startsWith('http') ? url : `${WBASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
      const jsRes = await fetch(fullUrl, { headers: { 'User-Agent': UA, Cookie: gc() } });
      const jsText = await jsRes.text();
      if (jsText.includes('GetDayEvents')) {
        console.log('  ^^^ Contains GetDayEvents!');
        const idx = jsText.indexOf('GetDayEvents');
        console.log('  Context:', jsText.slice(Math.max(0, idx - 200), idx + 400));
      }
    } catch {}
  }
}

// Also look for ScriptManager/WebService references
const wsRefs = adminHtml.match(/ServicePath[^"]*"[^"]*"/g);
if (wsRefs) {
  console.log('\n=== WebService paths ===');
  wsRefs.forEach(w => console.log(w));
}
