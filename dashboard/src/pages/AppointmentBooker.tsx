import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
// CommaInput: local-state input for comma-separated lists.
// Lets the user freely type commas/spaces without re-rendering from array.
function CommaInput({ value, onCommit, className, placeholder }: {
  value: string[];
  onCommit: (vals: string[]) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState((value || []).join(', '));
  // Sync only when external value changes AND we're not focused
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft((value || []).join(', '));
  }, [value, focused]);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = draft.split(',').map((s) => s.trim()).filter(Boolean);
        onCommit(parsed);
      }}
    />
  );
}



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

interface WaitingClient {
  id: number;
  phone: string;
  client_name?: string;
  vaccine_name?: string;
  status: string;
  created_at: string;
  notes?: string;
}

interface WaitingSummary {
  [vaccineName: string]: number;
}

const DAYS = [
  { key: 'sunday', label: 'ראשון' },
  { key: 'monday', label: 'שני' },
  { key: 'tuesday', label: 'שלישי' },
  { key: 'wednesday', label: 'רביעי' },
  { key: 'thursday', label: 'חמישי' },
  { key: 'friday', label: 'שישי' },
  { key: 'saturday', label: 'שבת' },
];

const MESSAGE_FIELDS: { key: string; label: string }[] = [
  { key: 'advisor_greeting', label: 'ברכת פתיחה' },
  { key: 'advisor_multi_clients', label: 'מספר לקוחות תחת טלפון' },
  { key: 'advisor_ask_alt_phone', label: 'בקשת טלפון חלופי' },
  { key: 'advisor_ask_name', label: 'בקשת שם' },
  { key: 'show_slots_template', label: 'תבנית הצגת סלוטים' },
  { key: 'ask_time_preference_text', label: 'שאלה: מתי נוח לבוא' },
  { key: 'no_slots_at_pref_msg', label: 'אין סלוטים בזמן המבוקש' },
  { key: 'confirm_template', label: 'תבנית אישור' },
  { key: 'success_template', label: 'תבנית הצלחה' },
  { key: 'slot_taken_msg', label: 'הודעה: סלוט נתפס' },
  { key: 'rate_limit_hit', label: 'הודעה: הגעת להגבלה' },
  { key: 'handoff_text', label: 'הודעה: העברה לצוות' },
  { key: 'decline_followup_text', label: 'שאלת המשך לסירוב' },
  { key: 'snoozed_confirmation', label: 'אישור snooze' },
  { key: 'callback_confirmation', label: 'אישור בקשת callback' },
];

const ALERT_FIELDS: { key: string; label: string }[] = [
  { key: 'alert_on_error', label: 'התראה על שגיאה' },
  { key: 'alert_on_handoff', label: 'התראה על העברה לצוות' },
  { key: 'alert_on_rate_limit', label: 'התראה על חריגת הגבלה' },
  { key: 'alert_on_new_client', label: 'התראה על לקוח חדש' },
];

