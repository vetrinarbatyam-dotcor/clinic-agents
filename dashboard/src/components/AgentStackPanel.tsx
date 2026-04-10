import { useState } from 'react';

export interface AgentStack {
  name: string;
  displayName: string;
  emoji: string;
  description: string;
  entry: string;
  subAgents: string[];
  tools: string[];
  resources: string[];
  skills: string[];
}

export const AGENT_STACKS: Record<string, AgentStack> = {
  'remind-agent': {
    name: 'remind-agent',
    displayName: 'סוכן תזכורות חיסונים',
    emoji: '💉',
    description: 'סורק חיסונים שפג תוקפם ושולח תזכורות WhatsApp לבעלי החיות',
    entry: 'remind-agent/src/index.ts',
    subAgents: [
      'vaccine-scanner.ts — שליפה רגילה (שנה אחורה)',
      'vaccine-deep-scan.ts — סריקה עמוקה (3+ שנים)',
      'message-builder.ts — בניית הודעות מתבניות',
    ],
    tools: [
      'shared/clinica.ts — לקוח ASMX של ClinicaOnline',
      'shared/whatsapp.ts — שליחה דרך Green API',
      'shared/supabase.ts — agents + pending_messages',
      'bun runtime',
    ],
    resources: [
      'ClinicaOnline API: GetVaccineLaters',
      'Supabase: agents, agent_templates, pending_messages',
      'Green API WhatsApp instance',
      'agent_templates (5 קטגוריות)',
    ],
    skills: ['clinica-online-api', 'whatsapp (Green API)'],
  },
  'followup-agents': {
    name: 'followup-agents',
    displayName: 'סוכן פולואפ ביקורים',
    emoji: '📞',
    description: 'שולח הודעות מעקב יום אחרי ביקור רפואי/ניתוח/לקוח חדש',
    entry: 'followup-agents/src/index.ts',
    subAgents: [
      'classifier.ts — סיווג ביקור (medical/surgery/new-client/skip)',
      'message-builder.ts — תבנית + העשרה ב-AI',
    ],
    tools: [
      'shared/clinica.ts — LoadPetSessions',
      'shared/whatsapp.ts — Green API',
      'shared/supabase.ts',
      'Claude (AI enrichment)',
    ],
    resources: [
      'PostgreSQL clinicpal — pets',
      'ClinicaOnline: LoadPetSessions, GetInvoiceItems',
      'Supabase: agent_templates, pending_messages',
      'WhatsApp Green API',
    ],
    skills: ['clinica-online-api', 'whatsapp', 'claude-api (AI message)'],
  },
  'debt-agent': {
    name: 'debt-agent',
    displayName: 'סוכן גבייה',
    emoji: '💰',
    description: 'מעקב חובות שבועי, escalation אוטומטי ושליחת תזכורות',
    entry: 'debt-agent/src/index.ts',
    subAgents: [
      'escalation.ts — לוגיקת רמות (1–4)',
      'templates.ts — תבניות לפי רמה',
    ],
    tools: [
      'shared/clinica.ts — GetClinicDebts',
      'shared/whatsapp.ts — Green API',
      'pg (PostgreSQL client)',
      'ExcelJS — דוח אקסל',
    ],
    resources: [
      'ClinicaOnline: GetClinicDebts',
      'PostgreSQL: debts, debt_history, debt_config',
      'WhatsApp Green API',
    ],
    skills: ['clinica-online-api', 'whatsapp', 'debt-tracker'],
  },
  'vaccine-reminders': {
    name: 'vaccine-reminders',
    displayName: 'תזכורות חיסונים מדורגות',
    emoji: '🗓️',
    description: 'תזכורות חיסונים בשלבים (Stage 1–4) עם תזמון חכם',
    entry: 'vaccine-reminders/src/index.ts',
    subAgents: [
      'vaccine-fetcher.ts — שליפה + סינון לקוחות שביקרו',
      'reminder-scheduler.ts — חישוב שלב נוכחי',
      'message-builder.ts — בניית הודעה לפי שלב',
    ],
    tools: [
      'shared/clinica.ts',
      'shared/whatsapp.ts',
      'pg (PostgreSQL)',
    ],
    resources: [
      'ClinicaOnline: GetVaccineLaters, LoadPetSessions',
      'PostgreSQL: vaccine_reminders',
      'לוח חגים ושבתות',
      'Green API',
    ],
    skills: ['clinica-online-api', 'whatsapp'],
  },
  'petconnect': {
    name: 'petconnect',
    displayName: 'PetConnect — סגמנטציה ושליחה',
    emoji: '🐾',
    description: 'פילוח לקוחות לפי קריטריונים ושליחת קמפיינים מותאמים',
    entry: 'petconnect/src/index.ts',
    subAgents: [
      'filter-engine.ts — מנוע סינון (גזע/גיל/ביטוח/ביקור אחרון)',
      'message-sender.ts — שליחה בכמויות',
      'sync-clients.ts — סנכרון נתוני לקוחות',
      'api.ts — Express API לדשבורד',
    ],
    tools: [
      'shared/whatsapp.ts',
      'pg (PostgreSQL)',
      'Express',
    ],
    resources: [
      'PostgreSQL: clients, pets',
      'ClinicaOnline (סנכרון)',
      'Green API',
      '5 תבניות מובנות',
    ],
    skills: ['clinica-online-api', 'whatsapp', 'content-creator'],
  },
};

export default function AgentStackPanel({ agentName }: { agentName: string }) {
  const [open, setOpen] = useState(false);
  const stack = AGENT_STACKS[agentName];
  if (!stack) return null;

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg">
          {stack.emoji} {stack.displayName}
          <span className="text-sm text-gray-400 font-normal mr-2" dir="ltr">({stack.name})</span>
        </h2>
        <button onClick={() => setOpen(!open)} className="text-sm text-emerald-600 hover:text-emerald-700">
          {open ? 'הסתר' : 'הצג סטאק'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-3">{stack.description}</p>
      <div className="text-xs text-gray-400 mb-3" dir="ltr">📂 {stack.entry}</div>

      {open && (
        <div className="grid gap-3 md:grid-cols-2">
          <Section title="🧩 סוכני משנה" items={stack.subAgents} color="indigo" />
          <Section title="🛠️ כלים" items={stack.tools} color="emerald" />
          <Section title="📊 משאבים ונתונים" items={stack.resources} color="amber" />
          <Section title="✨ סקילים" items={stack.skills} color="purple" />
        </div>
      )}
    </div>
  );
}

function Section({ title, items, color }: { title: string; items: string[]; color: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
  };
  return (
    <div className={`rounded-lg p-3 border ${colors[color]}`}>
      <div className="font-medium mb-2">{title}</div>
      <ul className="text-xs space-y-1 list-disc list-inside">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
