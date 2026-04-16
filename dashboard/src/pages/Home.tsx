import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAgentHealth, healthKeyFor, statusButtonClass } from '../hooks/useAgentHealth';

const DESCRIPTIONS: Record<string, string> = {
  'appointment-booker': 'קביעה אוטומטית של תורים בוואטסאפ — חיסונים/בדיקות/ניתוחים',
  'appointment-reminder': 'תזכורות אוטומטיות 24 שעות לפני התור — מחליף את ה-SMS של ClinicaOnline',
  'vaccine-reminders': 'שליחת תזכורות חיסון יזומות לבעלי חיים שהגיע מועד החיסון',
  'remind-agent': 'איתור בעלי חיים שאיחרו לחיסון ושליחת תזכורת חוזרת',
  'followup-agents': 'מעקב אחרי טיפולים — בדיקת שלום ושאלון אחרי ביקור',
  'debt-agent': 'איתור לקוחות עם חוב פתוח ושליחת הודעות גבייה אדיבות',
  'petconnect': 'שליחת הודעות וואטסאפ ללקוחות שהזדהו דרך פטקונקט',
  'marpet-reminder': 'תזכורות חיסון ללקוחות מבוטחי מרפט',
  'data-warehouse': 'משיכה ואיחוד נתונים מ-ClinicaOnline למאגר מרכזי',
};

const AGENT_ICONS: Record<string, string> = {
  'vaccine-reminders': '💉',
  'remind-agent': '🔔',
  'marpet-reminder': '🛡️',
  'appointment-reminder': '⏰',
  'appointment-booker': '📅',
  'followup-agents': '📋',
  'debt-agent': '💰',
  'petconnect': '📱',
  'data-warehouse': '🗄️',
  'whatsapp_db': '💬',
};

interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  borderColor: string;
  agents: string[];
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'vaccines',
    label: 'חיסונים ותזכורות',
    icon: '💉',
    color: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    agents: ['vaccine-reminders', 'remind-agent', 'marpet-reminder', 'appointment-reminder'],
  },
  {
    key: 'appointments',
    label: 'תורים וטיפולים',
    icon: '📅',
    color: 'bg-blue-50',
    borderColor: 'border-blue-200',
    agents: ['appointment-booker', 'followup-agents'],
  },
  {
    key: 'finance',
    label: 'כספים ולקוחות',
    icon: '💰',
    color: 'bg-amber-50',
    borderColor: 'border-amber-200',
    agents: ['debt-agent', 'petconnect'],
  },
  {
    key: 'infra',
    label: 'נתונים ותשתית',
    icon: '🗄️',
    color: 'bg-gray-50',
    borderColor: 'border-gray-200',
    agents: ['data-warehouse', 'whatsapp_db'],
  },
];

interface Agent {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  cron_schedule: string;
  config: any;
}

interface Stats {
  pending: number;
  sent: number;
  rejected: number;
}

interface LastRunInfo {
  last_run_at: string | null;
  status: string;
  error: string | null;
}

type ViewMode = 'grid' | 'list';

