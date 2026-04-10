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
r=await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`,{headers:{'User-Agent':UA,Cookie:gc()}}); cc(r);
const adminHtml = await r.text();
console.log('[login] OK');

// Now look for calendar links - they should be <a> tags with onclick or href to specific dates
const $ = load(adminHtml);

// Find all links with dates or day numbers in the calendar
const calLinks: string[] = [];
$('a').each((_, el) => {
  const href = $(el).attr('href') || '';
  const onclick = $(el).attr('onclick') || '';
  const text = $(el).text().trim();
  const title = $(el).attr('title') || '';

  if (href.includes('postback') || href.includes('Calander') || href.includes('selectDay') ||
      href.includes('__doPostBack') || onclick.includes('day') || onclick.includes('Day') ||
      title.includes('April') || title.includes('אפריל')) {
    calLinks.push(`text="${text}" href="${href.slice(0, 150)}" onclick="${onclick.slice(0, 100)}" title="${title}"`);
  }
});

console.log('\nCalendar links:', calLinks.length);
calLinks.slice(0, 20).forEach((l, i) => console.log(`  [${i}]`, l));

// Also check for any calendar widget with day links
$('td a').each((_, el) => {
  const href = $(el).attr('href') || '';
  const text = $(el).text().trim();
  if (/^\d{1,2}$/.test(text) && href.includes('javascript')) {
    calLinks.push(`Day ${text}: ${href.slice(0, 200)}`);
  }
});

console.log('\nDay number links:');
calLinks.filter(l => l.startsWith('Day ')).slice(0, 10).forEach(l => console.log(' ', l));

// Search for newcalander.aspx specific content
const calPage = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
const calPageHtml = await calPage.text();
const $c = load(calPageHtml);

// Find day links in calendar page
console.log('\n=== newcalander.aspx day links ===');
$c('a').each((_, el) => {
  const href = $c(el).attr('href') || '';
  const text = $c(el).text().trim();
  const title = $c(el).attr('title') || '';
  if (/^\d{1,2}$/.test(text)) {
    console.log(`  Day ${text}: href="${href.slice(0, 200)}" title="${title}"`);
  }
});

// Look for any links that navigate to a day view
$c('a[href*="aspx"]').each((_, el) => {
  const href = $c(el).attr('href') || '';
  const text = $c(el).text().trim();
  if (text.length < 50 && href.length > 5) {
    console.log(`  Link: "${text}" -> ${href.slice(0, 150)}`);
  }
});
