import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = '';

interface Overview {
  totals: { total_messages: number; incoming: number; outgoing: number; unique_clients: number };
  by_instance: { instance_id: string; count: number }[];
  last_7_days: { day: string; count: number }[];
  last_message: { direction: string; chat_id: string; sender_name: string; text: string; timestamp: string } | null;
}

interface Health {
  services: Record<string, string>;
  tunnel_url: string;
  db_ok: boolean;
}

interface Report {
  period: string;
  from: string;
  to: string;
  totals: { total: number; incoming: number; outgoing: number; unique_clients: number };
  by_instance: { instance_id: string; count: number }[];
  by_hour: { hour: number; count: number }[];
  by_day_of_week: { dow: number; count: number }[];
  top_clients: { chat_id: string; name: string; count: number }[];
  top_words: { word: string; count: number }[];
}

const INSTANCE_LABELS: Record<string, string> = {
  '7107581059': 'טאבלט (tablet)',
  '7107581324': 'קו נייח (landline)',
};

const DOW_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function WhatsAppDB() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadReport(period); }, [period]);

  async function loadAll() {
    try {
      const [ov, h] = await Promise.all([
        apiFetch(`${API_BASE}/api/agents/whatsapp_db/overview`).then(r => r.json()),
        apiFetch(`${API_BASE}/api/agents/whatsapp_db/health`).then(r => r.json()),
      ]);
      setOverview(ov);
      setHealth(h);
    } catch (e) { console.error(e); }
  }

  async function loadReport(p: string) {
    setLoading(true);
    try {
      const r = await apiFetch(`${API_BASE}/api/agents/whatsapp_db/report/${p}`).then(r => r.json());
      setReport(r);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function exportCsv() {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    window.location.href = `${API_BASE}/api/agents/whatsapp_db/export?from=${from}&to=${to}`;
  }

  const maxDay = Math.max(...(overview?.last_7_days.map(d => d.count) || [1]));
  const maxHour = Math.max(...(report?.by_hour.map(h => h.count) || [1]));

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-gray-500 hover:underline">← חזרה</Link>
        <h1 className="text-2xl font-bold">📱 ארכיון WhatsApp</h1>
        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Passive Collector</span>
        <button onClick={loadAll} className="mr-auto px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm">🔄 רענן</button>
      </div>

      {/* HEALTH */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold mb-3">🩺 מצב שירותים</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {health && Object.entries(health.services).map(([svc, state]) => (
            <div key={svc} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
              <span className={`w-2 h-2 rounded-full ${state === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-xs font-mono">{svc}</span>
              <span className="text-xs text-gray-500 mr-auto">{state}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
            <span className={`w-2 h-2 rounded-full ${health?.db_ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className="text-xs">DB</span>
            <span className="text-xs text-gray-500 mr-auto">{health?.db_ok ? 'ok' : 'fail'}</span>
          </div>
        </div>
        {health?.tunnel_url && (
          <div className="mt-3 text-xs text-gray-600 break-all">
            🌐 Tunnel: <a href={health.tunnel_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{health.tunnel_url}</a>
          </div>
        )}
      </div>

      {/* TOTALS */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="סה״כ הודעות" value={overview.totals.total_messages} icon="💬" color="emerald" />
          <StatCard label="נכנסות" value={overview.totals.incoming} icon="📥" color="blue" />
          <StatCard label="יוצאות" value={overview.totals.outgoing} icon="📤" color="amber" />
          <StatCard label="לקוחות ייחודיים" value={overview.totals.unique_clients} icon="👥" color="purple" />
        </div>
      )}

      {/* 7-DAY CHART */}
      {overview && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold mb-4">📈 7 ימים אחרונים</h2>
          <div className="flex items-end gap-2 h-32">
            {overview.last_7_days.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-xs text-gray-500">{d.count}</div>
                <div
                  className="w-full bg-emerald-500 rounded-t"
                  style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: '4px' }}
                />
                <div className="text-[10px] text-gray-400">{d.day.slice(5)}</div>
              </div>
            ))}
            {overview.last_7_days.length === 0 && <div className="text-gray-400 text-sm">אין נתונים</div>}
          </div>
        </div>
      )}

      {/* BY INSTANCE */}
      {overview && overview.by_instance.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold mb-3">📞 פילוח לפי מספר</h2>
          <div className="space-y-2">
            {overview.by_instance.map(b => (
              <div key={b.instance_id} className="flex items-center gap-3 text-sm">
                <span className="font-medium w-40">{INSTANCE_LABELS[b.instance_id] || b.instance_id}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${(b.count / overview.totals.total_messages) * 100}%` }} />
                </div>
                <span className="tabular-nums w-12 text-left">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* REPORTS */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="font-bold">📊 דוחות</h2>
          <div className="flex gap-1 mr-auto">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded text-sm ${period === p ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {p === 'daily' ? 'יומי' : p === 'weekly' ? 'שבועי' : 'חודשי'}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="text-center text-gray-400 py-8">טוען...</div>}

        {report && !loading && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SmallStat label="סה״כ" value={report.totals.total} />
              <SmallStat label="נכנסות" value={report.totals.incoming} />
              <SmallStat label="יוצאות" value={report.totals.outgoing} />
              <SmallStat label="לקוחות" value={report.totals.unique_clients} />
            </div>

            {/* HOURS */}
            <div>
              <div className="text-sm font-medium mb-2">⏰ שעות שיא</div>
              <div className="flex items-end gap-1 h-20">
                {Array.from({ length: 24 }, (_, h) => {
                  const rec = report.by_hour.find(x => x.hour === h);
                  const c = rec?.count || 0;
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-blue-500 rounded-t" style={{ height: `${(c / maxHour) * 100}%`, minHeight: c > 0 ? '3px' : '1px' }} title={`${h}:00 - ${c}`} />
                      <div className="text-[9px] text-gray-400">{h}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* DOW */}
            <div>
              <div className="text-sm font-medium mb-2">📅 ימי שבוע</div>
              <div className="grid grid-cols-7 gap-2">
                {DOW_NAMES.map((name, i) => {
                  const rec = report.by_day_of_week.find(x => x.dow === i);
                  return (
                    <div key={i} className="text-center p-2 bg-gray-50 rounded">
                      <div className="text-xs text-gray-500">{name}</div>
                      <div className="font-bold text-emerald-700">{rec?.count || 0}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TOP CLIENTS */}
            {report.top_clients.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">👑 Top 10 לקוחות</div>
                <table className="w-full text-sm">
                  <tbody>
                    {report.top_clients.map((c, i) => (
                      <tr key={c.chat_id} className="border-b last:border-0">
                        <td className="py-1 text-gray-400 w-6">{i + 1}</td>
                        <td className="py-1">{c.name}</td>
                        <td className="py-1 text-left text-gray-500 text-xs">{c.chat_id.split('@')[0]}</td>
                        <td className="py-1 text-left font-bold">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TOP WORDS */}
            {report.top_words.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">🏷️ Top 20 מילים</div>
                <div className="flex flex-wrap gap-2">
                  {report.top_words.map(w => (
                    <span
                      key={w.word}
                      className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-sm"
                      style={{ fontSize: `${Math.min(14 + w.count / 2, 20)}px` }}
                    >
                      {w.word} <span className="text-xs text-purple-400">{w.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXPORT */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold mb-3">⚙️ פעולות</h2>
        <div className="flex gap-3 flex-wrap">
          <button onClick={exportCsv} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
            📥 ייצוא CSV (30 ימים אחרונים)
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs opacity-75">{label}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded p-3 text-center">
      <div className="text-xl font-bold text-emerald-700 tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