function relativeTime(iso: string | null): string {
  if (!iso) return 'טרם רץ';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function lastRunColor(info: LastRunInfo | undefined): string {
  if (!info || !info.last_run_at) return 'text-gray-400';
  if (info.status === 'error') return 'text-red-500';
  const hours = (Date.now() - new Date(info.last_run_at).getTime()) / 3600000;
  if (hours < 2) return 'text-emerald-500';
  if (hours < 24) return 'text-amber-500';
  return 'text-red-500';
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [lastRuns, setLastRuns] = useState<Record<string, LastRunInfo>>({});
  const [confirmRate, setConfirmRate] = useState<number | null>(null);
  const [conversionRate, setConversionRate] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const { data: health, ack: ackHealth } = useAgentHealth();

  useEffect(() => {
    loadAgents();
    loadLastRuns();
    loadRates();
  }, []);

  async function loadLastRuns() {
    try {
      const res = await apiFetch(`http://${window.location.hostname}:8000/api/agents/last-runs`);
      if (res.ok) setLastRuns(await res.json());
    } catch {}
  }

  async function loadRates() {
    try {
      const res = await apiFetch(`http://${window.location.hostname}:8000/api/agents/confirmation-rate`);
      if (res.ok) { const d = await res.json(); setConfirmRate(d.rate); }
    } catch {}
    try {
      const res = await apiFetch(`http://${window.location.hostname}:8000/api/agents/appointment_booker/outbound_queue/stats`);
      if (res.ok) { const d = await res.json(); setConversionRate(d.conversion_rate); }
    } catch {}
  }

  async function loadAgents() {
    const { data } = await supabase.from('agents').select('*');
    if (data) {
      setAgents(data);
      for (const agent of data) {
        if (agent.name === 'appointment-reminder') {
          try {
            const res = await apiFetch(`http://${window.location.hostname}:3457/stats`);
            if (res.ok) {
              const j = await res.json();
              setStats(prev => ({ ...prev, [agent.id]: {
                pending: parseInt(j.pending) || 0,
                sent: parseInt(j.sent) || 0,
                rejected: parseInt(j.rejected) || 0,
              }}));
            }
          } catch { setStats(prev => ({ ...prev, [agent.id]: { pending: 0, sent: 0, rejected: 0 } })); }
          continue;
        }
        if (agent.name === 'appointment-booker') {
          try {
            const res = await apiFetch(`http://${window.location.hostname}:8000/api/agents/appointment_booker/outbound_queue/stats`);
            if (res.ok) {
              const d = await res.json();
              setStats(prev => ({ ...prev, [agent.id]: { pending: 0, sent: d.total || 0, rejected: 0 } }));
            }
          } catch { setStats(prev => ({ ...prev, [agent.id]: { pending: 0, sent: 0, rejected: 0 } })); }
          continue;
        }
        if (agent.name === 'whatsapp_db') {
          try {
            const res = await apiFetch(`http://${window.location.hostname}:8000/api/agents/whatsapp_db/stats`);
            if (res.ok) {
              const s = await res.json();
              setStats(prev => ({ ...prev, [agent.id]: {
                pending: parseInt(s.pending) || 0,
                sent: parseInt(s.sent) || 0,
                rejected: parseInt(s.rejected) || 0,
              }}));
            }
          } catch { setStats(prev => ({ ...prev, [agent.id]: { pending: 0, sent: 0, rejected: 0 } })); }
          continue;
        }
        if (agent.name === 'vaccine-reminders') {
          try {
            const API_BASE = `http://${window.location.hostname}:3001`;
            const res = await apiFetch(`${API_BASE}/api/stats`);
            if (res.ok) {
              const s = await res.json();
              setStats(prev => ({
                ...prev,
                [agent.id]: {
                  pending: parseInt(s.pending) || 0,
                  sent: parseInt(s.sent) || 0,
                  rejected: parseInt(s.rejected) || 0,
                },
              }));
            }
          } catch {
            setStats(prev => ({ ...prev, [agent.id]: { pending: 0, sent: 0, rejected: 0 } }));
          }
          continue;
        }
        const today = new Date().toISOString().split('T')[0];
        const [pending, sent, rejected] = await Promise.all([
          supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', agent.id).eq('status', 'pending'),
          supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', agent.id).eq('status', 'sent').gte('created_at', today),
          supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', agent.id).eq('status', 'rejected').gte('created_at', today),
        ]);
        setStats(prev => ({
          ...prev,
          [agent.id]: {
            pending: pending.count || 0,
            sent: sent.count || 0,
            rejected: rejected.count || 0,
          },
        }));
      }
    }
  }

  async function toggleAgent(agent: Agent) {
    await supabase.from('agents').update({ is_active: !agent.is_active }).eq('id', agent.id);
    loadAgents();
  }

  function getMainLink(agent: Agent): string {
    if (agent.name === 'vaccine-reminders') return '/vaccine';
    if (agent.name === 'appointment-booker') return '/appointment-booker';
    if (agent.name === 'appointment-reminder') return '/appointment-reminder';
    return `/queue/${agent.id}`;
  }

  function getSettingsLink(agent: Agent): string {
    if (agent.name === 'appointment-booker') return '/appointment-booker';
    return `/agent/${agent.id}`;
  }

  function getMainLabel(agent: Agent, pendingCount: number): string {
    if (agent.name === 'vaccine-reminders') return '💉 דשבורד תזכורות';
    if (agent.name === 'appointment-booker') return '📅 דשבורד קביעת תורים';
    if (agent.name === 'appointment-reminder') return '⏰ דשבורד תזכורות תורים';
    return `תור אישור ${pendingCount > 0 ? `(${pendingCount})` : ''}`;
  }

  function getAgentsByCategory(category: CategoryDef): Agent[] {
    return category.agents
      .map(name => agents.find(a => a.name === name))
      .filter((a): a is Agent => !!a);
  }

  function getUncategorized(): Agent[] {
    const allCategorized = CATEGORIES.flatMap(c => c.agents);
    return agents.filter(a => !allCategorized.includes(a.name));
  }

  function renderRateBadge(agent: Agent) {
    if (agent.name === 'appointment-reminder' && confirmRate !== null) {
      const color = confirmRate > 70 ? 'text-emerald-600 bg-emerald-50' : confirmRate > 50 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
      return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>אישור: {confirmRate}%</span>;
    }
    if (agent.name === 'appointment-booker' && conversionRate !== null) {
      const color = conversionRate > 40 ? 'text-emerald-600 bg-emerald-50' : conversionRate > 20 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
      return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>המרה: {conversionRate}%</span>;
    }
    return null;
  }

  function renderLastRun(agent: Agent) {
    const lr = lastRuns[agent.name];
    const color = lastRunColor(lr);
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className={color}>● {relativeTime(lr?.last_run_at ?? null)}</span>
        {lr?.status === 'error' && <span className="text-red-500 font-medium">⚠ שגיאה</span>}
        {renderRateBadge(agent)}
      </div>
    );
  }

  function renderGridCard(agent: Agent, isVaccine: boolean) {
    const s = stats[agent.id] || { pending: 0, sent: 0, rejected: 0 };
    const icon = AGENT_ICONS[agent.name] || '🤖';
    const h = health[healthKeyFor(agent.name)];
    return (
      <div key={agent.id} className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <span>{icon}</span>
              {agent.display_name}
            </h2>
            {DESCRIPTIONS[agent.name] && <p className="text-xs text-gray-500 mt-1 leading-snug">{DESCRIPTIONS[agent.name]}</p>}
            <p className="text-[10px] text-gray-300 mt-1">{agent.name}</p>
          </div>
          <button
            onClick={() => toggleAgent(agent)}
            className={`px-3 py-1 rounded-full text-sm font-medium shrink-0 ${
              agent.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {agent.is_active ? 'פעיל' : 'כבוי'}
          </button>
        </div>
        <div className="flex gap-4 text-sm mb-3">
          <div className="flex items-center gap-1">
            <span className="text-amber-500">⏳</span>
            <span>{s.pending} ממתינות</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-emerald-500">✅</span>
            <span>{s.sent} נשלחו</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-red-400">❌</span>
            <span>{s.rejected} נדחו</span>
          </div>
        </div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-gray-400">תזמון: {agent.cron_schedule}</span>
          {renderLastRun(agent)}
        </div>
        <div className="flex gap-2">
          <Link to={getMainLink(agent)}
            title={h?.reasons?.length ? h.reasons.join('\n') : undefined}
            className={`flex-1 text-center px-3 py-2 text-white rounded-lg text-sm font-medium ${statusButtonClass(h?.status)}`}>
            {getMainLabel(agent, s.pending)}
          </Link>
          {!isVaccine && (
            <Link to={getSettingsLink(agent)} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
              הגדרות
            </Link>
          )}
        </div>
        {h?.status === 'red' && !h.acked && (
          <button
            onClick={() => ackHealth(healthKeyFor(agent.name), 24)}
            className="mt-2 text-xs text-red-700 underline hover:text-red-900"
          >
            השתקה 24ש"
          </button>
        )}
      </div>
    );
  }

  function renderListHeader() {
    return (
      <div className="grid grid-cols-[2.5rem_11rem_1fr_4rem_13rem_7rem_5.5rem_11rem] items-center gap-3 px-5 py-2 text-[11px] text-gray-400 font-medium border-b">
        <div></div>
        <div>סוכן</div>
        <div className="hidden lg:block">תיאור</div>
        <div className="text-center">סטטוס</div>
        <div className="text-center">נתונים</div>
        <div className="text-center">הרצה אחרונה</div>
        <div className="text-center hidden md:block">תזמון</div>
        <div className="text-center">פעולות</div>
      </div>
    );
  }

  function renderListRow(agent: Agent, isVaccine: boolean) {
    const s = stats[agent.id] || { pending: 0, sent: 0, rejected: 0 };
    const h = health[healthKeyFor(agent.name)];
    const icon = AGENT_ICONS[agent.name] || '🤖';
    const total = s.pending + s.sent + s.rejected;
    const successRate = total > 0 ? Math.round((s.sent / total) * 100) : 0;
    const lr = lastRuns[agent.name];
    const lrColor = lastRunColor(lr);

    return (
      <div key={agent.id} className="bg-white rounded-lg border shadow-sm px-5 py-4 grid grid-cols-[2.5rem_11rem_1fr_4rem_13rem_7rem_5.5rem_11rem] items-center gap-3">
        <span className="text-2xl text-center">{icon}</span>
        <div>
          <h2 className="font-bold text-sm leading-tight">{agent.display_name}</h2>
          <p className="text-[10px] text-gray-400 mt-0.5">{agent.name}</p>
        </div>
        <div className="hidden lg:block">
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{DESCRIPTIONS[agent.name] || ''}</p>
        </div>
        <div className="text-center">
          <button
            onClick={() => toggleAgent(agent)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              agent.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {agent.is_active ? 'פעיל' : 'כבוי'}
          </button>
        </div>
        <div className="flex items-center justify-center gap-4 text-xs">
          <span className="flex items-center gap-1 text-amber-600 w-12 justify-end">
            {s.pending} <span>⏳</span>
          </span>
          <span className="flex items-center gap-1 text-emerald-600 w-12 justify-end">
            {s.sent} <span>✅</span>
          </span>
          <span className="flex items-center gap-1 text-red-500 w-12 justify-end">
            {s.rejected} <span>❌</span>
          </span>
          <span className="text-gray-400 text-[10px] w-8 text-center">
            {total > 0 ? `${successRate}%` : '—'}
          </span>
        </div>
        <div className="text-center">
          <span className={`text-[11px] ${lrColor}`}>
            {lr?.status === 'error' && '⚠ '}{relativeTime(lr?.last_run_at ?? null)}
          </span>
          {renderRateBadge(agent) && <div className="mt-0.5">{renderRateBadge(agent)}</div>}
        </div>
        <div className="text-[11px] text-gray-400 text-center hidden md:block">
          {agent.cron_schedule}
        </div>
        <div className="flex gap-2 justify-center">
          <Link to={getMainLink(agent)}
            title={h?.reasons?.length ? h.reasons.join('\n') : undefined}
            className={`px-3 py-1.5 text-white rounded-lg text-xs font-medium whitespace-nowrap ${statusButtonClass(h?.status)}`}>
            {getMainLabel(agent, s.pending)}
          </Link>
          {!isVaccine && (
            <Link to={getSettingsLink(agent)} className="px-2.5 py-1.5 border rounded-lg text-xs hover:bg-gray-50 whitespace-nowrap">
              הגדרות
            </Link>
          )}
        </div>
      </div>
    );
  }

  function renderCategory(category: CategoryDef) {
    const categoryAgents = getAgentsByCategory(category);
    if (categoryAgents.length === 0) return null;

    return (
      <div key={category.key} className="mb-8">
        <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg ${category.color} border ${category.borderColor}`}>
          <span className="text-lg">{category.icon}</span>
          <h2 className="font-bold text-sm">{category.label}</h2>
          <span className="text-xs text-gray-400 mr-1">({categoryAgents.length})</span>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categoryAgents.map(agent => renderGridCard(agent, agent.name === 'vaccine-reminders'))}
          </div>
        ) : (
          <div className="space-y-1">
            {renderListHeader()}
            {categoryAgents.map(agent => renderListRow(agent, agent.name === 'vaccine-reminders'))}
          </div>
        )}
      </div>
    );
  }

  const uncategorized = getUncategorized();

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">סוכנים</h1>
        <div className="flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'grid' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ▦ קוביות
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ☰ שורות
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="text-center text-gray-400 py-20">
          <div className="text-4xl mb-2">🤖</div>
          טוען סוכנים...
        </div>
      ) : (
        <>
          {CATEGORIES.map(cat => renderCategory(cat))}

          {uncategorized.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-lg">🤖</span>
                <h2 className="font-bold text-sm">אחר</h2>
                <span className="text-xs text-gray-400 mr-1">({uncategorized.length})</span>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {uncategorized.map(agent => renderGridCard(agent, false))}
                </div>
              ) : (
                <div className="space-y-1">
                  {renderListHeader()}
                  {uncategorized.map(agent => renderListRow(agent, false))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
