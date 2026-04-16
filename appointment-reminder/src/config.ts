export const VACCINE_CALENDAR = 'e0bd1141-ac5d-4703-8e92-93cf5dad9b06';
export const GIL_KEREN = '043f17f9-3b15-4a9a-aeb9-6cefa54c3c02';
export const TEAM_PHONE = '035513649';

export interface ApptReminderConfig {
  enabled: boolean;
  mode: 'shadow' | 'dry_run' | 'live';
  reminder_24h_enabled: boolean;
  reminder_24h_send_time: string;
  send_window_start: string;
  send_window_end: string;
  skip_weekends: boolean;
  skip_holidays: boolean;
  target_calendars: string[];
  skip_confirmed_manually: boolean;
  skip_no_phone: boolean;
  max_reminders_per_phone_per_day: number;
  max_reminders_per_run: number;
  template_mode: '6' | '3' | '1';
  templates: Record<string, string>;
  reply_confirmed: string;
  reply_canceled: string;
  reply_snoozed: string;
  reply_unknown: string;
  alert_team_on_cancel: boolean;
  alert_team_on_unknown_reply: boolean;
  team_alert_phone: string;
  cancel_alert_threshold: number;
  test_mode: boolean;
  test_phone_whitelist: string[];
}

export const DEFAULT_CONFIG: ApptReminderConfig = {
  enabled: true,
  mode: 'shadow',
  reminder_24h_enabled: true,
  reminder_24h_send_time: '16:00',
  send_window_start: '08:00',
  send_window_end: '20:00',
  skip_weekends: true,
  skip_holidays: true,
  target_calendars: [VACCINE_CALENDAR],
  skip_confirmed_manually: true,
  skip_no_phone: true,
  max_reminders_per_phone_per_day: 5,
  max_reminders_per_run: 100,
  template_mode: '6',
  templates: {
    vaccine: 'היי {client_name}! 💉\nמזכירים תור ל-{pet_name} לחיסון\n📅 {day_name} {date} {time}\n📍 המרפאה הווטרינרית\n\n💡 הכנות:\n• אין צורך בצום\n• הבא/י את פנקס החיסונים\n\n1️⃣ מאשר/ת | 2️⃣ לדחות | 3️⃣ לבטל',
    surgery: 'שלום {client_name} 🏥\nמזכירים תור ל-{pet_name} ל{treatment_name}\n📅 {day_name} {date} {time}\n\n⚠️ חשוב מאוד:\n• צום מלא החל מ-20:00 הלילה\n• מים בלבד עד שעתיים לפני\n• להגיע עם רצועה/כלוב\n• להביא תוצאות בדיקת דם אם יש\n\n1️⃣ מאשר | לשאלות: 035513649',
    checkup: 'היי! 🩺\nתור בדיקה ל-{pet_name}\n📅 {day_name} {date} {time}\n\n• הגיעו 10 דקות לפני\n• הביאו תיעוד רפואי קודם אם יש\n\n1️⃣ מאשר | 2️⃣ לדחות | 3️⃣ לבטל',
    dental: 'שלום! 🦷\nתור לטיפול וניקוי שיניים ל-{pet_name}\n📅 {day_name} {date} {time}\n\n⚠️ צום מלא מ-20:00 הלילה הקודם\n• טיפול בהרדמה מלאה\n• זמן שחרור משוער: 15:00\n\n1️⃣ מאשר | 2️⃣ לשאלות',
    followup: 'שלום! ✂️\nתור מעקב ל-{pet_name}\n📅 {day_name} {date} {time}\n⏱ תור קצר (10 דק)\n\n1️⃣ מאשר/ת | 2️⃣ לדחות',
    generic: 'שלום! 📅\nתזכורת לתור ב-{date} {time}\nעבור: {pet_name}\n1️⃣ מאשר | 2️⃣ לדחות | 3️⃣ לבטל',
  },
  reply_confirmed: 'מעולה! נתראה 👋',
  reply_canceled: 'התור בוטל ✓',
  reply_snoozed: 'הבנתי, אזכיר בעוד שבועיים 🙏',
  reply_unknown: 'לא הבנתי 🤔 אפשר לבחור: 1=מאשר, 2=לדחות, 3=לבטל',
  alert_team_on_cancel: true,
  alert_team_on_unknown_reply: true,
  team_alert_phone: TEAM_PHONE,
  cancel_alert_threshold: 30,
  test_mode: false,
  test_phone_whitelist: ['0543123419', '0549127030'],
};
