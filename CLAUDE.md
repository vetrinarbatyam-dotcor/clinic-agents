# CLAUDE.md — clinic-agents monorepo

תובנות אדריכלות חשובות לעבודה עם הסוכנים. קרא את זה לפני שינויים בקוד.

## הסוכנים והתפקיד של כל אחד

| סוכן | נתיב | מה הוא עושה | פעיל? |
|---|---|---|---|
| **vaccine-reminders** | `vaccine-reminders/` | תזכורות חיסונים 4-שלבי (מקדים + 3 מאחרים) | cron יומי 09:00 |
| **remind-agent** | `remind-agent/` | **on-demand בלבד** — סריקת מאחרים עמוקה לפי דרישה | לא מתוזמן |
| **appointment-reminder** | `appointment-reminder/` | תזכורת 24h לתורים קבועים ביומן (GetAllClinicData) | cron כל 30 דקות 8-19 |
| **appointment_booker** | `appointment_booker/` | טיפול בתגובות לקוחות לתזכורות + קביעת תור | webhook בפורט נפרד |
| **marpet-audit** | `marpet-audit/` | ביקורת תביעות ביטוח | ידני |
| **debt-agent** | `debt-agent/` | דוחות חובות | ידני |

## החלטות אדריכליות חשובות (אל תשבור!)

### 1. vaccine-reminders vs remind-agent — הפרדה ברורה
- **vaccine-reminders** = הסוכן השגרתי. סורק דרך `GetVaccineReminders` + `GetVaccineLaters` (טווח -35 עד +10 ימים) עם 4 שלבים (-5, +3, +14, +30).
- **remind-agent** = רק לפי דרישה (dashboard / CLI ידני). יש לו `--deep-scan` ל-3 שנים אחורה למציאת לקוחות שנטשו.
- **אל תפעיל cron ל-remind-agent** — יש double-toggle gate: דגל `--cron` דורש `cron_enabled=true` AND `cron_confirmed=true` ב-`agent_configs`. הגנה כפולה מהפעלה בטעות.
- היסטורית הבעיה: שני הסוכנים יכלו לשלוח כפולות לאותו לקוח כי הם עובדים על טבלאות שונות (Supabase `pending_messages` vs Postgres `vaccine_reminders`).

### 2. Stages של vaccine-reminders מוגדרים ב-DB, לא בקוד
- `DEFAULT_STAGES` ב-`reminder-scheduler.ts` הם fallback בלבד.
- הערכים הפעילים ב-`agent_configs.config.stages` → עריכה רק דרך SQL או dashboard.
- שינוי timings: UPDATE של ה-JSON ב-DB, לא Edit של הקוד.

### 3. הודעות משתמשות ב-`{cta}` ו-`{optOut}` דינמיים
- `{cta}` מתחלף לפי `appointment_booker.mode`:
  - `live` → `'📅 לקביעת תור — השיבו "1" או התקשרו ל-035513649'` (הבוט יטפל ב-"1")
  - `dry_run`/`shadow`/`disabled` → `'📅 לקביעת תור — שלחו הודעה או התקשרו ל-035513649'`
- `{optOut}` תמיד `'להסרה מרשימת תפוצה — השיבו "הסירו אותי"'`
- **אל תשנה appointment_booker ל-live** לפני שוודאת שה-webhook שלו עובד תקין וה-queue שלו נקי. החלפת mode משנה את מה שהלקוח רואה בהודעת vaccine-reminders הבאה.
- המפתח המרכזי: `isBookerLive()` ב-`vaccine-reminders/src/message-builder.ts` — קאש של 60 שניות.

### 4. Skip rules ב-vaccine-reminders
- **יום שליחה**: שישי/שבת/יו"ט → `return` מיידי. ה-cron ימשיך לנסות כל יום, קורא מ-`shared/holidays.ts`.
- **תור קיים**: `hasUpcomingAppointment(petId, 10)` — בודק 10 ימים קדימה דרך `LoadPetSessions` (API חוצה יומנים). אם יש תור — רשומה ב-DB עם `status='skipped_has_appointment'`, לא ההודעה נשלחת.
- **ביקור אחרי תאריך**: רק ל-stage 2+. סטטוס `skipped_visited` אם הלקוח כבר היה במרפאה אחרי ה-due_date.
- **due_date בשבת/יו"ט**: התאריך מוצג בהודעה כ-+1 יום (נדחה ליום עסקים). לוגיקה ב-`message-builder.ts::shiftRestDayForDisplay`.

