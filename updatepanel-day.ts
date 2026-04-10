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

// Get calendar page
r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
cc(r);
const calHtml = await r.text();
const aspCal = ea(calHtml);

// Do an UpdatePanel (async) postback for April 3
const postData = new URLSearchParams({
  'ctl00$ScriptManager12': 'ctl00$MainContent$UpdatePanel1|ctl00$MainContent$Calendar1',
  ...aspCal,
  __EVENTTARGET: 'ctl00$MainContent$Calendar1',
  __EVENTARGUMENT: '9589', // April 3
  __ASYNCPOST: 'true',
});

r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'X-MicrosoftAjax': 'Delta=true',
    Cookie: gc(),
  },
  body: postData.toString(),
});
cc(r);
const deltaResponse = await r.text();
console.log('Delta response length:', deltaResponse.length);

// Parse the delta response - it contains pipe-delimited sections
// Format: length|type|id|content|
const sections = deltaResponse.split('|');
console.log('Sections count:', sections.length);

// Look for HTML content sections (type = "updatePanel")
let htmlContent = '';
for (let i = 0; i < sections.length - 3; i++) {
  if (sections[i + 1] === 'updatePanel') {
    const len = parseInt(sections[i]);
    const id = sections[i + 2];
    const content = sections[i + 3];
    console.log(`\nUpdatePanel: ${id} (${len} chars)`);
    htmlContent += content;
  }
}

if (htmlContent) {
  const $ = load(htmlContent);

  // Find event/appointment elements
  const allText = $('body').text() || $.text();

  // Look for appointment divs, spans with names
  const eventElements = $('[class*="event"], [class*="appoint"], [class*="one_new"], [class*="session"], .tdinday, [class*="diary"]');
  console.log('\nEvent elements:', eventElements.length);
  eventElements.each((i, el) => {
    const text = $(el).text().trim();
    if (text.length > 3 && text.length < 300) {
      console.log(`  [${i}]`, text.slice(0, 150));
    }
  });

  // Just look for any Hebrew names in the content
  const hebrewNames = htmlContent.match(/[\u0590-\u05FF]{2,}\s+[\u0590-\u05FF]{2,}/g);
  if (hebrewNames) {
    console.log('\nHebrew name pairs:', [...new Set(hebrewNames)].slice(0, 20));
  }

  // Look for phone numbers
  const phones = htmlContent.match(/0\d{2}[-\s]?\d{7}/g);
  if (phones) console.log('Phones:', [...new Set(phones)]);

  // Look for time patterns (HH:MM)
  const times = htmlContent.match(/\d{1,2}:\d{2}/g);
  if (times) console.log('Times:', [...new Set(times)].slice(0, 20));

  // Print a chunk of the raw HTML to understand structure
  console.log('\n=== Raw HTML sample (first 3000 chars) ===');
  console.log(htmlContent.slice(0, 3000));
}
