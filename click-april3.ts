import 'dotenv/config';
import { load } from 'cheerio';

const BASE_URL = process.env.CLINICA_BASE_URL || 'https://clinicaonline.co.il';
const WBASE_URL = process.env.CLINICA_WBASE_URL || 'https://www.clinicaonline.co.il';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const USERNAME = process.env.CLINICA_USERNAME || '';
const PASSWORD = process.env.CLINICA_PASSWORD || '';
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || '53';

let cookies: string[] = [];
function gc() { return cookies.map(c => c.split(';')[0]).join('; '); }
function cc(res: Response) { for (const sc of res.headers.getSetCookie?.() || []) { const n = sc.split('=')[0]; cookies = cookies.filter(c => !c.startsWith(n + '=')); cookies.push(sc); } }
function ea(html: string) { const $ = load(html); const f: Record<string, string> = {}; for (const n of ['__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION']) { const v = $(`input[name="${n}"]`).val(); if(v) f[n]=v as string; } return f; }
async function follow(res: Response) { while(res.status>=300&&res.status<400) { const l=res.headers.get('location')||''; const u=l.startsWith('http')?l:`${BASE_URL}${l}`; res=await fetch(u,{headers:{'User-Agent':UA,Cookie:gc()},redirect:'manual'}); cc(res); } return res; }

// Login
let r = await fetch(`${BASE_URL}/Login.aspx`,{headers:{'User-Agent':UA},redirect:'manual'}); cc(r); r=await follow(r);
const lh=await r.text(); const a1=ea(lh); const b1=new URLSearchParams({...a1}); b1.set('ctl00$MainContent$Login1$UserName',USERNAME); b1.set('ctl00$MainContent$Login1$Password',PASSWORD); b1.set('ctl00$MainContent$Login1$LoginButton','כניסה');
r=await fetch(`${BASE_URL}/Login.aspx`,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded',Cookie:gc()},body:b1.toString(),redirect:'manual'}); cc(r); r=await follow(r);
const sh=await r.text(); const a2=ea(sh); const b2=new URLSearchParams({...a2}); b2.set('ctl00$MainContent$ClinicsList',CLINIC_ID); b2.set('ctl00$MainContent$Button1','שלח');
r=await fetch(`${BASE_URL}/SelectClinic.aspx`,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded',Cookie:gc()},body:b2.toString(),redirect:'manual'}); cc(r); r=await follow(r);
r=await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`,{headers:{'User-Agent':UA,Cookie:gc()}}); cc(r); await r.text();
console.log('[login] OK');

// First, get the calendar page to get ASP fields
r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
cc(r);
const calHtml = await r.text();
const aspCal = ea(calHtml);
console.log('Calendar page loaded, VIEWSTATE length:', aspCal.__VIEWSTATE?.length);

// Now do a __doPostBack to click on April 3 (code 9589)
const postData = new URLSearchParams({
  ...aspCal,
  __EVENTTARGET: 'ctl00$MainContent$Calendar1',
  __EVENTARGUMENT: '9589',
});

r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: gc(),
  },
  body: postData.toString(),
  redirect: 'manual',
});
cc(r);
r = await follow(r);
const dayHtml = await r.text();
console.log('Day page response length:', dayHtml.length);
console.log('Still on calendar?', dayHtml.includes('Calendar1'));

const $ = load(dayHtml);

// Look for events/appointments in the day view
const bodyText = $('body').text();

// Check for client names, times, etc.
console.log('\n=== Page content (trimmed) ===');
// Get non-navigation text
const contentArea = $('#MainContent, .content, #content, [class*="event"], [class*="appoint"]');
if (contentArea.length) {
  console.log('Content area:', contentArea.text().slice(0, 2000));
} else {
  // Get all text that looks like event data
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 200);
  const relevant = lines.filter(l =>
    !l.includes('__VIEWSTATE') && !l.includes('function') && !l.includes('var ') &&
    !l.includes('<!') && !l.includes('border') && !l.includes('width:')
  );
  console.log('Relevant lines:');
  relevant.slice(0, 50).forEach((l, i) => console.log(`  [${i}]`, l));
}

// Look for a table with events
$('table').each((i, table) => {
  const text = $(table).text().trim();
  if (text.length > 50 && text.length < 5000 && (text.includes(':') || text.includes('תור'))) {
    console.log(`\n=== Table ${i} (${text.length} chars) ===`);
    console.log(text.slice(0, 1000));
  }
});
