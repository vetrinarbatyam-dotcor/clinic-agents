# CLAUDE.md

## Project Overview

`remind-agent` — סוכן תזכורות חיסונים למרפאת פט קייר. סורק חיסונים שפג תוקפם ב-ClinicaOnline ושולח הודעות WhatsApp מותאמות לבעלי חיות.

## Architecture

Part of `clinic-agents` monorepo:
- `shared/clinica.ts` — ClinicaOnline API client
- `shared/whatsapp.ts` — Green API WhatsApp sender
- `shared/supabase.ts` — Supabase client for agents/pending_messages
- `remind-agent/src/index.ts` — Entry point
- `remind-agent/src/vaccine-scanner.ts` — Fetch & filter expired vaccines via GetVaccineLaters API
- `remind-agent/src/vaccine-deep-scan.ts` — Deep scan for old expired vaccines (configurable years)
- `remind-agent/src/message-builder.ts` — Template-based message generation
- `dashboard/` — React web app at http://167.86.69.208:3000

## Data Flow

1. Call `GetVaccineLaters` API on ClinicaOnline (returns expired vaccines with owner info)
2. Filter: valid phone, not confirmed, no existing appointment
3. Group by owner (deduplicate multiple pets/vaccines per owner)
4. Build personalized WhatsApp message from templates
5. Save to `pending_messages` in Supabase (status=pending)
6. Send summary to Gil via WhatsApp
7. Gil approves/edits/rejects via dashboard → WhatsApp sent to client

## Modes

### Regular mode (weekly)
```bash
bun run remind-agent/src/index.ts            # Production
bun run remind-agent/src/index.ts --dry-run  # Test
```
Scans last year of expired vaccines, sends reminders for recently expired.

### Deep scan (on-demand)
```bash
bun run remind-agent/src/index.ts --deep-scan              # 3 years default
bun run remind-agent/src/index.ts --deep-scan --years 5    # 5 years back
bun run remind-agent/src/index.ts --deep-scan --dry-run    # Test
```
Scans multiple years, finds clients who dropped off. Configurable via dashboard.

## GetVaccineLaters API

```typescript
callAsmx('GetVaccineLaters', {
  ForReport: 0, SortVaccine: 0, SortFollowup: 0, SortCity: 0,
  allBranches: 0, SortPatient: 0, PatientName: '',
  CheckConfirmed: 0, StartDate: '', StartID: 0,
  fromDate: 'MM/DD/YYYY', toDate: 'MM/DD/YYYY',
  addOrSubstract: 0,
});
```

Returns: UserName, CellPhone, PetName, VacName, Date, NextDate, PatientID, PetID, Confirmed, NextAppointment, etc.

## Important Notes

- **Date format**: ClinicaOnline uses MM/DD/YYYY (American)
- **All messages require Gil's approval** (configurable in dashboard)
- **No Anthropic API key needed** — uses templates only (AI enrichment via Claude Max session if needed)
- **Deduplication**: By PatientID (same owner with multiple pets = one combined message)

## Environment Variables

See root `.env`: CLINICA_*, GREEN_API_*, SUPABASE_*
