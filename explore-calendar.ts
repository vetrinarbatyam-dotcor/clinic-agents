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

// Fetch the calendar page
r = await fetch(`${WBASE_URL}/vetclinic/managersA/newcalander.aspx`, {
  headers: { 'User-Agent': UA, Cookie: gc() },
});
cc(r);
const calHtml = await r.text();
console.log('Calendar page length:', calHtml.length);
console.log('Contains login redirect:', calHtml.includes('Login.aspx'));

if (!calHtml.includes('Login.aspx')) {
  // Find all ASMX references
  const asmxRefs = calHtml.match(/[a-zA-Z]+\.asmx\/[a-zA-Z]+/g);
  if (asmxRefs) console.log('\nASMX refs:', [...new Set(asmxRefs)]);

  // Find GetDayEvents context
  if (calHtml.includes('GetDayEvents')) {
    console.log('\n=== GetDayEvents found! ===');
    const matches = calHtml.match(/GetDayEvents[^;]{0,800}/g);
    matches?.forEach((m, i) => console.log(`[${i}]`, m.slice(0, 400)));
  }

  // Find all ajax calls
  const ajaxCalls = calHtml.match(/\$\.ajax\(\{[\s\S]{0,500}?\}\)/g);
  if (ajaxCalls) {
    console.log('\n=== $.ajax calls ===');
    ajaxCalls.forEach((c, i) => console.log(`[${i}]`, c.slice(0, 300)));
  }

  // Find function definitions
  const funcs = calHtml.match(/function\s+\w+\s*\([^)]*\)/g);
  if (funcs) {
    console.log('\n=== Functions ===');
    [...new Set(funcs)].forEach(f => console.log(' ', f));
  }

  // PageMethods
  const pm = calHtml.match(/PageMethods\.\w+/g);
  if (pm) console.log('\nPageMethods:', [...new Set(pm)]);

  // External JS files
  const jsFiles = calHtml.match(/src="([^"]*\.js[^"]*)"/g);
  if (jsFiles) {
    console.log('\nJS files:');
    [...new Set(jsFiles)].forEach(f => {
      if (!f.includes('jquery') && !f.includes('cdnjs')) console.log(' ', f);
    });
  }
}
