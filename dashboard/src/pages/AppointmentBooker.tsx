import { useEffect, useState } from 'react';

const API = '/api/agents/appointment_booker';

interface Status {
  enabled: boolean;
  mode: string;
  active_sessions: number;
  appointments_last_7d: number;
  runs_last_24h: number;
  profiles_enabled: string[];
}

interface Run {
  id: number;
  event_type: string;
  phone: string | null;
  details: any;
  created_at: string;
}

interface Appointment {
  id: number;
  treatment_key: string;
  event_id: number;
  phone: string;
  scheduled_at: string;
  duration_min: number;
  simulated: boolean;
  status: string;
}

export default function AppointmentBooker() {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [testPhone, setTestPhone] = useState('0543123419');
  const [testText, setTestText] = useState('היי');
  const [testResult, setTestResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() {
    try {
      const [s, r, a] = await Promise.all([
        fetch(`${API}/status`).then((x) => x.json()),
        fetch(`${API}/runs?limit=30`).then((x) => x.json()),
        fetch(`${API}/appointments?limit=20`).then((x) => x.json()),
      ]);
      setStatus(s);
      setRuns(r.runs || []);
      setAppts(a.appointments || []);
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

  async function toggleEnabled() {
    if (!status) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/config`);
      const c = await r.json();
      c.enabled = !status.enabled;
      await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: c, updated_by: 'agents-dashboard' }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: 'shadow' | 'dry_run' | 'live') {
    setBusy(true);
    try {
      const r = await fetch(`${API}/config`);
      const c = await r.json();
      c.mode = mode;
      await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: c, updated_by: 'agents-dashboard' }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    const r = await fetch(`${API}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone, text: testText }),
    });
    setTestResult(await r.json());
    refresh();
  }

  async function resetSession() {
    await fetch(`${API}/reset_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone }),
    });
    setTestResult(null);
    refresh();
  }

  if (err) return <div className="bg-red-50 text-red-700 p-4 rounded">{err}</div>;
  if (!status) return <div className="text-center p-8">טוען...</div>;

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📅 סוכן קביעת תורים</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${status.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
          {status.enabled ? '🟢 פעיל' : '⚪ כבוי'} · {status.mode}
        </span>
      </div>

      {/* Master controls */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🛡️ שליטה</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleEnabled}
            disabled={busy}
            className={`px-4 py-2 rounded-lg font-medium ${status.enabled ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
          >
            {status.enabled ? '⏸️ כבה סוכן' : '▶️ הפעל סוכן'}
          </button>
          <div className="flex gap-1">
            {(['shadow', 'dry_run', 'live'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={busy}
                className={`px-3 py-2 rounded-lg text-sm ${status.mode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {m === 'shadow' && '👀 צל'}
                {m === 'dry_run' && '🧪 הדמיה'}
                {m === 'live' && '🔴 חי'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500">
          shadow = רק לוגים · dry_run = סימולציה מלאה · live = קביעות אמיתיות ב-ClinicaOnline
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-3xl font-bold">{status.active_sessions}</div>
          <div className="text-xs text-gray-500">סשנים פעילים</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-3xl font-bold">{status.appointments_last_7d}</div>
          <div className="text-xs text-gray-500">תורים השבוע</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-3xl font-bold">{status.runs_last_24h}</div>
          <div className="text-xs text-gray-500">אירועים יומי</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-base font-bold">{status.profiles_enabled?.join(', ') || '—'}</div>
          <div className="text-xs text-gray-500">פרופילים פעילים</div>
        </div>
      </div>

      {/* Test panel */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🧪 בדיקה ידנית</h2>
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="טלפון"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
          <input
            placeholder="טקסט הודעה"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="px-3 py-2 border rounded-lg col-span-2"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={sendTest} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">📤 שלח בדיקה</button>
          <button onClick={resetSession} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">🔄 אפס סשן</button>
        </div>
        {testResult && (
          <pre dir="ltr" className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Recent appointments */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold mb-3">📅 תורים אחרונים</h2>
        {appts.length === 0 ? (
          <div className="text-sm text-gray-500">אין תורים עדיין</div>
        ) : (
          <div className="space-y-1 text-sm">
            {appts.map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-500">#{a.event_id || '—'}</span>
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{a.treatment_key}</span>
                  {a.simulated && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs">סימולציה</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {a.phone} · {new Date(a.scheduled_at).toLocaleString('he-IL')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent runs */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold mb-3">📜 אירועים אחרונים</h2>
        {runs.length === 0 ? (
          <div className="text-sm text-gray-500">אין אירועים</div>
        ) : (
          <div className="space-y-1 text-xs font-mono max-h-96 overflow-y-auto">
            {runs.map((r) => (
              <div key={r.id} className="border-b py-1.5">
                <div className="flex justify-between">
                  <span><span className="px-2 py-0.5 bg-gray-100 rounded">{r.event_type}</span> {r.phone || '—'}</span>
                  <span className="text-gray-500">{new Date(r.created_at).toLocaleString('he-IL')}</span>
                </div>
                {r.details && <div className="text-gray-500 truncate" dir="ltr">{JSON.stringify(r.details)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
