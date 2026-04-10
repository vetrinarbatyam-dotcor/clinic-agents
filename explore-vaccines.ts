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

// Navigate to the patientlistvet page (vaccine expired list)
const targetUrl = `${WBASE_URL}/vetclinic/therapists/patientlistvet.aspx`;
r = await fetch(targetUrl, { headers: { "User-Agent": UA, Cookie: gc() } });
cc(r);
const html = await r.text();
console.log("Page length:", html.length);
console.log("Contains login redirect:", html.includes("Login.aspx"));

const $ = load(html);

// Find the page title
console.log("\nTitle:", $("title").text());
console.log("H1/H2:", $("h1, h2, .header, .title").text().slice(0, 200));

// Find forms and controls
console.log("\n=== Form Controls ===");
$("select").each((_, el) => {
  const id = $(el).attr("id") || $(el).attr("name") || "?";
  const options: string[] = [];
  $(el).find("option").each((_, opt) => {
    options.push(`${$(opt).val()}:${$(opt).text().trim()}`);
  });
  console.log(`SELECT ${id}: ${options.slice(0, 15).join(" | ")}`);
});

$("input[type=text], input[type=date], input[type=number]").each((_, el) => {
  const id = $(el).attr("id") || $(el).attr("name") || "?";
  const val = $(el).attr("value") || "";
  console.log(`INPUT ${id}: "${val}"`);
});

$("input[type=checkbox], input[type=radio]").each((_, el) => {
  const id = $(el).attr("id") || $(el).attr("name") || "?";
  const checked = $(el).attr("checked") ? "CHECKED" : "";
  console.log(`CHECK ${id}: ${checked}`);
});

// Find buttons
$("input[type=submit], input[type=button], button, a.btn, .button").each((_, el) => {
  const id = $(el).attr("id") || $(el).attr("name") || "?";
  const text = $(el).attr("value") || $(el).text().trim();
  console.log(`BUTTON ${id}: "${text}"`);
});

// Find tables
console.log("\n=== Tables ===");
$("table").each((i, el) => {
  const rows = $(el).find("tr").length;
  const headers = $(el).find("th").map((_, th) => $(th).text().trim()).get();
  console.log(`Table ${i}: ${rows} rows | headers: ${headers.join(", ")}`);
  // Show first 3 data rows
  $(el).find("tr").slice(1, 4).each((j, tr) => {
    const cells = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    console.log(`  Row ${j}: ${cells.join(" | ")}`);
  });
});

// Find ASMX / ajax references
const asmx = html.match(/[a-zA-Z]+\.asmx\/[a-zA-Z]+/g);
if (asmx) console.log("\nASMX refs:", [...new Set(asmx)]);

// Find __doPostBack targets
const postbacks = html.match(/__doPostBack\([^)]+\)/g);
if (postbacks) {
  console.log("\n__doPostBack calls:", [...new Set(postbacks)].slice(0, 15));
}

// PageMethods
const pm = html.match(/PageMethods\.\w+/g);
if (pm) console.log("\nPageMethods:", [...new Set(pm)]);

// Look for grid/data controls
const gridIds = html.match(/id="[^"]*(?:grid|Grid|gv|GV|list|List|repeat|Repeat|dg|DG)[^"]*"/g);
if (gridIds) console.log("\nGrid controls:", [...new Set(gridIds)]);

