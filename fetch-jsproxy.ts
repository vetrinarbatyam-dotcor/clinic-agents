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

// Fetch JS proxy with auth cookies
const jsUrl = `${WBASE_URL}/Restricted/dbCalander.asmx/js`;
r = await fetch(jsUrl, { headers: { 'User-Agent': UA, Cookie: gc() } });
const jsProxy = await r.text();
console.log('JS proxy length:', jsProxy.length);

if (jsProxy.length > 200) {
  // Find all method names and their parameters
  const methods = jsProxy.match(/this\._invoke\(this\._get_path\(\),\s*'(\w+)'/g);
  if (methods) {
    console.log('\nMethods found:');
    methods.forEach(m => console.log(' ', m));
  }

  // Find GetDayEvents specifically
  const gde = jsProxy.indexOf('GetDayEvents');
  if (gde >= 0) {
    console.log('\n=== GetDayEvents context ===');
    console.log(jsProxy.slice(Math.max(0, gde - 200), gde + 600));
  }

  // Print first 5000 chars
  console.log('\n=== JS Proxy (first 5000) ===');
  console.log(jsProxy.slice(0, 5000));
} else {
  console.log('Content:', jsProxy);
}

// Also try fetching the jsdebug version
const jsDebugUrl = `${WBASE_URL}/Restricted/dbCalander.asmx/jsdebug`;
r = await fetch(jsDebugUrl, { headers: { 'User-Agent': UA, Cookie: gc() } });
const jsDebug = await r.text();
console.log('\nJS Debug length:', jsDebug.length);
if (jsDebug.length > 200 && jsDebug.length < 50000) {
  // Find GetDayEvents
  const gde2 = jsDebug.indexOf('GetDayEvents');
  if (gde2 >= 0) {
    console.log('\n=== GetDayEvents in debug ===');
    console.log(jsDebug.slice(Math.max(0, gde2 - 300), gde2 + 800));
  }
}
