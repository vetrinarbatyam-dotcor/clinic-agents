import type { ClassifiedVisit, VisitCategory } from '../../shared/types';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function loadTemplate(category: VisitCategory): string {
  try {
    return readFileSync(join(TEMPLATES_DIR, `${category}.txt`), 'utf-8');
  } catch {
    return 'שלום {ownerName}! 🐾\nרצינו לבדוק איך {petName} מרגיש/ה היום.\nאם יש שאלות — אנחנו כאן!';
  }
}

function fillTemplate(template: string, visit: ClassifiedVisit): string {
  return template
    .replace(/{ownerName}/g, visit.ownerName)
    .replace(/{petName}/g, visit.petName);
}

async function enrichWithAI(visit: ClassifiedVisit, baseMessage: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return baseMessage.replace(/{aiPersonalNote}/g, '');
  }

  const prompt = `אתה עוזר למרפאה וטרינרית לכתוב הודעת מעקב חמה ואישית ללקוח.

סוג הביקור: ${visit.category === 'surgery' ? 'ניתוח' : visit.category === 'new-client' ? 'לקוח חדש' : 'מקרה רפואי'}
שם בעלים: ${visit.ownerName}
שם חיה: ${visit.petName}
פרטי הטיפול: ${visit.details}

כתוב משפט אחד או שניים אישיים וחמים שמתייחסים לטיפול הספציפי.
- אל תחזור על שם הבעלים או החיה (כבר מופיעים בהודעה)
- אל תוסיף ברכות פתיחה/סיום
- תהיה חם, מקצועי ואנושי
- בעברית בלבד
- מקסימום 2 משפטים`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    const aiNote = data.content?.[0]?.text?.trim() || '';
    return baseMessage.replace(/{aiPersonalNote}/g, aiNote);
  } catch (e: any) {
    console.error('[ai] enrichment failed:', e.message);
    return baseMessage.replace(/{aiPersonalNote}/g, '');
  }
}

export async function buildMessage(visit: ClassifiedVisit, useAI = true): Promise<string> {
  const template = loadTemplate(visit.category);
  const filled = fillTemplate(template, visit);

  if (useAI && ANTHROPIC_API_KEY) {
    return enrichWithAI(visit, filled);
  }

  return filled.replace(/{aiPersonalNote}/g, '');
}
