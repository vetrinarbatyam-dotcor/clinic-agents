// Claude Max headless via `claude -p`. Used when reply is unparseable.
import { spawn } from 'child_process';

export async function classifyReply(replyText: string, context: { pet_name?: string; appointment_at?: string }): Promise<{
  intent: 'confirm' | 'cancel' | 'snooze' | 'unknown';
  human_response: string;
}> {
  const prompt = `אתה מסייע במרפאה וטרינרית. לקוח קיבל תזכורת לתור של ${context.pet_name || 'החיה'} ב-${context.appointment_at || ''} והשיב:
"${replyText}"

החזר JSON בלבד בפורמט:
{"intent": "confirm" | "cancel" | "snooze" | "unknown", "human_response": "תשובה קצרה ולבבית בעברית"}

intent confirm = הלקוח מאשר הגעה
intent cancel = הלקוח מבטל
intent snooze = הלקוח רוצה לדחות
intent unknown = לא ברור — בקש בנימוס לבחור 1/2/3`;

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      try {
        const m = out.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          resolve(parsed);
          return;
        }
      } catch (e) { console.error("[claude-fallback] JSON parse failed:", e instanceof Error ? e.message : e); }
      resolve({ intent: 'unknown', human_response: 'לא הבנתי 🤔 אפשר לבחור: 1=מאשר, 2=לדחות, 3=לבטל' });
    });
    proc.on('error', () => resolve({ intent: 'unknown', human_response: 'לא הבנתי 🤔 אפשר לבחור: 1=מאשר, 2=לדחות, 3=לבטל' }));
    setTimeout(() => { proc.kill(); resolve({ intent: 'unknown', human_response: 'לא הבנתי 🤔 אפשר לבחור: 1=מאשר, 2=לדחות, 3=לבטל' }); }, 30000);
  });
}
