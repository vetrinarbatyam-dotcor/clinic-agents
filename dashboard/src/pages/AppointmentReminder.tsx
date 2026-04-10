import { useEffect, useState } from 'react';

const API = `http://${window.location.hostname}/api/agents/appointment_reminder`;

interface Status {
  enabled: boolean;
  mode: string;
  template_mode: string;
  reminders_sent_24h: number;
  confirmed_7d: number;
  canceled_7d: number;
  runs_24h: number;
  control_phone: string;
  test_mode: boolean;
}

interface Reminder {
  id: number;
  event_id: number;
  phone: string;
  pet_name: string;
  treatment_type: string;
  appointment_at: string;
  reminder_type: string;
  status: string;
  sent_at: string;
  replied_at: string | null;
  reply_text: string | null;
}

interface Run {
  id: number;
  event_type: string;
  phone: string | null;
  details: any;
  created_at: string;
}

const TEMPLATE_KEYS = ['vaccine', 'surgery', 'checkup', 'dental', 'followup', 'generic'];
const TEMPLATE_LABELS: Record<string, string> = {
  vaccine: '💉 חיסון',
  surgery: '🏥 ניתוח / סירוס',
  checkup: '🩺 בדיקה',
  dental: '🦷 שיניים',
  followup: '✂️ מעקב / הסרת תפרים',
  generic: '📅 כללי',
};

