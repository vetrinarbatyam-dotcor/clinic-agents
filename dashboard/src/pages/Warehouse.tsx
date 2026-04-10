import { useEffect, useState } from 'react';

const API = `http://${window.location.hostname}:3003`;

interface Stats {
  counts: {
    visits: string; visit_items: string; vaccines: string; prescriptions: string;
    lab_results: string; appointments: string; therapists: string;
    clients: string; pets: string;
    latest_visit: string; earliest_visit: string; db_size: string;
  };
  recentRuns: Array<{
    layer: string; status: string; started_at: string; finished_at: string;
    duration_sec: number; rows_added: number; rows_updated: number; rows_failed: number;
    error_message: string;
  }>;
}

interface ConfigRow {
  key: string;
  value: any;
  description: string;
  updated_at: string;
}

interface Health {
  pets_without_visits: number;
  upcoming_appointments: number;
  last_hourly: string;
  last_daily: string;
  last_weekly: string;
  last_initial: string;
  initial_done: any;
}

export default function Warehouse() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState<string>('');

  async function loadAll() {
    const [s, c, h] = await Promise.all([
      fetch(`${API}/api/stats`).then(r => r.json()),
      fetch(`${API}/api/config`).then(r => r.json()),
      fetch(`${API}/api/health`).then(r => r.json()),
    ]);
    setStats(s); setConfig(c); setHealth(h);
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 10000);
    return () => clearInterval(t);
  }, []);

  async function runLayer(layer: string) {
    if (layer === 'initial' && !confirm('סנכרון ראשוני יקח 5-6 שעות. להריץ עכשיו?')) return;
    setRunning(layer);
    await fetch(`${API}/api/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer }),
    });
    setTimeout(() => { setRunning(''); loadAll(); }, 2000);
  }

  async function updateConfig(key: string, value: any) {
    await fetch(`${API}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    loadAll();
  }

  function timeAgo(iso: string | null): string {
    if (!iso) return 'מעולם';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)} ש`;
    if (diff < 3600) return `${Math.round(diff / 60)} ד`;
    if (diff < 86400) return `${Math.round(diff / 3600)} ש`;
    return `${Math.round(diff / 86400)} י`;
  }

  function getCfg(key: string): any {
    return config.find(c => c.key === key)?.value;
  }

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">🗄️ מאגר נתונים</h1>
          <p className="text-sm text-gray-500">קלון מקומי של ClinicaOnline — סנכרון אוטומטי</p>
        </div>
        <button onClick={loadAll} className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm">🔄 רענן</button>
      </div>

      {/* Initial sync banner */}
      {health && getCfg('initial_sync_done') !== true && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-amber-900">⚠️ סנכרון ראשוני לא בוצע</div>
              <div className="text-sm text-amber-700">מתוזמן ל-02:00 מחר. אפשר גם להריץ עכשיו ידנית.</div>
            </div>
            <button onClick={() => runLayer('initial')} disabled={running === 'initial'}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50">
              {running === 'initial' ? '🔄 רץ...' : '▶️ הרץ עכשיו'}
            </button>
          </div>
        </div>
      )}

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'לקוחות', val: stats.counts.clients, icon: '👥' },
            { label: 'חיות', val: stats.counts.pets, icon: '🐾' },
            { label: 'ביקורים', val: stats.counts.visits, icon: '📋' },
            { label: 'פריטים', val: stats.counts.visit_items, icon: '💊' },
            { label: 'חיסונים', val: stats.counts.vaccines, icon: '💉' },
            { label: 'מרשמים', val: stats.counts.prescriptions, icon: '📝' },
            { label: 'מעבדה', val: stats.counts.lab_results, icon: '🧪' },
            { label: 'תורים', val: stats.counts.appointments, icon: '📅' },
            { label: 'רופאים', val: stats.counts.therapists, icon: '👨‍⚕️' },
            { label: 'גודל DB', val: stats.counts.db_size, icon: '💾' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border shadow-sm p-4 text-center">
              <div className="text-2xl mb-1">{s.icon}</div>
              <div className="text-xl font-bold">{Number(s.val).toLocaleString?.() || s.val}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Layer cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {[
          { layer: 'hourly', name: 'שעתי', desc: 'תורים היום + מחר', icon: '⚡', cronKey: 'hourly_cron', enabledKey: 'hourly_enabled', last: health?.last_hourly },
          { layer: 'daily', name: 'יומי', desc: 'ביקורים אתמול + לקוחות', icon: '🌙', cronKey: 'daily_cron', enabledKey: 'daily_enabled', last: health?.last_daily },
          { layer: 'weekly', name: 'שבועי', desc: 'סריקה מלאה של כל החיות', icon: '📅', cronKey: 'weekly_cron', enabledKey: 'weekly_enabled', last: health?.last_weekly },
        ].map(card => {
          const enabled = getCfg(card.enabledKey);
          const cron = getCfg(card.cronKey);
          return (
            <div key={card.layer} className="bg-white rounded-xl border shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold flex items-center gap-2"><span className="text-xl">{card.icon}</span> {card.name}</h3>
                  <p className="text-xs text-gray-500">{card.desc}</p>
                </div>
                <button onClick={() => updateConfig(card.enabledKey, !enabled)}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {enabled ? 'פעיל' : 'כבוי'}
                </button>
              </div>

              <div className="text-xs text-gray-500 mb-3">
                <div>תזמון: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{cron}</code></div>
                <div>אחרון: {timeAgo(card.last)}</div>
              </div>

              <button onClick={() => runLayer(card.layer)} disabled={running === card.layer}
                className="w-full px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                {running === card.layer ? '🔄 רץ...' : '▶️ הרץ עכשיו'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Recent runs table */}
      {stats && stats.recentRuns.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold mb-3">📊 ריצות אחרונות</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right">שכבה</th>
                  <th className="px-3 py-2 text-right">סטטוס</th>
                  <th className="px-3 py-2 text-right">התחיל</th>
                  <th className="px-3 py-2 text-right">משך</th>
                  <th className="px-3 py-2 text-right">נוסף</th>
                  <th className="px-3 py-2 text-right">עודכן</th>
                  <th className="px-3 py-2 text-right">נכשל</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRuns.map((r, i) => (
                  <tr key={i} className={i % 2 ? 'bg-gray-50' : ''}>
                    <td className="px-3 py-2">{r.layer}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        r.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'running' ? 'bg-blue-100 text-blue-700' :
                        'bg-red-100 text-red-700'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{timeAgo(r.started_at)}</td>
                    <td className="px-3 py-2 text-xs">{r.duration_sec ? `${r.duration_sec}s` : '-'}</td>
                    <td className="px-3 py-2">{r.rows_added}</td>
                    <td className="px-3 py-2">{r.rows_updated}</td>
                    <td className="px-3 py-2">{r.rows_failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Health */}
      {health && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold mb-3">🩺 בריאות מערכת</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-gray-500">חיות בלי ביקורים:</span> <strong>{health.pets_without_visits}</strong></div>
            <div><span className="text-gray-500">תורים עתידיים:</span> <strong>{health.upcoming_appointments}</strong></div>
            <div><span className="text-gray-500">שעתי אחרון:</span> {timeAgo(health.last_hourly)}</div>
            <div><span className="text-gray-500">יומי אחרון:</span> {timeAgo(health.last_daily)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