export default function AppointmentBooker() {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [waitingList, setWaitingList] = useState<WaitingClient[]>([]);
  const [waitingSummary, setWaitingSummary] = useState<WaitingSummary>({});
  const [testPhone, setTestPhone] = useState('0543123419');
  const [testText, setTestText] = useState('היי');
  const [testResult, setTestResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [err, setErr] = useState('');
  const [llmStats, setLlmStats] = useState<any>(null);
  const [outboundQueue, setOutboundQueue] = useState<any[]>([]);
  const [outboundStats, setOutboundStats] = useState<any>(null);

  async function refresh() {
    try {
      const [s, r, a, wl, ws, ls, oq, os] = await Promise.all([
        apiFetch(`${API}/status`).then((x) => x.json()),
        apiFetch(`${API}/runs?limit=30`).then((x) => x.json()),
        apiFetch(`${API}/appointments?limit=20`).then((x) => x.json()),
        apiFetch(`${API}/waiting_list?status=waiting`).then((x) => x.ok ? x.json() : { clients: [] }).catch(() => ({ clients: [] })),
        apiFetch(`${API}/waiting_list/summary`).then((x) => x.ok ? x.json() : { summary: {} }).catch(() => ({ summary: {} })),
        apiFetch(`${API}/llm_stats`).then((x) => x.ok ? x.json() : null).catch(() => null),
        apiFetch(`${API}/outbound_queue?limit=50`).then((x) => x.ok ? x.json() : { queue: [] }).catch(() => ({ queue: [] })),
        apiFetch(`${API}/outbound_queue/stats`).then((x) => x.ok ? x.json() : null).catch(() => null),
      ]);
      setStatus(s);
      setRuns(r.runs || []);
      setAppts(a.appointments || []);
      setWaitingList(wl.clients || wl.waiting_list || []);
      setWaitingSummary(ws.summary || ws || {});
      setLlmStats(ls);
      setOutboundQueue(oq.queue || []);
      setOutboundStats(os);
      setErr('');
    } catch (e: any) {
      setErr('שגיאה בטעינה: ' + e.message);
    }
  }

  async function loadConfig() {
    try {
      const c = await apiFetch(`${API}/config`).then((x) => x.json());
      setConfig(c);
    } catch (e: any) {
      setErr('שגיאה בטעינת הגדרות: ' + e.message);
    }
  }

  useEffect(() => {
    refresh();
    loadConfig();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, []);

  async function toggleEnabled() {
    if (!status || !config) return;
    setBusy(true);
    try {
      const next = { ...config, enabled: !status.enabled };
      await apiFetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: next, updated_by: 'agents-dashboard' }),
      });
      setConfig(next);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: 'shadow' | 'dry_run' | 'live') {
    if (!config) return;
    setBusy(true);
    try {
      const next = { ...config, mode };
      await apiFetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: next, updated_by: 'agents-dashboard' }),
      });
      setConfig(next);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await apiFetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, updated_by: 'agents-dashboard' }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaveMsg('✅ נשמר בהצלחה');
      await refresh();
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e: any) {
      setSaveMsg('❌ שגיאה בשמירה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const r = await apiFetch(`${API}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone, text: testText }),
    });
    setTestResult(await r.json());
    refresh();
  }

  async function resetSession() {
    await apiFetch(`${API}/reset_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone }),
    });
    setTestResult(null);
    refresh();
  }

  async function notifyWaitingList(vaccineName: string) {
    if (!confirm(`לשלוח הודעה לכל הממתינים ל-${vaccineName}?`)) return;
    try {
      const r = await apiFetch(`${API}/waiting_list/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaccine_name: vaccineName }),
      });
      const j = await r.json();
      alert(`נשלח: ${j.sent || 0} / ${j.total || 0}`);
      await refresh();
    } catch (e: any) {
      alert('שגיאה: ' + e.message);
    }
  }

  // ===== setters for nested config =====
  function setField(key: string, value: any) {
    setConfig((c: any) => ({ ...c, [key]: value }));
  }

  function setProfileField(profile: string, field: string, value: any) {
    setConfig((c: any) => ({
      ...c,
      profiles: {
        ...c.profiles,
        [profile]: { ...c.profiles?.[profile], [field]: value },
      },
    }));
  }

  function setCategoryField(cat: string, field: string, value: any) {
    setConfig((c: any) => ({
      ...c,
      vaccine_categories: {
        ...c.vaccine_categories,
        [cat]: { ...c.vaccine_categories?.[cat], [field]: value },
      },
    }));
  }

  function setReminderRule(idx: number, field: string, value: any) {
    setConfig((c: any) => {
      const rules = [...(c.reminder_rules || [])];
      rules[idx] = { ...rules[idx], [field]: value };
      return { ...c, reminder_rules: rules };
    });
  }

  function addReminderRule() {
    setConfig((c: any) => ({
      ...c,
      reminder_rules: [
        ...(c.reminder_rules || []),
        { enabled: true, label: '', treatment_id: 0, keywords: [], days_before: 14, description: '', retry_enabled: false, retry_after_days: 7, max_retries: 1 },
      ],
    }));
  }

  function removeReminderRule(idx: number) {
    setConfig((c: any) => ({
      ...c,
      reminder_rules: (c.reminder_rules || []).filter((_: any, i: number) => i !== idx),
    }));
  }

  function setStockItem(idx: number, field: string, value: any) {
    setConfig((c: any) => {
      const items = [...(c.out_of_stock_items || [])];
      items[idx] = { ...items[idx], [field]: value };
      return { ...c, out_of_stock_items: items };
    });
  }

  function addStockItem() {
    setConfig((c: any) => ({
      ...c,
      out_of_stock_items: [
        ...(c.out_of_stock_items || []),
        { name: '', keywords: [], enabled: false, out_of_stock_message: '' },
      ],
    }));
  }

  function removeStockItem(idx: number) {
    setConfig((c: any) => ({
      ...c,
      out_of_stock_items: (c.out_of_stock_items || []).filter((_: any, i: number) => i !== idx),
    }));
  }

  function setDayField(day: string, field: string, value: any) {
    setConfig((c: any) => ({
      ...c,
      working_days: {
        ...c.working_days,
        [day]: { ...c.working_days?.[day], [field]: value },
      },
    }));
  }

  function setDayWindow(day: string, idx: number, field: 'start' | 'end', value: string) {
    setConfig((c: any) => {
      const d = c.working_days?.[day] || { enabled: false, windows: [] };
      const windows = [...(d.windows || [])];
      windows[idx] = { ...windows[idx], [field]: value };
      return {
        ...c,
        working_days: { ...c.working_days, [day]: { ...d, windows } },
      };
    });
  }

  function addDayWindow(day: string) {
    setConfig((c: any) => {
      const d = c.working_days?.[day] || { enabled: false, windows: [] };
      return {
        ...c,
        working_days: {
          ...c.working_days,
          [day]: { ...d, windows: [...(d.windows || []), { start: '09:00', end: '17:00' }] },
        },
      };
    });
  }

  function removeDayWindow(day: string, idx: number) {
    setConfig((c: any) => {
      const d = c.working_days?.[day] || { enabled: false, windows: [] };
      return {
        ...c,
        working_days: {
          ...c.working_days,
          [day]: { ...d, windows: (d.windows || []).filter((_: any, i: number) => i !== idx) },
        },
      };
    });
  }

  function parseList(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  if (err) return <div className="bg-red-50 text-red-700 p-4 rounded">{err}</div>;
  if (!status || !config) return <div className="text-center p-8">טוען...</div>;

  return (
    <div dir="rtl" className="space-y-4 pb-24">
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

      {/* AI hybrid mode */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🤖 שיחה חכמה (AI Hybrid)</h2>
        <div className="flex items-center justify-between">
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!config.llm_enabled}
                onChange={(e) => setField('llm_enabled', e.target.checked)}
                className="w-5 h-5"
              />
              <span className="font-medium">הפעל שיחה טבעית עם Claude</span>
            </label>
            <p className="text-xs text-gray-500 mt-1">
              לקוחות יכולים לכתוב חופשי בעברית — ה-AI יבין את הכוונה. כל קביעת תור עדיין עוברת בדיקת בטיחות.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600">סף ביטחון (0-1)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.llm_min_confidence ?? 0.6}
              onChange={(e) => setField('llm_min_confidence', parseFloat(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">Timeout (שניות)</label>
            <input
              type="number"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.llm_timeout_sec ?? 8}
              onChange={(e) => setField('llm_timeout_sec', parseInt(e.target.value) || 8)}
            />
          </div>
        </div>
        {llmStats && (
          <div className="border rounded-lg p-3 bg-blue-50 text-sm space-y-1">
            <div>קריאות: <strong>{llmStats.calls}</strong></div>
            <div>כשלים: <strong>{llmStats.failures}</strong></div>
            <div>זמן ממוצע: <strong>{llmStats.calls > 0 ? Math.round(llmStats.total_time_ms / llmStats.calls) : 0}ms</strong></div>
            {llmStats.last_error && <div className="text-red-600 text-xs">שגיאה אחרונה: {llmStats.last_error}</div>}
          </div>
        )}
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

      {/* 1. Treatment profiles */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🐾 פרופילי טיפולים</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {['vaccine', 'checkup', 'surgery'].map((p) => {
            const prof = config.profiles?.[p] || {};
            return (
              <div key={p} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold">{prof.name || p}</div>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!prof.enabled}
                      onChange={(e) => setProfileField(p, 'enabled', e.target.checked)}
                      className="w-5 h-5"
                    />
                    <span className="text-xs">פעיל</span>
                  </label>
                </div>
                <label className="text-xs text-gray-600">Calendar ID</label>
                <input
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.calendar_id || ''}
                  onChange={(e) => setProfileField(p, 'calendar_id', e.target.value)}
                />
                <label className="text-xs text-gray-600">Treatment ID</label>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.treatment_id || 0}
                  onChange={(e) => setProfileField(p, 'treatment_id', parseInt(e.target.value) || 0)}
                />
                <label className="text-xs text-gray-600">משך (דקות)</label>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.duration_min || 0}
                  onChange={(e) => setProfileField(p, 'duration_min', parseInt(e.target.value) || 0)}
                />
                <label className="text-xs text-gray-600">סף בעלי חיים לסלוט כפול</label>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.double_slot_threshold_pets || 0}
                  onChange={(e) => setProfileField(p, 'double_slot_threshold_pets', parseInt(e.target.value) || 0)}
                />
                <label className="text-xs text-gray-600">משך סלוט כפול (דקות)</label>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.double_slot_duration_min || 0}
                  onChange={(e) => setProfileField(p, 'double_slot_duration_min', parseInt(e.target.value) || 0)}
                />
                <label className="text-xs text-gray-600">מילות מפתח (מופרד בפסיק)</label>
                <CommaInput
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={prof.keywords || []}
                  onCommit={(vals) => setProfileField(p, 'keywords', vals)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Vaccine categories */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">💉 קטגוריות חיסונים</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm">משך ברירת מחדל (דקות):</label>
          <input
            type="number"
            className="px-3 py-2 border rounded-lg w-24"
            value={config.vaccine_default_duration_min || 0}
            onChange={(e) => setField('vaccine_default_duration_min', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          {['no_appointment', 'short', 'long'].map((cat) => {
            const c = config.vaccine_categories?.[cat] || {};
            const labels: any = { no_appointment: 'ללא תור', short: 'קצר', long: 'ארוך' };
            return (
              <div key={cat} className="border rounded-lg p-3 space-y-2">
                <div className="font-bold">{labels[cat]}</div>
                <label className="text-xs text-gray-600">משך (דקות)</label>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={c.duration_min || 0}
                  onChange={(e) => setCategoryField(cat, 'duration_min', parseInt(e.target.value) || 0)}
                />
                <label className="text-xs text-gray-600">מילות מפתח (מופרד בפסיק)</label>
                <CommaInput
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={c.keywords || []}
                  onCommit={(vals) => setCategoryField(cat, 'keywords', vals)}
                />
                <label className="text-xs text-gray-600">תיאור</label>
                <input
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  value={c.description || ''}
                  onChange={(e) => setCategoryField(cat, 'description', e.target.value)}
                />
                <label className="text-xs text-gray-600">הודעה</label>
                <textarea
                  className="px-3 py-2 border rounded-lg w-full text-sm"
                  rows={3}
                  value={c.message || ''}
                  onChange={(e) => setCategoryField(cat, 'message', e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Reminder rules */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">📅 תזכורות חיסונים</h2>
          <button
            onClick={addReminderRule}
            className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200"
          >
            ➕ הוסף תזכורת
          </button>
        </div>
        <div className="space-y-3">
          {(config.reminder_rules || []).map((rule: any, idx: number) => (
            <div key={idx} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!rule.enabled}
                    onChange={(e) => setReminderRule(idx, 'enabled', e.target.checked)}
                    className="w-5 h-5"
                  />
                  <span>פעיל</span>
                </label>
                <button
                  onClick={() => removeReminderRule(idx)}
                  className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                >
                  🗑️ הסר
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-600">תווית</label>
                  <input
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.label || ''}
                    onChange={(e) => setReminderRule(idx, 'label', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Treatment ID</label>
                  <input
                    type="number"
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.treatment_id || 0}
                    onChange={(e) => setReminderRule(idx, 'treatment_id', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">ימים מראש</label>
                  <input
                    type="number"
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.days_before || 0}
                    onChange={(e) => setReminderRule(idx, 'days_before', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">תיאור</label>
                  <input
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.description || ''}
                    onChange={(e) => setReminderRule(idx, 'description', e.target.value)}
                  />
                </div>
              </div>
              <label className="text-xs text-gray-600">מילות מפתח (מופרד בפסיק)</label>
              <CommaInput
                className="px-3 py-2 border rounded-lg w-full text-sm"
                value={rule.keywords || []}
                onCommit={(vals) => setReminderRule(idx, 'keywords', vals)}
              />
              <div className="grid grid-cols-3 gap-2 items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!rule.retry_enabled}
                    onChange={(e) => setReminderRule(idx, 'retry_enabled', e.target.checked)}
                    className="w-5 h-5"
                  />
                  <span className="text-xs">retry פעיל</span>
                </label>
                <div>
                  <label className="text-xs text-gray-600">retry אחרי ימים</label>
                  <input
                    type="number"
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.retry_after_days || 0}
                    onChange={(e) => setReminderRule(idx, 'retry_after_days', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">max retries</label>
                  <input
                    type="number"
                    className="px-3 py-2 border rounded-lg w-full text-sm"
                    value={rule.max_retries || 0}
                    onChange={(e) => setReminderRule(idx, 'max_retries', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
          ))}
          {(!config.reminder_rules || config.reminder_rules.length === 0) && (
            <div className="text-sm text-gray-500">אין תזכורות מוגדרות</div>
          )}
        </div>
      </div>

      {/* 4. Out of stock items */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">📦 פריטים חסרים במלאי</h2>
          <button
            onClick={addStockItem}
            className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200"
          >
            ➕ הוסף פריט
          </button>
        </div>
        <div>
          <label className="text-xs text-gray-600">הודעת ברירת מחדל (חסר במלאי)</label>
          <textarea
            className="px-3 py-2 border rounded-lg w-full text-sm"
            rows={2}
            value={config.out_of_stock_default_message || ''}
            onChange={(e) => setField('out_of_stock_default_message', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-600">הודעה: חזר למלאי</label>
          <textarea
            className="px-3 py-2 border rounded-lg w-full text-sm"
            rows={2}
            value={config.out_of_stock_back_in_stock_message || ''}
            onChange={(e) => setField('out_of_stock_back_in_stock_message', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          {(config.out_of_stock_items || []).map((item: any, idx: number) => (
            <div key={idx} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!item.enabled}
                    onChange={(e) => setStockItem(idx, 'enabled', e.target.checked)}
                    className="w-5 h-5"
                  />
                  <span>חסר במלאי</span>
                </label>
                <button
                  onClick={() => removeStockItem(idx)}
                  className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                >
                  🗑️ הסר
                </button>
              </div>
              <label className="text-xs text-gray-600">שם פריט</label>
              <input
                className="px-3 py-2 border rounded-lg w-full text-sm"
                value={item.name || ''}
                onChange={(e) => setStockItem(idx, 'name', e.target.value)}
              />
              <label className="text-xs text-gray-600">מילות מפתח (מופרד בפסיק)</label>
              <CommaInput
                className="px-3 py-2 border rounded-lg w-full text-sm"
                value={item.keywords || []}
                onCommit={(vals) => setStockItem(idx, 'keywords', vals)}
              />
              <label className="text-xs text-gray-600">הודעה מותאמת (אופציונלי)</label>
              <textarea
                className="px-3 py-2 border rounded-lg w-full text-sm"
                rows={2}
                value={item.out_of_stock_message || ''}
                onChange={(e) => setStockItem(idx, 'out_of_stock_message', e.target.value)}
              />
            </div>
          ))}
          {(!config.out_of_stock_items || config.out_of_stock_items.length === 0) && (
            <div className="text-sm text-gray-500">אין פריטים מוגדרים</div>
          )}
        </div>
      </div>

      {/* 5. Working hours */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🕐 שעות עבודה</h2>
        <div className="space-y-2">
          {DAYS.map((d) => {
            const day = config.working_days?.[d.key] || { enabled: false, windows: [] };
            return (
              <div key={d.key} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!day.enabled}
                      onChange={(e) => setDayField(d.key, 'enabled', e.target.checked)}
                      className="w-5 h-5"
                    />
                    <span className="font-bold">{d.label}</span>
                  </label>
                  <button
                    onClick={() => addDayWindow(d.key)}
                    className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                  >
                    ➕ חלון
                  </button>
                </div>
                {(day.windows || []).map((w: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      className="px-3 py-2 border rounded-lg text-sm"
                      value={w.start || ''}
                      onChange={(e) => setDayWindow(d.key, i, 'start', e.target.value)}
                    />
                    <span>-</span>
                    <input
                      type="time"
                      className="px-3 py-2 border rounded-lg text-sm"
                      value={w.end || ''}
                      onChange={(e) => setDayWindow(d.key, i, 'end', e.target.value)}
                    />
                    <button
                      onClick={() => removeDayWindow(d.key, i)}
                      className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="border rounded-lg p-3 space-y-2">
          <div className="font-bold text-sm">ערב חג</div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              className="px-3 py-2 border rounded-lg text-sm"
              value={config.erev_chag_hours?.start || ''}
              onChange={(e) => setField('erev_chag_hours', { ...(config.erev_chag_hours || {}), start: e.target.value })}
            />
            <span>-</span>
            <input
              type="time"
              className="px-3 py-2 border rounded-lg text-sm"
              value={config.erev_chag_hours?.end || ''}
              onChange={(e) => setField('erev_chag_hours', { ...(config.erev_chag_hours || {}), end: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.holidays_closed_only_yom_tov}
              onChange={(e) => setField('holidays_closed_only_yom_tov', e.target.checked)}
              className="w-5 h-5"
            />
            <span className="text-sm">סגור רק ביום טוב (חגים)</span>
          </label>
        </div>
      </div>

      {/* 6. Hebrew messages */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">💬 הודעות בעברית</h2>
        <div className="space-y-2">
          {MESSAGE_FIELDS.map((m) => (
            <div key={m.key}>
              <label className="text-xs text-gray-600">{m.label}</label>
              <textarea
                className="px-3 py-2 border rounded-lg w-full text-sm"
                rows={2}
                value={config[m.key] || ''}
                onChange={(e) => setField(m.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 7. Client identification */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🔍 זיהוי לקוח</h2>
        <div>
          <label className="text-xs text-gray-600">מקסימום ניסיונות טלפון</label>
          <input
            type="number"
            className="px-3 py-2 border rounded-lg w-full text-sm"
            value={config.identify_max_phone_attempts || 0}
            onChange={(e) => setField('identify_max_phone_attempts', parseInt(e.target.value) || 0)}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.identify_fallback_to_name_search}
            onChange={(e) => setField('identify_fallback_to_name_search', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">חיפוש לפי שם כגיבוי</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.identify_update_profile_on_mismatch}
            onChange={(e) => setField('identify_update_profile_on_mismatch', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">עדכן פרופיל באי-התאמה</span>
        </label>
      </div>

      {/* 8. Safety */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🛡️ בטיחות</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.advisory_lock}
            onChange={(e) => setField('advisory_lock', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">Advisory lock</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.double_check_after_lock}
            onChange={(e) => setField('double_check_after_lock', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">בדיקה כפולה אחרי lock</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.require_team_approval_for_new_clients}
            onChange={(e) => setField('require_team_approval_for_new_clients', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">דרוש אישור צוות ללקוח חדש</span>
        </label>
        <div>
          <label className="text-xs text-gray-600">Timeout אישור צוות (דקות)</label>
          <input
            type="number"
            className="px-3 py-2 border rounded-lg w-full text-sm"
            value={config.team_approval_timeout_min || 0}
            onChange={(e) => setField('team_approval_timeout_min', parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* 9. Limits */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🚦 הגבלות</h2>
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-600">ימים קדימה</label>
            <input
              type="number"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.days_ahead || 0}
              onChange={(e) => setField('days_ahead', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">מקסימום סלוטים מוצגים</label>
            <input
              type="number"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.max_slots_shown || 0}
              onChange={(e) => setField('max_slots_shown', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">TTL סשן (דקות)</label>
            <input
              type="number"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.session_ttl_min || 0}
              onChange={(e) => setField('session_ttl_min', parseInt(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">סף חסימה</label>
            <input
              type="number"
              className="px-3 py-2 border rounded-lg w-full text-sm"
              value={config.block_threshold || 0}
              onChange={(e) => setField('block_threshold', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.rate_limit_enabled}
            onChange={(e) => setField('rate_limit_enabled', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">הגבלת קצב פעילה</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.outbound_enabled}
            onChange={(e) => setField('outbound_enabled', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">שליחה יזומה פעילה</span>
        </label>
        <div>
          <label className="text-xs text-gray-600">Outbound cron</label>
          <input
            className="px-3 py-2 border rounded-lg w-full text-sm font-mono"
            value={config.outbound_cron || ''}
            onChange={(e) => setField('outbound_cron', e.target.value)}
          />
        </div>
      </div>

      {/* 10. Test mode */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🧪 מצב בדיקה</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.test_mode_use_staff_clients}
            onChange={(e) => setField('test_mode_use_staff_clients', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">השתמש בלקוחות צוות לבדיקות</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config.test_mode_outside_work_hours}
            onChange={(e) => setField('test_mode_outside_work_hours', e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm">אפשר בדיקות מחוץ לשעות עבודה</span>
        </label>
        <div>
          <label className="text-xs text-gray-600">טלפונים מותרים לבדיקה (מופרד בפסיק)</label>
          <CommaInput
            className="px-3 py-2 border rounded-lg w-full text-sm"
            value={config.allowed_test_phones || []}
            onCommit={(vals) => setField('allowed_test_phones', vals)}
          />
        </div>
      </div>

      {/* 11. Team alerts */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">🔔 התראות צוות</h2>
        <div>
          <label className="text-xs text-gray-600">טלפון להתראות</label>
          <input
            className="px-3 py-2 border rounded-lg w-full text-sm"
            value={config.team_alert_phone || ''}
            onChange={(e) => setField('team_alert_phone', e.target.value)}
          />
        </div>
        {ALERT_FIELDS.map((a) => (
          <label key={a.key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!config[a.key]}
              onChange={(e) => setField(a.key, e.target.checked)}
              className="w-5 h-5"
            />
            <span className="text-sm">{a.label}</span>
          </label>
        ))}
      </div>

      {/* 12. Waiting list */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">⏳ רשימת המתנה</h2>
        {Object.keys(waitingSummary).length === 0 ? (
          <div className="text-sm text-gray-500">אין ממתינים כרגע</div>
        ) : (
          <div className="space-y-2">
            <div className="font-bold text-sm">סיכום לפי חיסון</div>
            {Object.entries(waitingSummary).map(([vaccine, count]) => (
              <div key={vaccine} className="flex items-center justify-between border rounded-lg p-2">
                <div>
                  <span className="font-bold">{vaccine}</span>
                  <span className="text-gray-500 text-sm"> · {count as number} ממתינים</span>
                </div>
                <button
                  onClick={() => notifyWaitingList(vaccine)}
                  className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                >
                  📤 שלח לכולם
                </button>
              </div>
            ))}
          </div>
        )}
        {waitingList.length > 0 && (
          <div className="space-y-1 mt-3">
            <div className="font-bold text-sm">לקוחות ממתינים</div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {waitingList.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b py-1.5 text-sm">
                  <div>
                    <span className="font-bold">{c.client_name || '—'}</span>
                    <span className="text-gray-500"> · {c.phone}</span>
                    {c.vaccine_name && (
                      <span className="mr-2 px-2 py-0.5 bg-gray-100 rounded text-xs">{c.vaccine_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(c.created_at).toLocaleString('he-IL')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* Outbound queue (vaccine reminders pipeline) */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
        <h2 className="font-bold">📤 קיו תזכורות חיסונים פעיל</h2>
        {outboundStats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <div className="border rounded-lg p-2 text-center">
              <div className="text-2xl font-bold">{outboundStats.total || 0}</div>
              <div className="text-xs text-gray-500">סה"כ (60 יום)</div>
            </div>
            <div className="border rounded-lg p-2 text-center bg-blue-50">
              <div className="text-2xl font-bold">{outboundStats.summary?.sent || 0}</div>
              <div className="text-xs text-gray-500">נשלח</div>
            </div>
            <div className="border rounded-lg p-2 text-center bg-yellow-50">
              <div className="text-2xl font-bold">{outboundStats.summary?.snoozed || 0}</div>
              <div className="text-xs text-gray-500">snoozed</div>
            </div>
            <div className="border rounded-lg p-2 text-center bg-green-50">
              <div className="text-2xl font-bold">{outboundStats.summary?.booked || 0}</div>
              <div className="text-xs text-gray-500">נקבע</div>
            </div>
            <div className="border rounded-lg p-2 text-center bg-purple-50">
              <div className="text-2xl font-bold">{outboundStats.conversion_rate || 0}%</div>
              <div className="text-xs text-gray-500">המרה</div>
            </div>
          </div>
        )}
        <div className="space-y-1 max-h-96 overflow-y-auto text-xs">
          {outboundQueue.length === 0 ? (
            <div className="text-gray-500">אין רשומות בקיו</div>
          ) : (
            outboundQueue.map((q: any) => {
              const statusColors: any = {
                sent: 'bg-blue-100 text-blue-700',
                sent_again: 'bg-blue-100 text-blue-700',
                snoozed: 'bg-yellow-100 text-yellow-700',
                booked: 'bg-green-100 text-green-700',
                needs_callback: 'bg-purple-100 text-purple-700',
                replied: 'bg-gray-100 text-gray-700',
                declined_final: 'bg-red-100 text-red-700',
              };
              return (
                <div key={q.id} className="border-b py-1 flex justify-between">
                  <span>
                    <span className={`px-2 py-0.5 rounded ${statusColors[q.status] || 'bg-gray-100'}`}>{q.status}</span>{' '}
                    {q.pet_name} · <strong>{q.vaccine_name || q.item_type}</strong>{' '}
                    {q.vaccine_category && <span className="text-gray-400">[{q.vaccine_category}]</span>}{' '}
                    {q.snooze_count > 0 && <span className="text-yellow-600">snooze×{q.snooze_count}</span>}
                  </span>
                  <span className="text-gray-500">{q.phone}</span>
                </div>
              );
            })
          )}
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

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 flex items-center justify-between z-50" dir="rtl">
        <div className="text-sm text-gray-600">{saveMsg || 'עריכת הגדרות סוכן קביעת תורים'}</div>
        <button
          onClick={saveConfig}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-400"
        >
          {saving ? '⏳ שומר...' : '💾 שמור הגדרות'}
        </button>
      </div>
    </div>
  );
}