export default function AppointmentReminder() {
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'templates' | 'reminders' | 'runs'>('overview');

  async function refresh() {
    try {
      const [s, c, r, ru] = await Promise.all([
        fetch(`${API}/status`).then((x) => x.json()),
        fetch(`${API}/config`).then((x) => x.json()),
        fetch(`${API}/reminders?limit=30`).then((x) => x.json()),
        fetch(`${API}/runs?limit=30`).then((x) => x.json()),
      ]);
      setStatus(s);
      setConfig(c);
      setReminders(r.reminders || []);
      setRuns(ru.runs || []);
      setErr('');
    } catch (e: any) {
      setErr('שגיאה בטעינה: ' + e.message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, []);

  async function saveConfig(updated: any) {
    setBusy(true);
    setMsg('');
    try {
      await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updated, updated_by: 'dashboard' }),
      });
      await refresh();
      setMsg('✅ נשמר');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!status) return;
    await fetch(`${API}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !status.enabled }),
    });
    await refresh();
  }

  async function setMode(mode: 'shadow' | 'live') {
    if (!config) return;
    await saveConfig({ ...config, mode });
  }

  async function setTemplateMode(template_mode: '6' | '3' | '1') {
    if (!config) return;
    await saveConfig({ ...config, template_mode });
  }

  async function updateTemplate(key: string, value: string) {
    if (!config) return;
    const templates = { ...(config.templates || {}), [key]: value };
    await saveConfig({ ...config, templates });
  }

  async function runNow() {
    setBusy(true);
    setMsg('⏳ מריץ סריקה...');
    try {
      const r = await fetch(`${API}/run_now`, { method: 'POST' }).then((x) => x.json());
      setMsg(r.ok ? `✅ הסריקה הסתיימה` : `❌ ${r.error || r.stderr}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function testSendAll() {
    if (!confirm(`ישלח את כל התזכורות של מחר לטלפון הבקרה ${status?.control_phone}. להמשיך?`)) return;
    setBusy(true);
    setMsg('⏳ שולח את כל ההודעות לטלפון הבקרה...');
    try {
      const r = await fetch(`${API}/test_send_all`, { method: 'POST' }).then((x) => x.json());
      setMsg(r.ok ? `✅ נשלח לטלפון בקרה. בדוק וואטסאפ` : `❌ ${r.error || r.stderr}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!status || !config) {
    return <div className="p-6 text-right" dir="rtl">טוען...</div>;
  }

  return (
    <div className="p-6 text-right max-w-6xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold mb-2">📅 סוכן תזכורות תורים</h1>
      <p className="text-gray-600 mb-4">שולח תזכורות אוטומטיות 24 שעות לפני התור, דרך וואטסאפ.</p>

      {err && <div className="bg-red-100 border border-red-300 text-red-800 p-3 rounded mb-4">{err}</div>}
      {msg && <div className="bg-blue-100 border border-blue-300 text-blue-800 p-3 rounded mb-4">{msg}</div>}

      {/* Master Control Panel */}
      <div className="bg-white border-2 border-blue-300 rounded-xl p-5 mb-6 shadow">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-lg font-bold mb-1">🎛️ שליטה ובקרה</div>
            <div className="text-sm text-gray-600">
              מצב: <span className={`font-bold ${status.enabled ? 'text-green-700' : 'text-gray-500'}`}>
                {status.enabled ? '🟢 פעיל' : '⚫ כבוי'}
              </span>
              {' · '}
              מסלול: <span className="font-bold">
                {status.mode === 'live' ? '🚀 LIVE (שולח ללקוחות)' : '🌑 SHADOW (לוגים בלבד)'}
              </span>
            </div>
          </div>
          <button
            onClick={toggleEnabled}
            disabled={busy}
            className={`px-6 py-3 rounded-lg font-bold text-white text-lg shadow ${
              status.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {status.enabled ? '⏸ כבה סוכן' : '▶ הפעל סוכן'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => setMode('shadow')}
            className={`p-3 rounded border-2 ${status.mode === 'shadow' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}
          >
            🌑 <strong>Shadow</strong> — סורק ולוג, לא שולח
          </button>
          <button
            onClick={() => setMode('live')}
            className={`p-3 rounded border-2 ${status.mode === 'live' ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}
          >
            🚀 <strong>Live</strong> — שולח ללקוחות אמיתיים
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runNow}
            disabled={busy || !status.enabled}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
          >
            🔄 הרץ סריקה עכשיו
          </button>
          <button
            onClick={testSendAll}
            disabled={busy}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
          >
            🧪 שלח הכל לטלפון בקרה ({status.control_phone})
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat label="נשלחו ב-24ש" value={status.reminders_sent_24h} color="blue" />
        <Stat label="אושרו (7 ימים)" value={status.confirmed_7d} color="green" />
        <Stat label="בוטלו (7 ימים)" value={status.canceled_7d} color="red" />
        <Stat label="ריצות 24ש" value={status.runs_24h} color="gray" />
      </div>

      {/* Tabs */}
      <div className="border-b mb-4 flex gap-1">
        {(['overview', 'templates', 'reminders', 'runs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${tab === t ? 'border-b-2 border-blue-600 font-bold' : 'text-gray-500'}`}
          >
            {{ overview: 'הגדרות', templates: 'תבניות', reminders: 'תזכורות', runs: 'ריצות' }[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="bg-white p-4 rounded border space-y-4">
          <h3 className="font-bold">⚙️ מצב תבניות</h3>
          <div className="grid grid-cols-3 gap-2">
            {(['6', '3', '1'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTemplateMode(m)}
                className={`p-3 rounded border-2 ${config.template_mode === m ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}
              >
                {m === '6' ? '6 תבניות מפורטות' : m === '3' ? '3 תבניות' : 'תבנית אחת (generic)'}
              </button>
            ))}
          </div>

          <h3 className="font-bold">📞 טלפון בקרה</h3>
          <input
            type="text"
            value={config.control_phone || ''}
            onChange={(e) => setConfig({ ...config, control_phone: e.target.value })}
            onBlur={() => saveConfig(config)}
            className="border p-2 rounded w-64"
          />
          <p className="text-sm text-gray-500">לבדיקות E2E — כל ההודעות נשלחות לטלפון זה במקום ללקוחות.</p>

          <h3 className="font-bold">⏱ חלון שליחה</h3>
          <div className="flex gap-2 items-center">
            <input
              type="time"
              value={config.send_window_start}
              onChange={(e) => setConfig({ ...config, send_window_start: e.target.value })}
              onBlur={() => saveConfig(config)}
              className="border p-2 rounded"
            />
            עד
            <input
              type="time"
              value={config.send_window_end}
              onChange={(e) => setConfig({ ...config, send_window_end: e.target.value })}
              onBlur={() => saveConfig(config)}
              className="border p-2 rounded"
            />
          </div>

          <h3 className="font-bold">✅ דילוגים</h3>
          <div className="space-y-1">
            <Toggle label="דלג על שבת/חג" checked={config.skip_weekends} onChange={(v) => saveConfig({ ...config, skip_weekends: v })} />
            <Toggle label="דלג על תורים שאושרו ידנית" checked={config.skip_confirmed_manually} onChange={(v) => saveConfig({ ...config, skip_confirmed_manually: v })} />
            <Toggle label="דלג על תורים בלי טלפון" checked={config.skip_no_phone} onChange={(v) => saveConfig({ ...config, skip_no_phone: v })} />
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          {TEMPLATE_KEYS.map((k) => (
            <div key={k} className="bg-white p-4 rounded border">
              <div className="font-bold mb-2">{TEMPLATE_LABELS[k]}</div>
              <textarea
                value={config.templates?.[k] || ''}
                onChange={(e) => setConfig({ ...config, templates: { ...config.templates, [k]: e.target.value } })}
                onBlur={() => updateTemplate(k, config.templates[k])}
                rows={6}
                className="w-full border p-2 rounded font-mono text-sm"
                dir="rtl"
              />
              <div className="text-xs text-gray-500 mt-1">
                משתנים: {'{client_name}'} {'{pet_name}'} {'{date}'} {'{time}'} {'{day_name}'} {'{treatment_name}'}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'reminders' && (
        <div className="bg-white rounded border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2">מזהה תור</th>
                <th className="p-2">חיה</th>
                <th className="p-2">סוג</th>
                <th className="p-2">טלפון</th>
                <th className="p-2">תור ב-</th>
                <th className="p-2">סטטוס</th>
                <th className="p-2">תגובה</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.event_id}</td>
                  <td className="p-2">{r.pet_name}</td>
                  <td className="p-2">{r.treatment_type}</td>
                  <td className="p-2 font-mono">{r.phone}</td>
                  <td className="p-2">{new Date(r.appointment_at).toLocaleString('he-IL')}</td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      r.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                      r.status === 'canceled' ? 'bg-red-100 text-red-800' :
                      r.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>{r.status}</span>
                  </td>
                  <td className="p-2 text-xs">{r.reply_text || '-'}</td>
                </tr>
              ))}
              {reminders.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-gray-400">אין תזכורות עדיין</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'runs' && (
        <div className="bg-white rounded border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2">סוג</th>
                <th className="p-2">טלפון</th>
                <th className="p-2">פרטים</th>
                <th className="p-2">מתי</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.event_type}</td>
                  <td className="p-2 font-mono">{r.phone || '-'}</td>
                  <td className="p-2 font-mono text-xs">{JSON.stringify(r.details)}</td>
                  <td className="p-2">{new Date(r.created_at).toLocaleString('he-IL')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    gray: 'bg-gray-50 border-gray-200',
  };
  return (
    <div className={`p-4 rounded border ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
