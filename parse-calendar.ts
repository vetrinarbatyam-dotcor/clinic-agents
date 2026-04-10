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

// Fetch calendar page
r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
cc(r);
const calHtml = await r.text();
const $ = load(calHtml);

// Find the calendar/table structure with events
console.log('Title:', $('title').text());
console.log('H1/H2:', $('h1, h2').text().slice(0, 200));

// Look for table cells with data
const tds = $('td');
console.log('Total TD elements:', tds.length);

// Find cells that look like calendar events (contain text)
const eventCells: string[] = [];
tds.each((_, el) => {
  const text = $(el).text().trim();
  const cls = $(el).attr('class') || '';
  const style = $(el).attr('style') || '';
  if (text.length > 5 && text.length < 200 && !text.includes('__VIEWSTATE')) {
    eventCells.push(`[${cls}] ${text.slice(0, 100)}`);
  }
});

console.log('\nEvent-like cells:', eventCells.length);
eventCells.slice(0, 30).forEach((c, i) => console.log(`  [${i}]`, c));

// Look for names that match known clients
const pageText = $('body').text();
const knownNames = ['מוריס', 'גורמזנו', 'נלה', 'גיל', 'קרן'];
for (const name of knownNames) {
  if (pageText.includes(name)) {
    const idx = pageText.indexOf(name);
    console.log(`\nFound "${name}" at index ${idx}:`, pageText.slice(Math.max(0, idx - 50), idx + 80));
  }
}

// Look for date references
const dateRefs = pageText.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
if (dateRefs) {
  console.log('\nDates found:', [...new Set(dateRefs)].slice(0, 10));
}

// Find any hidden fields or data attributes with event data
const hiddenFields = $('input[type="hidden"]');
hiddenFields.each((_, el) => {
  const name = $(el).attr('name') || '';
  const val = ($(el).attr('value') || '').slice(0, 200);
  if (name && !name.startsWith('__') && val.length > 10) {
    console.log(`\nHidden: ${name} = ${val}`);
  }
});
