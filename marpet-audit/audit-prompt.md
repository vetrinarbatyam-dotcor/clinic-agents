# Marpet Daily Audit — Linux/Server Run

You are running the **marpat-daily-audit** skill on the Contabo server (Linux). All paths are Linux-style.

## Working directory
`/home/claude-user/marpat/`  (NOT `C:\Users\user\marpat\`)

## Pipeline

Follow `~/.claude/skills/marpat-daily-audit/SKILL.md` with these Linux adaptations:

### Stage 1 — Gmail
Use the **claude.ai Gmail MCP** (`gmail_search_messages` / `gmail_read_message`) — already connected on this server.
Save parsed CSVs to `/home/claude-user/marpat/marpet_vaccines_{date}.csv` and `/home/claude-user/marpat/marpet_treatments_{date}.csv`.

Helper:
```bash
PYTHONUTF8=1 python3 /home/claude-user/clinic-agents/marpet-audit/scripts/build_marpet_csvs.py <json_file> /home/claude-user/marpat <date_label>
```

### Stage 2 — Clinic data
**Do NOT use Chrome MCP** — not available on server.

Local PostgreSQL data warehouse (`clinicpal` on localhost) is synced daily at 03:00. Query it directly to produce:
- `clinic_vaccines_{date}.csv` — columns: `שם הלקוח`, `תז`, `טלפון`, `שם החיה`, `תאריך ביצוע החיסון`, `חיסון`
- `clinic_treatments_{date}.csv` — columns: `שם הלקוח`, `תז`, `טלפון`, `שם החיה`, `תאריך הביקור`, `פריט`, `כמות`, `מחיר פריט`

Connection: `psql postgresql://clinicpal_user:clinicpal2306@localhost/clinicpal`

If the warehouse lacks data for the date, fall back to ClinicaOnline ASMX via `~/clinic-agents/shared/clinica.ts`.

### Stage 3 — Audit scripts
```bash
PYTHONUTF8=1 python3 /home/claude-user/clinic-agents/marpet-audit/scripts/vaccine_audit.py \
  /home/claude-user/marpat/clinic_vaccines_{date}.csv \
  /home/claude-user/marpat/marpet_vaccines_{date}.csv \
  /home/claude-user/marpat/vaccine_audit_{date}.xlsx

PYTHONUTF8=1 python3 /home/claude-user/clinic-agents/marpet-audit/scripts/treatments_audit.py \
  /home/claude-user/marpat/clinic_treatments_{date}.csv \
  /home/claude-user/marpat/marpet_treatments_{date}.csv \
  /home/claude-user/marpat/treatment_audit_{date}.xlsx

PYTHONUTF8=1 python3 /home/claude-user/clinic-agents/marpet-audit/scripts/combine_bikoret.py \
  /home/claude-user/marpat/vaccine_audit_{date}.xlsx \
  /home/claude-user/marpat/treatment_audit_{date}.xlsx \
  /home/claude-user/marpat/bikoret_{date}.xlsx
```

### Stage 4 — Output
Email + WhatsApp + Supabase are handled by the wrapper TypeScript (`post-audit.ts`) AFTER you finish. Do NOT send anything yourself.

Final stdout line MUST be:
```
RESULT_JSON: {"status":"success","date":"YYYY-MM-DD","excel":"/home/claude-user/marpat/bikoret_YYYY-MM-DD.xlsx"}
```
or on failure:
```
RESULT_JSON: {"status":"failed","date":"YYYY-MM-DD","error":"..."}
```

## Categories to flag (per spec)
1. Vaccines done in clinic but not reported to Marpet
2. Vaccines reported to Marpet but not done in clinic
3. Medical visits not reported to Marpet (excluding referrals/הפניות)
