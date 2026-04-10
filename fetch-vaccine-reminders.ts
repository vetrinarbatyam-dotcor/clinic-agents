import "dotenv/config";
import { load } from "cheerio";

const BASE_URL = process.env.CLINICA_BASE_URL || "https://clinicaonline.co.il";
const WBASE_URL = process.env.CLINICA_WBASE_URL || "https://www.clinicaonline.co.il";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const USERNAME = process.env.CLINICA_USERNAME || "";
const PASSWORD = process.env.CLINICA_PASSWORD || "";
const CLINIC_ID = process.env.CLINICA_CLINIC_ID || "53";

let cookies: string[] = [];
function gc() { return cookies.map(c => c.split(";")[0]).join("; "); }
function cc(res: Response) { for (const sc of res.headers.getSetCookie?.() || []) { const n = sc.split("=")[0]; cookies = cookies.filter(c => !c.startsWith(n + "=")); cookies.push(sc); } }
function ea(html: string) { const $ = load(html); const f: Record<string, string> = {}; for (const n of ["__VIEWSTATE","__VIEWSTATEGENERATOR","__EVENTVALIDATION"]) { const v = $(`input[name="${n}"]`).val(); if(v) f[n]=v as string; } return f; }
async function follow(res: Response) { while(res.status>=300&&res.status<400) { const l=res.headers.get("location")||""; const u=l.startsWith("http")?l:`${BASE_URL}${l}`; res=await fetch(u,{headers:{"User-Agent":UA,Cookie:gc()},redirect:"manual"}); cc(res); } return res; }

// Login
let r = await fetch(`${BASE_URL}/Login.aspx`,{headers:{"User-Agent":UA},redirect:"manual"}); cc(r); r=await follow(r);
const lh=await r.text(); const a1=ea(lh); const b1=new URLSearchParams({...a1}); b1.set("ctl00$MainContent$Login1$UserName",USERNAME); b1.set("ctl00$MainContent$Login1$Password",PASSWORD); b1.set("ctl00$MainContent$Login1$LoginButton","כניסה");
r=await fetch(`${BASE_URL}/Login.aspx`,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/x-www-form-urlencoded",Cookie:gc()},body:b1.toString(),redirect:"manual"}); cc(r); r=await follow(r);
const sh=await r.text(); const a2=ea(sh); const b2=new URLSearchParams({...a2}); b2.set("ctl00$MainContent$ClinicsList",CLINIC_ID); b2.set("ctl00$MainContent$Button1","שלח");
r=await fetch(`${BASE_URL}/SelectClinic.aspx`,{method:"POST",headers:{"User-Agent":UA,"Content-Type":"application/x-www-form-urlencoded",Cookie:gc()},body:b2.toString(),redirect:"manual"}); cc(r); r=await follow(r);
r=await fetch(`${WBASE_URL}/vetclinic/managers/admin.aspx`,{headers:{"User-Agent":UA,Cookie:gc()}}); cc(r); await r.text();
console.log("[login] OK");

// First, get the page with the vaccine reminders section
const pageUrl = `${WBASE_URL}/vetclinic/therapists/patientlistvet.aspx`;
r = await fetch(pageUrl, { headers: { "User-Agent": UA, Cookie: gc() } });
cc(r);
const pageHtml = await r.text();

// Find the JavaScript that handles the selectlaters dropdown and vaccine reminders
// Search for key function names related to selectlaters and vaccine data loading
const $ = load(pageHtml);

// Look for inline scripts that reference selectlaters, gridContainer, or vaccine-related code
const scripts = $("script").map((_, el) => $(el).html() || "").get();
const allJs = scripts.join("\n");

// Find functions that handle the vaccine/reminder section
const selectlatersRef = allJs.match(/selectlaters[^;]{0,500}/g);
if (selectlatersRef) {
  console.log("\n=== selectlaters references ===");
  selectlatersRef.forEach((s, i) => console.log(`[${i}]`, s.slice(0, 300)));
}

// Look for loadLaters or similar function
const latersFuncs = allJs.match(/(?:function\s+)?(?:load|get|show|display|fetch)[Ll]ater[^{]*\{[^}]{0,800}\}/g);
if (latersFuncs) {
  console.log("\n=== Laters-related functions ===");
  latersFuncs.forEach((f, i) => console.log(`[${i}]`, f.slice(0, 500)));
}

// Look for any AJAX call that might fetch vaccine reminder data
const ajaxCalls = allJs.match(/\$\.ajax\(\{[\s\S]{0,800}?\}\)/g);
if (ajaxCalls) {
  console.log("\n=== $.ajax calls ===");
  ajaxCalls.forEach((c, i) => {
    if (c.includes("later") || c.includes("vaccin") || c.includes("remind") || c.includes("חיסון") || c.includes("תזכורת")) {
      console.log(`[${i}]`, c.slice(0, 600));
    }
  });
}

// Look for PageMethods that might load vaccine data
const pageMethods = allJs.match(/PageMethods\.\w+\([^)]*\)/g);
if (pageMethods) {
  console.log("\n=== PageMethods calls ===");
  [...new Set(pageMethods)].forEach(pm => console.log(" ", pm.slice(0, 200)));
}

// Look for any function with "laters" or "vaccine" or "חיסון" or "reminder" or "תזכורת"
const vaccineCode = allJs.match(/[^\n]{0,200}(?:later|Later|vaccin|Vaccin|חיסון|תזכורת|remind|Remind)[^\n]{0,200}/g);
if (vaccineCode) {
  console.log("\n=== Vaccine/Reminder code lines ===");
  [...new Set(vaccineCode)].slice(0, 30).forEach((line, i) => console.log(`[${i}]`, line.trim().slice(0, 300)));
}

// Look for the gridContainer div and its data-loading mechanism
const gridCode = allJs.match(/gridContainer[^;]{0,500}/g);
if (gridCode) {
  console.log("\n=== gridContainer references ===");
  gridCode.forEach((g, i) => console.log(`[${i}]`, g.slice(0, 300)));
}

// Search for "dbCalander.asmx" calls (we know this exists)
const asmxCalls = allJs.match(/dbCalander\.asmx\/\w+[^;]{0,400}/g);
if (asmxCalls) {
  console.log("\n=== dbCalander.asmx calls ===");
  [...new Set(asmxCalls)].forEach((c, i) => console.log(`[${i}]`, c.slice(0, 400)));
}
