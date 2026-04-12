import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
import AgentStackPanel from '../components/AgentStackPanel';
import { Link } from 'react-router-dom';

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : `http://${window.location.hostname}:3001`;

interface VaccineReminder {
  id: string;
  pet_id: number;
  pet_name: string;
  owner_name: string;
  owner_phone: string;
  vaccine_name: string;
  due_date: string;
  stage: number;
  status: string;
  message_text: string;
  created_at: string;
  sent_at: string | null;
}

interface Stats {
  total: number;
  pending: number;
  sent: number;
  rejected: number;
  skipped: number;
  approved: number;
  byStage: Record<number, number>;
  byVaccine: Record<string, number>;
}

const STAGE_INFO: Record<number, { name: string; icon: string; color: string; desc: string }> = {
  1: { name: 'תזכורת ראשונה', icon: '📅', color: 'blue', desc: 'שבוע לפני מועד החיסון' },
  2: { name: 'תזכורת שנייה', icon: '⏰', color: 'amber', desc: '3 ימים אחרי המועד (לא הגיעו)' },
  3: { name: 'תזכורת שלישית', icon: '⚠️', color: 'orange', desc: 'שבועיים וחצי אחרי המועד' },
  4: { name: 'תזכורת אחרונה', icon: '🔴', color: 'red', desc: 'חודש אחרי המועד' },
};

