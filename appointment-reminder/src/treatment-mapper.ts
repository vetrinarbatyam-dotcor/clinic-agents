const TREATMENT_TEMPLATES: Record<number, string> = {
  3338: 'vaccine',
  3665: 'surgery', 3666: 'surgery', 3664: 'surgery', 2582: 'surgery',
  2583: 'checkup', 3539: 'checkup',
  2584: 'dental',
};
const KEYWORDS: [string, string][] = [
  ['חיסון', 'vaccine'],
  ['תפרים', 'followup'], ['הסרה', 'followup'], ['מעקב', 'followup'],
  ['ניתוח', 'surgery'], ['סירוס', 'surgery'], ['עיקור', 'surgery'],
  ['שיניים', 'dental'],
  ['בדיקה', 'checkup'],
];

export function mapTreatment(event: any): string {
  const tid = event?.TreatmentID;
  if (tid && TREATMENT_TEMPLATES[tid]) return TREATMENT_TEMPLATES[tid];
  const hay = `${event?.eventNotes || ''} ${event?.TreatmentName || ''}`.toLowerCase();
  for (const [k, t] of KEYWORDS) if (hay.includes(k)) return t;
  return 'generic';
}

export function selectTemplateKey(type: string, mode: '6' | '3' | '1'): string {
  if (mode === '1') return 'generic';
  if (mode === '3') {
    if (type === 'vaccine') return 'vaccine';
    if (type === 'surgery' || type === 'dental') return 'surgery';
    return 'generic';
  }
  return type;
}
