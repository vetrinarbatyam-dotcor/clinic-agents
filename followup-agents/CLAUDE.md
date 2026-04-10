# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`followup-agents` — סוכן אוטומטי לשליחת הודעות מעקב WhatsApp ללקוחות המרפאה הווטרינרית יום אחרי ביקור.

## Architecture

Part of `clinic-agents` monorepo:
- `shared/clinica.ts` — ClinicaOnline API client (login, ASMX calls, pet session scanning)
- `shared/whatsapp.ts` — Green API WhatsApp sender
- `shared/supabase.ts` — Supabase client for agents/templates/pending_messages
- `followup-agents/src/index.ts` — Main entry point, runs daily at 09:45
- `followup-agents/src/classifier.ts` — Visit classification logic
- `followup-agents/src/message-builder.ts` — Template + AI message generation
- `dashboard/` — React web app for managing agents at http://167.86.69.208:3000

## Data Flow

1. Scan all pets from local PostgreSQL (`clinicpal` DB) 
2. For each pet, call `LoadPetSessions` on ClinicaOnline API (MM/DD/YYYY format!)
3. Classify each visit → medical / new-client / surgery / skip
4. Build personalized message (template + optional AI enrichment)
5. Save to `pending_messages` in Supabase (status=pending)
6. Send summary to Gil via WhatsApp
7. Gil approves/edits/rejects via dashboard → WhatsApp sent to client

## Classification Logic

### Follow-up (פולואפ):
- **Medical**: Session has `Finds` or `Notes` content, OR invoice `Items` include medical keywords (בדיקה רפואית, זריקה, צילום, אולטראסאונד, ריקון, הסרת, עירוי, צביעת, אשפוז, תפירה, שטיפת אוזניים, ניקוי שיניים, קיט, CBC, כימיה)
- **Surgery**: Keywords in Finds/Notes/Items (ניתוח, סירוס, עיקור, כריתה, ביופסיה, הסרת מסות) → follow-up NEXT DAY (if Shabbat → Sunday)
- **New client**: First vaccine (משושה/DP), registration date = visit date, puppy/kitten < 6 months, or no prior visits

### Skip (דילוג):
- Routine vaccines (כלבת, תולעת הפארק) without medical items
- Product-only purchases (מזון, שמפו, ברווקטו, סימפריקה, אפוקוול, גבאפנטין)
- No session found for the date
- Shabbat/holidays — postpone to next business day

## Important Notes

- **Date format**: ClinicaOnline uses MM/DD/YYYY (American), NOT DD/MM/YYYY
- **Phone numbers**: Not available from diary API — fetched from local PostgreSQL `clients` table
- **Therapists**: Only check visits from Gil Keren, Rufina, Paz Mano, Elad Raviv-Agmon, Maayan Mizrachi, Alina Kaplanov
- **Deduplication**: By PatientID (same owner with multiple pets = one follow-up)
- **All messages require approval** initially (configurable per-category in dashboard)

## Commands

```bash
bun run followup-agents/src/index.ts --dry-run  # Test without sending
bun run followup-agents/src/index.ts             # Production run
```

## Environment Variables

See `.env` — needs: CLINICA_*, GREEN_API_*, SUPABASE_*, DB_*, ANTHROPIC_API_KEY
