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
console.log('[login] OK');

// Search for ALL asmx calls in the admin page HTML
const adminHtml = await r.text();

// Find all references to .asmx in the entire page
const asmxAll = adminHtml.match(/[a-zA-Z]+\.asmx\/[a-zA-Z]+/g);
if (asmxAll) {
  console.log('\nAll .asmx/ references:', [...new Set(asmxAll)]);
}

// Find all ajax/fetch/$.ajax calls
const ajaxCalls = adminHtml.match(/\$\.ajax\([^)]{0,500}\)/g);
if (ajaxCalls) {
  console.log('\n$.ajax calls:', ajaxCalls.length);
  ajaxCalls.forEach((c, i) => console.log(`[${i}]`, c.slice(0, 200)));
}

// Search for PageMethods or __doPostBack
const pageMethods = adminHtml.match(/PageMethods\.\w+/g);
if (pageMethods) {
  console.log('\nPageMethods:', [...new Set(pageMethods)]);
}

// Look for iframes (calendar might be in an iframe)
const iframes = adminHtml.match(/<iframe[^>]*src="[^"]*"[^>]*>/g);
if (iframes) {
  console.log('\nIframes:');
  iframes.forEach(f => console.log(' ', f));
}

// Now try to find the actual calendar page - it might be a different aspx
const pages = [
  '/vetclinic/managers/Calander.aspx',
  '/vetclinic/managers/CalanderDay.aspx',
  '/vetclinic/managers/DayView.aspx',
  '/vetclinic/managers/YomanDay.aspx',
  '/vetclinic/VetYoman.aspx',
  '/vetclinic/Yoman.aspx',
  '/Restricted/VetYoman.aspx',
  '/Restricted/VetCalander.aspx',
  '/Restricted/CalanderDay.aspx',
];

console.log('\n=== Searching for calendar pages ===');
for (const page of pages) {
  try {
    const url = `${WBASE_URL}${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: gc() }, redirect: 'manual' });
    if (res.status === 200) {
      const html = await res.text();
      if (!html.includes('Login.aspx')) {
        console.log(`FOUND: ${page} (${html.length} bytes)`);
        // Look for GetDayEvents in this page
        if (html.includes('GetDayEvents')) {
          const idx = html.indexOf('GetDayEvents');
          console.log('  GetDayEvents context:', html.slice(Math.max(0, idx - 200), idx + 500));
        }
        // Look for asmx calls
        const refs = html.match(/[a-zA-Z]+\.asmx\/[a-zA-Z]+/g);
        if (refs) console.log('  ASMX refs:', [...new Set(refs)]);
      } else {
        console.log(`${page} -> redirects to login`);
      }
    } else {
      console.log(`${page} -> ${res.status}`);
    }
  } catch { }
}

// Check links in admin page for calendar-related links
const $ = load(adminHtml);
const links: string[] = [];
$('a[href]').each((_, el) => {
  const href = $(el).attr('href') || '';
  if (href.includes('alan') || href.includes('yoman') || href.includes('diary') || href.includes('day') || href.includes('Yoman') || href.includes('Day') || href.includes('Calan')) {
    links.push(href);
  }
});
if (links.length > 0) {
  console.log('\nCalendar-related links in admin:', [...new Set(links)]);
}

// Search for calendar-related div IDs or classes
const calDivs = adminHtml.match(/id="[^"]*[Cc]al[^"]*"|class="[^"]*[Cc]al[^"]*"/g);
if (calDivs) {
  console.log('\nCalendar divs:', [...new Set(calDivs)].slice(0, 10));
}