### 5. הפניה ל-appointment_booker
- אחרי שליחה ב-autoApprove, `insertToOutboundQueue` דוחף ל-`appt_booker_outbound_queue`.
- סוכן `appointment_booker` מאזין ל-queue ומטפל בתגובות (צ'אט קביעת תור).
- הקישור עובר דרך `pet_id + phone` — אל תשנה את המפתחות האלה.

### 6. Opt-out אוטומטי דרך `shared/opt-out.ts`
- מילות מפתח: "תפסיקו", "הסירו אותי", "לא מעוניין/ת", "הפסיקו לשלוח", "אל תפנו אלי", "מבקש/ת להסיר".
- מתבצע ב-webhook של appointment-reminder/appointment_booker — לא ב-vaccine-reminders עצמו.

### 7. DB Schema — כבד
- `vaccines` (397 חיות, 6605+ רשומות) — היסטוריית חיסונים, כולל `next_due_date` מחושב מראש. **אל תחשב מרווחים בקוד** — השתמש ב-`next_due_date` מה-DB.
- `vaccine_reminders` — טבלת אודיט של התזכורות שנשלחו. `unique (pet_id, vaccine_name, stage)` מונע כפילויות.
- `appt_booker_outbound_queue` — queue של תגובות שמחכות לטיפול appointment_booker.
- `agent_configs` — JSONB config לכל סוכן.

### 8. appointment_booker — סימלינק ומשמעת קומיט
- **מיקום אמיתי**: `clinic-agents/appointment_booker/`. ה-FastAPI (`clinicpal-api.service`) מייבא דרך סימלינק: `clinic-pal-hub/backend/agents/appointment_booker` → כאן.
- **שני הנתיבים מצביעים לאותם קבצים** — `diff -rq` ביניהם תמיד ריק. זו לא הוכחה לשני עותקים זהים, זו הוכחה שזה סימלינק.
- ⚠️ **לעולם לא** `rm -rf` צד אחד ולעשות `ln -s` לצד השני — זה יוצר לולאת סימלינקים ומוחק את הקוד האמיתי. תקרית 2026-04-14 איבדה ~1.6KB של עריכות לא-מקומטות כך.
- **חוק**: כל שינוי ב-`appointment_booker/*.py` חייב להיות מקומט לגיט **באותו יום** (עדיף מיד אחרי הטסט). אין "שינויים זמניים" על דיסק — אם זה שווה להריץ, זה שווה קומיט.
- **סימן אזהרה**: `git status` שמראה `M` על `__pycache__/*.pyc` (הם tracked בריפו) = יש עריכות לא-מקומטות ב-`.py` המקביל. לטפל מיד.

## Cron status (נכון ל-2026-04-14)
```
# vaccine-reminders — יומי 09:00, DRY-RUN (להסיר --dry-run כשמוכנים ל-live):
0 9 * * * cd /home/claude-user/clinic-agents && set -a && source .env && set +a && /root/.bun/bin/bun run vaccine-reminders/src/index.ts --dry-run >> /var/log/vaccine-reminders.log 2>&1

# appointment-reminder — כל 30 דקות בשעות העבודה (ראשון-חמישי + שבת):
*/30 8-19 * * 0-4,6 cd /home/claude-user/clinic-agents && set -a && source .env && set +a && /root/.bun/bin/bun run appointment-reminder/src/cron.ts >> /var/log/appt-reminder.log 2>&1

# vaccine-reminders snooze-release — יומי 08:00:
0 8 * * * cd /home/claude-user/clinic-agents/vaccine-reminders && /home/claude-user/.bun/bin/bun run src/snooze-release.ts >> /tmp/snooze-release.log 2>&1
```

## גוטצ'ות ידועים

- **catch-up logic** ב-`determineReminderStage`: אם פספסנו חלון stage, נשלח בכל זאת לפני stage הבא. לכן ב-dry-run רואים stage 1 גם עם `0d overdue` (פספסו -5 לפני, ונשלח לפני ש-stage 2 ב-+3 יתחיל).
- **maxPerDay=30** — הגבלה יומית שמונעת ספאם ונועלת WA. לשנות ב-`agent_configs.config.maxPerDay` אם צריך.
- **autoApprove=true** — הודעות נשלחות אוטומטית בלי אישור גיל. לשנות ל-false כדי לחייב אישור דרך דשבורד.

