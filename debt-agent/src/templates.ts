// 5 escalation levels for debt reminder WhatsApp messages

export interface DebtTemplateVars {
  clientName: string;
  petName: string;
  amount: number;
  visitDate: string;
  clinicPhone: string;
  bankDetails: string;
}

function formatAmount(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
}

export const TEMPLATES: Record<number, (v: DebtTemplateVars) => string> = {
  // Level 1 — Gentle (day after debt)
  1: (v) => `שלום ${v.clientName} 🐾
מדברים ממרפאת פט קייר בת ים.
רצינו להזכיר שנותרה יתרת חוב פתוחה בסך ${formatAmount(v.amount)}.
ניתן להסדיר בביקור הבא או בהעברה בנקאית.
נשמח לעזור בכל שאלה!
מרפאת פט קייר ❤️`,

  // Level 2 — Warm (day after, alternative)
  2: (v) => `שלום ${v.clientName} 🐕
ממרפאת פט קייר בת ים.
שמחנו לטפל ב${v.petName} בביקור האחרון!
רצינו לעדכן שנותרה יתרה פתוחה בסך ${formatAmount(v.amount)}.
אפשר להסדיר בהעברה, בכרטיס אשראי, או בביקור הבא.
מחכים לראות אתכם 🐾`,

  // Level 3 — Business (after a week) — requires Gil approval
  3: (v) => `שלום ${v.clientName},
הודעה ממרפאת פט קייר בת ים.
לידיעתך — קיימת יתרה פתוחה ע"ס ${formatAmount(v.amount)}.
לתשלום או בירור: ${v.clinicPhone}
אפשר גם בהעברה לחשבון: ${v.bankDetails}
תודה, צוות פט קייר`,

  // Level 4 — Urgent (after two weeks) — requires Gil approval
  4: (v) => `שלום ${v.clientName},
פונים אליך שוב ממרפאת פט קייר.
טרם הוסדרה יתרת החוב בסך ${formatAmount(v.amount)} מתאריך ${v.visitDate}.
נודה להסדרה בהקדם — ניתן בהעברה, בכרטיס, או בביקור.
לבירור: ${v.clinicPhone}
תודה, מרפאת פט קייר`,

  // Level 5 — Direct (after a month) — requires Gil approval
  5: (v) => `שלום ${v.clientName},
הודעה אחרונה ממרפאת פט קייר בנוגע ליתרת חוב בסך ${formatAmount(v.amount)}.
פנינו מספר פעמים ולא קיבלנו מענה.
נבקש להסדיר את התשלום תוך 7 ימים.
לתיאום: ${v.clinicPhone}
בברכה, מרפאת פט קייר`,
};

export function renderTemplate(level: number, vars: DebtTemplateVars): string {
  const tmpl = TEMPLATES[level];
  if (!tmpl) throw new Error(`Unknown template level: ${level}`);
  return tmpl(vars);
}

// Max auto-send level (levels above this require Gil's approval)
export const MAX_AUTO_LEVEL = 2;
