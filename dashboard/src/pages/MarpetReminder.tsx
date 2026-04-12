import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  config: any;
}

const TRIGGER_MODE_OPTIONS = [
  { value: 1, label: 'זכאי עכשיו בלבד', desc: 'שלח רק כאשר מרפט מציין "זכאי"' },
  { value: 2, label: 'X ימים לפני', desc: 'שלח X ימים לפני תאריך הזכאות' },
  { value: 3, label: 'שניהם', desc: 'זכאי עכשיו + X ימים לפני' },
  { value: 4, label: 'מדורג', desc: '14 יום לפני + תזכורת 7 יום אח"כ' },
];

const APPROVAL_OPTIONS = [
  { value: 'manual', label: 'ידני — כל הודעה דורשת אישור', icon: '🔒' },
  { value: 'auto', label: 'אוטומטי — שלח ישירות', icon: '🚀' },
  { value: 'batch-whatsapp-to-gil', label: 'באץ — שלח לגיל ב-WhatsApp', icon: '📱' },
];

export default function MarpetReminder() {
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [config, setConfig] = useState({
    triggerMode: 1,
    daysBeforeEligible: 14,
    cooldownDays: 30,
    maxPerOwnerPerMonth: 2,
    approvalMode: 'manual',
    messageTemplate: '',
  });
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState('');
  const [stats, setStats] = useState({ pending: 0, sent: 0, rejected: 0 });

  useEffect(() => {
    loadAgent();
  }, []);

  async function loadAgent() {
    const { data } = await supabase.from('agents').select('*').eq('name', 'marpet-reminder').single();
    if (data) {
      setAgent(data);
      const c = data.config || {};
      setConfig(prev => ({
        ...prev,
        triggerMode: c.triggerMode ?? prev.triggerMode,
        daysBeforeEligible: c.daysBeforeEligible ?? prev.daysBeforeEligible,
        cooldownDays: c.cooldownDays ?? prev.cooldownDays,
        maxPerOwnerPerMonth: c.maxPerOwnerPerMonth ?? prev.maxPerOwnerPerMonth,
        approvalMode: c.approvalMode ?? prev.approvalMode,
        messageTemplate: c.messageTemplate ?? prev.messageTemplate,
      }));

      // Load stats
      const today = new Date().toISOString().split('T')[0];
      const [pending, sent, rejected] = await Promise.all([
        supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', data.id).eq('status', 'pending'),
        supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', data.id).eq('status', 'sent').gte('created_at', today),
        supabase.from('pending_messages').select('id', { count: 'exact', head: true }).eq('agent_id', data.id).eq('status', 'rejected').gte('created_at', today),
      ]);
      setStats({ pending: pending.count || 0, sent: sent.count || 0, rejected: rejected.count || 0 });
    }
  }

  async function saveConfig() {
    if (!agent) return;
    await supabase.from('agents').update({ config }).eq('id', agent.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function toggleAgent() {
    if (!agent) return;
    await supabase.from('agents').update({ is_active: !agent.is_active }).eq('id', agent.id);
    loadAgent();
  }

  async function runAgent(dryRun = true) {
    setRunning(true);
    setRunLog(dryRun ? 'מריץ dry run...' : 'מריץ סוכן...');
    try {
      const API_BASE = `http://${window.location.hostname}:3002`;
      const res = await apiFetch(`${API_BASE}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'marpet-reminder', dryRun }),
      });
      if (res.ok) {
        const data = await res.json();
        setRunLog(data.output || 'הסוכן רץ בהצלחה');
      } else {
        setRunLog('שגיאה בהרצה — בדוק לוגים בשרת');
      }
    } catch (e) {
      setRunLog('לא ניתן להתחבר ל-API. הרץ ידנית דרך SSH:\nbun run marpet-reminder/src/index.ts --dry-run');
    }
    setRunning(false);
  }

  return (
    <div dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h1 className="text-2xl font-bold">💉 מרפט רמיינדר</h1>
        {agent && (
          <button
            onClick={toggleAgent}
            className={`mr-auto px-4 py-1.5 rounded-full text-sm font-medium ${
              agent.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {agent.is_active ? 'פעיל' : 'כבוי'}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center cursor-pointer hover:bg-amber-100 transition"
          onClick={() => agent && navigate(`/queue/${agent.id}`)}>
          <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          <div className="text-sm text-amber-700">ממתינות לאישור</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{stats.sent}</div>
          <div className="text-sm text-emerald-700">נשלחו היום</div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-500">{stats.rejected}</div>
          <div className="text-sm text-red-600">נדחו היום</div>
        </div>
      </div>

      {/* Run buttons */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-6">
        <h2 className="font-bold text-lg mb-4">הרצה</h2>
        <div className="flex gap-3">
          <button
            onClick={() => runAgent(true)}
            disabled={running}
            className="px-5 py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-medium hover:bg-blue-100 disabled:opacity-50"
          >
            {running ? 'רץ...' : '🔍 Dry Run'}
          </button>
          <button
            onClick={() => {
              if (confirm('להריץ את הסוכן באמת? הודעות יוכנסו לתור האישור.')) runAgent(false);
            }}
            disabled={running || !agent?.is_active}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {running ? 'רץ...' : '🚀 הרץ עכשיו'}
          </button>
          {agent && (
            <button
              onClick={() => navigate(`/queue/${agent.id}`)}
              className="px-5 py-2.5 border rounded-lg font-medium hover:bg-gray-50"
            >
              📬 תור אישור ({stats.pending})
            </button>
          )}
        </div>
        {runLog && (
          <pre className="mt-4 bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-auto max-h-64 font-mono" dir="ltr">
            {runLog}
          </pre>
        )}
        <p className="text-xs text-gray-400 mt-3">
          ניתן להריץ גם דרך SSH: <code className="bg-gray-100 px-1 rounded">bun run marpet-reminder/src/index.ts --dry-run</code>
        </p>
      </div>

      {/* Config */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-6">
        <h2 className="font-bold text-lg mb-4">הגדרות</h2>

        {/* Trigger mode */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">מצב הפעלה</label>
          <div className="space-y-2">
            {TRIGGER_MODE_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="triggerMode"
                  value={opt.value}
                  checked={config.triggerMode === opt.value}
                  onChange={() => setConfig(prev => ({ ...prev, triggerMode: opt.value as any }))}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Days before */}
        {config.triggerMode >= 2 && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ימים לפני תאריך הזכאות: <strong>{config.daysBeforeEligible}</strong>
            </label>
            <input
              type="range" min={1} max={30} value={config.daysBeforeEligible}
              onChange={e => setConfig(prev => ({ ...prev, daysBeforeEligible: parseInt(e.target.value) }))}
              className="w-full"
            />
          </div>
        )}

        {/* Cooldown */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            קולדאון לחיסון (ימים): <strong>{config.cooldownDays}</strong>
          </label>
          <input
            type="range" min={7} max={90} value={config.cooldownDays}
            onChange={e => setConfig(prev => ({ ...prev, cooldownDays: parseInt(e.target.value) }))}
            className="w-full"
          />
          <p className="text-xs text-gray-400 mt-1">לא ישלח תזכורת על אותו חיסון לאותה חיה לפני שיעברו {config.cooldownDays} ימים</p>
        </div>

        {/* Monthly cap */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            מקסימום הודעות לבעלים לחודש: <strong>{config.maxPerOwnerPerMonth}</strong>
          </label>
          <input
            type="range" min={1} max={10} value={config.maxPerOwnerPerMonth}
            onChange={e => setConfig(prev => ({ ...prev, maxPerOwnerPerMonth: parseInt(e.target.value) }))}
            className="w-full"
          />
        </div>

        {/* Approval mode */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">מצב אישור</label>
          <div className="space-y-2">
            {APPROVAL_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="approvalMode"
                  value={opt.value}
                  checked={config.approvalMode === opt.value}
                  onChange={() => setConfig(prev => ({ ...prev, approvalMode: opt.value as any }))}
                />
                <span className="text-lg">{opt.icon}</span>
                <span className="text-sm font-medium">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Message template */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">תבנית הודעה</label>
          <p className="text-xs text-gray-400 mb-2">
            משתנים: <code>{'{שם_בעלים}'}</code>, <code>{'{שם_חיה}'}</code>, <code>{'{רשימת_חיסונים_זכאים}'}</code>, <code>{'{מספר_מרפאה}'}</code>
          </p>
          <textarea
            value={config.messageTemplate}
            onChange={e => setConfig(prev => ({ ...prev, messageTemplate: e.target.value }))}
            placeholder="השאר ריק לשימוש בתבנית ברירת המחדל (default.txt)"
            className="w-full border rounded-lg p-3 text-sm min-h-[140px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
            dir="rtl"
          />
        </div>

        <button
          onClick={saveConfig}
          className={`px-6 py-2.5 rounded-lg text-sm font-medium transition ${
            saved ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          {saved ? '✅ נשמר!' : 'שמור הגדרות'}
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
        <strong>מידע:</strong> הסוכן שולף לקוחות מ-ClinicaOnline, מוצא את ת"ז הבעלים,
        מבצע שאילתה לפורטל מרפט ומוצא חיסונים שמגיעים לחיות ביטוח.
        כל ההודעות מוכנסות לתור אישור ידני עד שמשנים את מצב האישור.
      </div>
    </div>
  );
}
