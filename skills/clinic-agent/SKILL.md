---
name: סוכן המרפאה
description: בניית סוכנים אוטומטיים למרפאה הווטרינרית — פולואפ, תזכורות, גבייה ועוד. תהליך מלא מתכנון עד דשבורד.
triggers:
  - "סוכן המרפאה"
  - "בנה סוכן למרפאה"
  - "סוכן חדש למרפאה"
  - "clinic agent"
  - "new clinic agent"
  - "צור סוכן"
---

# Clinic Agent Builder

Build automated agents for the veterinary clinic (המרכז לרפואה וטרינרית ד"ר גיל קרן).

## Phase 1: Planning (חובה!)

Before writing any code, run a thorough planning phase.

### Question Flow — One at a Time with Progress Bar

**CRITICAL:** Ask questions ONE AT A TIME, not all at once. Show a visual progress bar at the top of each question so the user knows where they are in the process.

Format for each question:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 תכנון סוכן | שאלה 3 מתוך 8
██████████░░░░░░░░░░░░░░░░░░░░ 37%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**השאלה:**
מה תוכן ההודעה? תבנית קבועה / טקסט חופשי / שילוב?

💡 *דוגמה: "היי {שם}, מזכירים שהגיע הזמן לחיסון שנתי ל-{שם_חיה}"*
```

Rules:
- Wait for the user's answer before moving to the next question
- Adapt follow-up questions based on previous answers
- Skip irrelevant questions (e.g., don't ask about insurance filters if it's a staff-only agent)
- After the last question, show a complete summary table of all answers for confirmation
- The progress bar fills proportionally: █ for completed, ░ for remaining

### Planning Questions Pool

Pick relevant questions from these categories. Not all questions apply to every agent — skip what's not relevant.

#### 1.1 Define the Agent
- מה המטרה של הסוכן? (פולואפ, תזכורות, גבייה, שיווק...)
- למי שולחים? (לקוחות, צוות, ספקים...)
- מתי רץ? (יומי, שבועי, אחרי אירוע...)
- מה קורה בשבת/חג?

#### 1.2 Data Source Questions
- מאיפה שולפים את הנתונים? (ClinicaOnline, DB מקומי, Supabase)
- מה הקריטריונים לסינון? (סוג ביקור, סכום חוב, תאריך...)
- מה השדות שצריך? (שם, טלפון, חיה, ממצאים...)

#### 1.3 Message Questions
- מה תוכן ההודעה? (תבניות, AI, שילוב)
- כמה סוגי הודעות? (אחת לכולם, מותאמת לפי קטגוריה)
- באיזה ערוץ? (WhatsApp, SMS, email)
- בשפה? (עברית, אנגלית, רוסית)

#### 1.4 Approval Flow
- שליחה אוטומטית או דורש אישור?
- מי מאשר? (גיל, מנהל משמרת...)
- האם צריך סקירה ידנית בהתחלה?

#### 1.5 Dashboard Requirements
- אילו הגדרות ניתנות לשינוי בדשבורד?
- מה מציגים בדף הבית?
- האם צריך דוחות/סטטיסטיקות?

## Phase 2: Implementation

### 2.1 Project Structure
כל סוכן חי ב-`/home/claude-user/clinic-agents/`:
```
clinic-agents/
├── shared/           # קוד משותף — לא לשנות!
│   ├── clinica.ts    # ClinicaOnline API
│   ├── whatsapp.ts   # Green API
│   ├── supabase.ts   # Supabase client
│   └── types.ts
├── dashboard/        # React dashboard
├── [agent-name]/     # הסוכן החדש
│   ├── src/
│   │   ├── index.ts
│   │   ├── classifier.ts
│   │   └── message-builder.ts
│   └── templates/
└── .env
```

### 2.2 Supabase Tables
Each agent needs rows in:
- `agents` — registration (name, display_name, cron_schedule, config)
- `agent_templates` — message templates per category
- `pending_messages` — message queue for approval/sending

### 2.3 Dashboard Pages
Add the agent to:
- `Home.tsx` — agent card auto-appears from Supabase
- `AgentConfig.tsx` — settings specific to this agent type
- `ApprovalQueue.tsx` — shared approval queue, filtered by agent_id

## Phase 3: Testing & Calibration

- Always start with `--dry-run` to verify classification
- Review the full output with the user before enabling
- Initial mode: ALL messages require approval (שליטה מלאה)
- Gradually move to auto-send per category after calibration

## ClinicaOnline API Reference

### Critical: Date Format
**ClinicaOnline uses MM/DD/YYYY (American format), NOT DD/MM/YYYY!**
```typescript
// CORRECT:
formatDateMMDDYYYY(date) → "04/03/2026" = April 3
// WRONG:
"03/04/2026" → this is March 4!
```

### Authentication
- Login via web scraping: `POST /Login.aspx` → `POST /SelectClinic.aspx`
- Session TTL: 30 minutes, auto-refresh
- Credentials in `.env`: CLINICA_USERNAME=rupi, CLINICA_PASSWORD=sahar2306, CLINIC_ID=53
- ASMX endpoint: `https://www.clinicaonline.co.il/Restricted/dbCalander.asmx/{method}`

### Key API Methods

| Method | Params | Returns | Use |
|--------|--------|---------|-----|
| `GetAllClinicData` | ShowNotActive:0, sSelected:"MM/DD/YYYY", UserID, pannel:0 | listEvents[], listNames[] | **Diary events for a day** — appointments + visits |
| `LoadPetSessions` | Anam:"", All:1, fromDate, toDate, PetID, withWatch:0 | Session, Vaccine, Pres, Labs | **Actual visit record** — Finds, Notes, Items[] |
| `GetLastPatients` | move:0, fromDate:"" | RegPersonal[] | Last 20 recent clients (limited!) |
| `SearchByNameClinic` | UserName, UserID:"", LastName:"" | RegPersonal[] | Search client by name |
| `SearchByPhone` | PhoneNumber, UserID:"", LastName:"" | RegPersonal[] | Search client by phone |
| `GetPatientPets` | userid | Pet[] | Client's pets |
| `LoadPetDetails` | PetID | Pet details | Birth date, breed, weight |
| `LoadPetVaccines` | fromDate, toDate, PetID | Vaccine[] | Vaccination history |
| `LoadTherapists` | (none) | Therapist[] | All staff (13 people) |
| `GetInsurancesList` | (none) | Insurance[] | Insurance companies |
| `GetClientDebts` | PatientID | ClientDebt | Client balance/debt |
| `EditPetSession` | rp (session object) | — | Update visit record |

### GetAllClinicData — Diary Events
Returns ALL events for a day. Key fields per event:
- `EventID` — unique event ID
- `Description` — client name
- `eventNotes` — appointment note (e.g., "אוזניים - שם החיה: לנון")
- `Status` — 0=Open/Scheduled, 7=Completed
- `PatientID` — client UUID (empty = placeholder slot)
- `PetID` — pet ID
- `BeginDate` — "4/3/2026 10:00:00 AM" (M/D/YYYY format!)
- `TreatmentID` — treatment type
- `NewPatient` — 0/1

**Important:** API returns same events regardless of UserID parameter.

### LoadPetSessions — Visit Record
Returns the actual medical record. Key fields:
- `Session.Finds` — medical findings (ממצאים)
- `Session.Notes` — treatment instructions (הוראות)
- `Session.Anamneza` — reason for visit (סיבה)
- `Session.Items[]` — invoice items (פריטי חשבונית)
  - `FieldName` — item name (e.g., "בדיקה רפואית", "זריקת סרניה")
  - `Price` — price
  - `Amount` — quantity
- `Session.TherapistName` — treating vet
- `Session.Date` — visit date
- `Vaccine.Name` — vaccine name if vaccination
- `Session.PatientID` — client UUID (for phone lookup)

### Scanning All Pets (for walk-in coverage)
GetAllClinicData only shows scheduled appointments.
Walk-in clients need scanning via LoadPetSessions:
```typescript
// Get all pets from local DB
const pets = await pool.query('SELECT pet_id, user_id, name... FROM pets JOIN clients...');
// Check each pet for sessions on target date
for (const pet of pets) {
  const sessions = await callAsmx('LoadPetSessions', {
    Anam: '', All: 1,
    fromDate: 'MM/DD/YYYY', toDate: 'MM/DD/YYYY',
    PetID: pet.pet_id, withWatch: 0,
  });
}
```
~500 pets, ~2 minutes scan time.

### Therapists (relevant for medical visits)
- ד"ר גיל קרן — `043f17f9-3b15-4a9a-aeb9-6cefa54c3c02`
- רופינה מצוינים — `19ec8f86-7f27-4cba-a040-0b58e1fd162b`
- ד"ר פז מנו — `a40f20a1-1d82-4970-b9ef-147ae6372bf9`
- אלעד רביב-אגמון — `a18aab43-af12-4898-9855-77f50c73fb4d`
- מעיין מזרחי — `a33659f4-4c02-41e3-ac23-9b9c1f94cf16`
- אלינה קפלנוב — `a7fce3eb-1397-473a-a067-0afc996abee1`

### Local PostgreSQL
- Host: localhost, DB: clinicpal, User: clinicpal_user, Pass: clinicpal2306
- Tables: `clients` (221 synced), `pets` (403 synced) — includes phone numbers
- Synced from ClinicaOnline via clinic-pal-hub backend

## Infrastructure

### Server
- Contabo VPS: 167.86.69.208
- User: claude-user
- Runtime: Bun
- SSH: `ssh -i ~/.ssh/contabo_key root@167.86.69.208`

### Services
- **WhatsApp**: Green API — instance 7107557145
- **Supabase**: project wbzzoxsynasqkcqcflbw
- **Dashboard**: http://167.86.69.208:3000 (Vite + React + Tailwind)
- **ClinicaOnline**: https://www.clinicaonline.co.il (ASP.NET, ASMX web services)

### Learned Lessons
1. **Date format MM/DD/YYYY** — biggest gotcha, caused hours of debugging
2. **GetAllClinicData misses walk-ins** — must scan all pets for complete coverage
3. **Phone numbers not in diary API** — fetch from local DB clients table
4. **All therapists return same data** — no need to iterate
5. **Status=0 can be real visits** — not just empty slots
6. **Items[] in Session = real visit** — strongest indicator
7. **Start with full approval mode** — calibrate before auto-sending
8. **Hebrew RTL in templates** — use Unicode escapes in SQL seeds
9. **Supabase CAPTCHA blocks Puppeteer** — use user's browser or CLI
10. **Vaccine-only visits skip follow-up** — unless first vaccine/new client

## User Preferences (from this build)
- Planning phase with many questions before coding
- Dashboard with tuning/calibration capabilities
- Initially full control (all messages need approval)
- Gradual release to automatic after verifying accuracy
- Hebrew RTL throughout
- Real data validation (dry-run with actual clinic data)
- Gil gets WhatsApp summary of pending messages
