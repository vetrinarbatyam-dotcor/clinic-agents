import 'dotenv/config';
import { load } from 'cheerio';

const USERNAME = process.env.CLINICA_USERNAME || '';
const PASSWORD = process.env.CLINICA_PASSWORD || '';
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || '53';
const BASE_URL = process.env.CLINICA_BASE_URL || 'https://clinicaonline.co.il';
const WBASE_URL = process.env.CLINICA_WBASE_URL || 'https://www.clinicaonline.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

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

async function followRedirects(res: Response): Promise<Response> {
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
cc(res);
res = await followRedirects(res);
const loginHtml = await res.text();
const asp = ea(loginHtml);

const body1 = new URLSearchParams({ ...asp });
body1.set('ctl00$MainContent$Login1$UserName', USERNAME);
body1.set('ctl00$MainContent$Login1$Password', PASSWORD);
body1.set('ctl00$MainContent$Login1$LoginButton', 'כניסה');

res = await fetch(`${BASE_URL}/Login.aspx`, {
  method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: gc() },
  body: body1.toString(),
  redirect: 'manual',
});
cc(res);
res = await followRedirects(res);
const selectHtml = await res.text();
const asp2 = ea(selectHtml);

const body2 = new URLSearchParams({ ...asp2 });
body2.set('ctl00$MainContent$ClinicsList', CLINIC_ID);
body2.set('ctl00$MainContent$Button1', 'שלח');

res = await fetch(`${BASE_URL}/SelectClinic.aspx`, {
  method: 'POST',
  headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: gc() },
  body: body2.toString(),
  redirect: 'manual',
});
cc(res);
res = await followRedirects(res);

// Admin page
res = await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
cc(res);
const adminHtml = await res.text();
console.log('[login] OK, admin page length:', adminHtml.length);

// Extract all ASMX method references
const asmxRefs = adminHtml.match(/\.asmx\/\w+/g);
if (asmxRefs) {
  console.log('\nAll ASMX methods found in admin page:', [...new Set(asmxRefs)]);
}

// Search for GetDayEvents
const dayEventRefs = adminHtml.match(/GetDayEvents[^;]{0,300}/g);
if (dayEventRefs) {
  console.log('\nGetDayEvents context:');
  dayEventRefs.forEach(r => console.log('  ', r.slice(0, 200)));
}

// Search for any calendar/day loading functions
const funcMatches = adminHtml.match(/function\s+\w*(Day|Calendar|Yoman|Event|Load)\w*\s*\([^)]*\)/gi);
if (funcMatches) {
  console.log('\nRelevant functions:');
  [...new Set(funcMatches)].forEach(f => console.log('  ', f));
}

// Look for specific JS files loaded
const jsFiles = adminHtml.match(/src="[^"]*\.js[^"]*"/g);
if (jsFiles) {
  console.log('\nJS files loaded:');
  [...new Set(jsFiles)].slice(0, 20).forEach(f => console.log('  ', f));
}