export default function VaccineReminders() {
  const [reminders, setReminders] = useState<VaccineReminder[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, sent: 0, rejected: 0, skipped: 0, approved: 0, byStage: {}, byVaccine: {} });
  const [tab, setTab] = useState<'overview' | 'pending' | 'history' | 'logic'>('overview');
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [statsRes, remindersRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/stats`),
        apiFetch(`${API_BASE}/api/reminders?limit=500`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (remindersRes.ok) setReminders(await remindersRes.json());
    } catch (e) {
      console.error('Failed to load data:', e);
    }
    setLoading(false);
  }

  async function approveReminder(id: string) {
    await apiFetch(`${API_BASE}/api/reminders/${id}/approve`, { method: 'PUT' });
    loadData();
  }

  async function rejectReminder(id: string) {
    await apiFetch(`${API_BASE}/api/reminders/${id}/reject`, { method: 'PUT' });
    loadData();
  }

  async function approveAll() {
    await apiFetch(`${API_BASE}/api/reminders/approve-all`, { method: 'PUT' });
    loadData();
  }

  if (loading) return <div className="text-center py-20 text-gray-400">💉 טוען נתוני חיסונים...</div>;

  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const filteredReminders = filter === 'all' ? reminders : reminders.filter(r => r.status === filter);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-2xl font-bold">💉 תזכורות חיסונים</h1>
        </div>
      <AgentStackPanel agentName={'vaccine-reminders'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {([
          { key: 'overview', label: 'סקירה', icon: '📊' },
          { key: 'pending', label: `ממתינות (${stats.pending})`, icon: '⏳' },
          { key: 'history', label: 'היסטוריה', icon: '📋' },
          { key: 'logic', label: 'לוגיקה', icon: '🧠' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-5">
            <div className="bg-white rounded-xl border shadow-sm p-5 text-center">
              <div className="text-3xl font-bold text-amber-500">{stats.pending}</div>
              <div className="text-sm text-gray-500 mt-1">⏳ ממתינות</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-5 text-center">
              <div className="text-3xl font-bold text-blue-500">{stats.approved}</div>
              <div className="text-sm text-gray-500 mt-1">✔️ מאושרות</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-5 text-center">
              <div className="text-3xl font-bold text-emerald-500">{stats.sent}</div>
              <div className="text-sm text-gray-500 mt-1">✅ נשלחו</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-5 text-center">
              <div className="text-3xl font-bold text-red-400">{stats.rejected}</div>
              <div className="text-sm text-gray-500 mt-1">❌ נדחו</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-5 text-center">
              <div className="text-3xl font-bold text-gray-400">{stats.skipped}</div>
              <div className="text-sm text-gray-500 mt-1">⏭️ דולגו</div>
            </div>
          </div>

          {/* Stage Distribution */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">📊 התפלגות לפי שלב תזכורת</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map(stageNum => {
                const info = STAGE_INFO[stageNum];
                const count = stats.byStage[stageNum] || 0;
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={stageNum} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{info.icon}</span>
                      <span className="font-medium text-sm">{info.name}</span>
                    </div>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="w-full bg-gray-100 rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${
                          stageNum === 1 ? 'bg-blue-400' : stageNum === 2 ? 'bg-amber-400' :
                          stageNum === 3 ? 'bg-orange-400' : 'bg-red-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Vaccine Type Distribution */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">💉 התפלגות לפי סוג חיסון</h2>
            <div className="space-y-2">
              {Object.entries(stats.byVaccine)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{count}</span>
                  </div>
                ))}
              {Object.keys(stats.byVaccine).length === 0 && (
                <div className="text-center text-gray-400 py-4">אין נתונים עדיין</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === PENDING TAB === */}
      {tab === 'pending' && (
        <div className="space-y-4">
          {pendingReminders.length > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">{pendingReminders.length} תזכורות ממתינות</span>
              <button
                onClick={approveAll}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
              >
                ✅ אשר הכל ({pendingReminders.length})
              </button>
            </div>
          )}

          {pendingReminders.map(r => {
            const info = STAGE_INFO[r.stage] || STAGE_INFO[1];
            return (
              <div key={r.id} className="bg-white rounded-xl border shadow-sm p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{info.icon}</span>
                      <span className="font-bold">{r.owner_name}</span>
                      <span className="text-sm text-gray-400">({r.owner_phone})</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      🐾 {r.pet_name} — {r.vaccine_name}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {info.name} • מועד: {r.due_date}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveReminder(r.id)}
                      className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-200"
                    >
                      ✅ אשר
                    </button>
                    <button
                      onClick={() => rejectReminder(r.id)}
                      className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200"
                    >
                      ❌ דחה
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
                >
                  {expandedId === r.id ? 'הסתר הודעה' : 'הצג הודעה'}
                </button>

                {expandedId === r.id && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-4 text-sm whitespace-pre-wrap" dir="rtl">
                    {r.message_text}
                  </div>
                )}
              </div>
            );
          })}

          {pendingReminders.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <div className="text-4xl mb-2">✅</div>
              אין תזכורות ממתינות לאישור
            </div>
          )}
        </div>
      )}

      {/* === HISTORY TAB === */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex gap-2 mb-4">
            {['all', 'pending', 'approved', 'sent', 'rejected', 'skipped'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f === 'all' ? 'הכל' : f === 'pending' ? '⏳ ממתין' : f === 'approved' ? '✔️ מאושר' :
                 f === 'sent' ? '✅ נשלח' : f === 'rejected' ? '❌ נדחה' : '⏭️ דולג'}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-right p-3">תאריך</th>
                  <th className="text-right p-3">בעלים</th>
                  <th className="text-right p-3">חיה</th>
                  <th className="text-right p-3">חיסון</th>
                  <th className="text-right p-3">שלב</th>
                  <th className="text-right p-3">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {filteredReminders.slice(0, 50).map(r => {
                  const info = STAGE_INFO[r.stage] || STAGE_INFO[1];
                  const statusColors: Record<string, string> = {
                    pending: 'bg-amber-100 text-amber-700',
                    approved: 'bg-blue-100 text-blue-700',
                    sent: 'bg-emerald-100 text-emerald-700',
                    rejected: 'bg-red-100 text-red-600',
                    skipped: 'bg-gray-100 text-gray-500',
                  };
                  const statusLabels: Record<string, string> = {
                    pending: 'ממתין',
                    approved: 'מאושר',
                    sent: 'נשלח',
                    rejected: 'נדחה',
                    skipped: 'דולג',
                  };
                  return (
                    <tr key={r.id} className="border-t hover:bg-gray-50">
                      <td className="p-3 text-gray-500">{new Date(r.created_at).toLocaleDateString('he-IL')}</td>
                      <td className="p-3 font-medium">{r.owner_name}</td>
                      <td className="p-3">{r.pet_name}</td>
                      <td className="p-3">{r.vaccine_name}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-1">
                          {info.icon} <span className="text-xs">{r.stage}</span>
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[r.status] || ''}`}>
                          {statusLabels[r.status] || r.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredReminders.length === 0 && (
              <div className="text-center text-gray-400 py-10">אין נתונים</div>
            )}
            {filteredReminders.length > 50 && (
              <div className="text-center text-gray-400 text-xs py-3 border-t">
                מציג 50 מתוך {filteredReminders.length}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === LOGIC TAB === */}
      {tab === 'logic' && (
        <div className="space-y-4">
          {/* Pipeline visualization */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">🔄 תהליך התזכורות</h2>
            <div className="flex items-start gap-0">
              {[1, 2, 3, 4].map((stageNum, idx) => {
                const info = STAGE_INFO[stageNum];
                return (
                  <div key={stageNum} className="flex-1 text-center relative">
                    <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center text-xl ${
                      stageNum === 1 ? 'bg-blue-100' : stageNum === 2 ? 'bg-amber-100' :
                      stageNum === 3 ? 'bg-orange-100' : 'bg-red-100'
                    }`}>
                      {info.icon}
                    </div>
                    {idx < 3 && (
                      <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-200 -z-10" style={{ left: '50%', width: '100%' }} />
                    )}
                    <div className="mt-2 text-sm font-medium">{info.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{info.desc}</div>
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      {stageNum === 1 ? '-7 ימים' : stageNum === 2 ? '+3 ימים' : stageNum === 3 ? '+17 ימים' : '+30 ימים'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Logic Details */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">🧠 לוגיקת הפעולה</h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-bold text-blue-600 mb-2">📅 שלב 1 — תזכורת מקדימה (7 ימים לפני)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>הסוכן סורק את רשימת <span className="font-mono bg-gray-200 px-1 rounded">GetVaccineLaters</span> מ-ClinicaOnline</li>
                  <li>מזהה חיות שמועד החיסון שלהן בעוד שבוע</li>
                  <li>שולח הודעה חמה ונעימה להזכיר על החיסון</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-amber-600 mb-2">⏰ שלב 2 — תזכורת שנייה (3 ימים אחרי)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>בודק אם הלקוח ביקר במרפאה מאז המועד</li>
                  <li>אם כן → דילוג (כנראה כבר חוסן)</li>
                  <li>אם לא → שולח תזכורת עדינה</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-orange-600 mb-2">⚠️ שלב 3 — תזכורת שלישית (17 ימים אחרי)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>בדיקה חוזרת אם ביקרו</li>
                  <li>תזכורת חזקה יותר — מדגישה את חשיבות ההגנה</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-red-600 mb-2">🔴 שלב 4 — תזכורת אחרונה (30 ימים אחרי)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>תזכורת אחרונה במחזור</li>
                  <li>אחרי שלב 4 → מפסיק לתזכר (עד החיסון הבא)</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-emerald-600 mb-2">🛡️ הגנות</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>לא שולח בשבת/חג</li>
                  <li>לא שולח אם אין מספר טלפון</li>
                  <li>לא שולח אם כבר נשלח באותו שלב</li>
                  <li>דילוג אוטומטי אם הלקוח ביקר מאז המועד</li>
                  <li>מגבלת 30 תזכורות ביום</li>
                  <li>חלון סבילות ±2 ימים לכל שלב</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
