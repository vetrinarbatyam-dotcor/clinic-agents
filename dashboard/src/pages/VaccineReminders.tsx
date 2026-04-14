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

interface StageConfig {
  stage: number;
  enabled: boolean;
  triggerDaysOverdue: number;
  name: string;
  description: string;
}

interface VaccineConfig {
  stages: StageConfig[];
  toleranceDays: number;
  maxPerDay: number;
  autoApprove: boolean;
  useAI: boolean;
  notifyGil: boolean;
  templates: Record<string, string>;
}

const STAGE_INFO: Record<number, { name: string; icon: string; color: string; desc: string }> = {
  1: { name: 'pre-reminder', icon: '📅', color: 'blue', desc: 'week before due date' },
  2: { name: 'second reminder', icon: '⏰', color: 'amber', desc: '3 days after expiry (no show, no appointment)' },
  3: { name: 'third reminder', icon: '⚠️', color: 'orange', desc: '10 days after expiry' },
  4: { name: 'final reminder', icon: '🔴', color: 'red', desc: '25 days after expiry' },
};

const TEMPLATE_VARS = ['ownerName', 'petName', 'vaccineName', 'vaccineList', 'dueDate', 'stage', 'stageName'];
const EXAMPLE_VALUES: Record<string, string> = {
  ownerName: 'yossi cohen',
  petName: 'rexy',
  vaccineName: 'hexavalent',
  vaccineList: '• hexavalent\n• rabies',
  dueDate: 'sunday 1 april 2026',
  stage: '1',
  stageName: 'pre-reminder',
};

function fillPreview(content: string): string {
  let result = content;
  for (const v of TEMPLATE_VARS) {
    const val = EXAMPLE_VALUES[v] || `[${v}]`;
    result = result.replace(new RegExp(`\\{${v}\\}`, 'g'), val);
  }
  return result;
}

export default function VaccineReminders() {
  const [reminders, setReminders] = useState<VaccineReminder[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, sent: 0, rejected: 0, skipped: 0, approved: 0, byStage: {}, byVaccine: {} });
  const [tab, setTab] = useState<'overview' | 'pending' | 'history' | 'settings' | 'logic'>('overview');
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Settings state
  const [config, setConfig] = useState<VaccineConfig | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configToast, setConfigToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [editingStage, setEditingStage] = useState<number>(1);
  const [templateText, setTemplateText] = useState<string>('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [statsRes, remindersRes, configRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/stats`),
        apiFetch(`${API_BASE}/api/reminders?limit=500`),
        apiFetch(`${API_BASE}/api/config`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (remindersRes.ok) setReminders(await remindersRes.json());
      if (configRes.ok) {
        const data = await configRes.json();
        setConfig(data.config);
        if (data.config?.templates?.['1']) {
          setTemplateText(data.config.templates['1']);
        }
      }
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

  function updateConfig(key: string, value: any) {
    if (!config) return;
    setConfig({ ...config, [key]: value });
    setConfigDirty(true);
  }

  function updateStageConfig(stageNum: number, key: string, value: any) {
    if (!config) return;
    const newStages = config.stages.map(s =>
      s.stage === stageNum ? { ...s, [key]: value } : s
    );
    setConfig({ ...config, stages: newStages });
    setConfigDirty(true);
  }

  function updateTemplate(stageNum: number, content: string) {
    if (!config) return;
    setConfig({
      ...config,
      templates: { ...config.templates, [String(stageNum)]: content },
    });
    setTemplateText(content);
    setConfigDirty(true);
  }

  async function saveConfig() {
    if (!config) return;
    setSavingConfig(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      if (res.ok) {
        setConfigToast({ msg: 'saved!', type: 'ok' });
        setConfigDirty(false);
      } else {
        const err = await res.json().catch(() => ({}));
        setConfigToast({ msg: err.error || 'save error', type: 'err' });
      }
    } catch {
      setConfigToast({ msg: 'network error', type: 'err' });
    }
    setSavingConfig(false);
    setTimeout(() => setConfigToast(null), 3000);
  }

  if (loading) return <div className="text-center py-20 text-gray-400">loading vaccine data...</div>;

  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const filteredReminders = filter === 'all' ? reminders : reminders.filter(r => r.status === filter);

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-xl">&larr;</Link>
          <h1 className="text-2xl font-bold">&#x1F489; vaccine reminders</h1>
        </div>
        <AgentStackPanel agentName={'vaccine-reminders'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {([
          { key: 'overview', label: 'overview', icon: '&#x1F4CA;' },
          { key: 'pending', label: `pending (${stats.pending})`, icon: '&#x23F3;' },
          { key: 'history', label: 'history', icon: '&#x1F4CB;' },
          { key: 'settings', label: 'settings', icon: '&#x2699;&#xFE0F;' },
          { key: 'logic', label: 'logic', icon: '&#x1F9E0;' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              if (t.key === 'settings' && config?.templates) {
                setTemplateText(config.templates[String(editingStage)] || '');
              }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span dangerouslySetInnerHTML={{ __html: t.icon }} /> {t.label}
          </button>
        ))}
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-5">
            {[
              { val: stats.pending, label: 'pending', color: 'text-amber-500', icon: '⏳' },
              { val: stats.approved, label: 'approved', color: 'text-blue-500', icon: '✔️' },
              { val: stats.sent, label: 'sent', color: 'text-emerald-500', icon: '✅' },
              { val: stats.rejected, label: 'rejected', color: 'text-red-400', icon: '❌' },
              { val: stats.skipped, label: 'skipped', color: 'text-gray-400', icon: '⏭️' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border shadow-sm p-5 text-center">
                <div className={`text-3xl font-bold ${s.color}`}>{s.val}</div>
                <div className="text-sm text-gray-500 mt-1">{s.icon} {s.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">stage distribution</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map(stageNum => {
                const info = STAGE_INFO[stageNum];
                const count = stats.byStage[stageNum] || 0;
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={stageNum} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">{info.icon}</span>
                      <span className="font-medium text-sm">{config?.stages?.[stageNum - 1]?.name || info.name}</span>
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

          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">💉 by vaccine type</h2>
            <div className="space-y-2">
              {Object.entries(stats.byVaccine).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => (
                <div key={name} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{count}</span>
                </div>
              ))}
              {Object.keys(stats.byVaccine).length === 0 && (
                <div className="text-center text-gray-400 py-4">no data yet</div>
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
              <span className="text-sm text-gray-500">{pendingReminders.length} pending reminders</span>
              <button onClick={approveAll} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">
                ✅ approve all ({pendingReminders.length})
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
                    <div className="text-sm text-gray-600">🐾 {r.pet_name} — {r.vaccine_name}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {config?.stages?.[r.stage - 1]?.name || info.name} | due: {r.due_date}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => approveReminder(r.id)} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-200">
                      ✅ approve
                    </button>
                    <button onClick={() => rejectReminder(r.id)} className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-sm font-medium hover:bg-red-200">
                      ❌ reject
                    </button>
                  </div>
                </div>
                <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-xs text-emerald-600 hover:text-emerald-700">
                  {expandedId === r.id ? 'hide message' : 'show message'}
                </button>
                {expandedId === r.id && (
                  <div className="mt-3 bg-gray-50 rounded-lg p-4 text-sm whitespace-pre-wrap" dir="rtl">{r.message_text}</div>
                )}
              </div>
            );
          })}

          {pendingReminders.length === 0 && (
            <div className="text-center text-gray-400 py-20">
              <div className="text-4xl mb-2">✅</div>
              no pending reminders
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
                {f === 'all' ? 'all' : f === 'pending' ? '⏳ pending' : f === 'approved' ? '✔️ approved' :
                 f === 'sent' ? '✅ sent' : f === 'rejected' ? '❌ rejected' : '⏭️ skipped'}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-right p-3">date</th>
                  <th className="text-right p-3">owner</th>
                  <th className="text-right p-3">pet</th>
                  <th className="text-right p-3">vaccine</th>
                  <th className="text-right p-3">stage</th>
                  <th className="text-right p-3">status</th>
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
                    pending: 'pending', approved: 'approved', sent: 'sent', rejected: 'rejected', skipped: 'skipped',
                  };
                  return (
                    <tr key={r.id} className="border-t hover:bg-gray-50">
                      <td className="p-3 text-gray-500">{new Date(r.created_at).toLocaleDateString('he-IL')}</td>
                      <td className="p-3 font-medium">{r.owner_name}</td>
                      <td className="p-3">{r.pet_name}</td>
                      <td className="p-3">{r.vaccine_name}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-1">{info.icon} <span className="text-xs">{r.stage}</span></span>
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
            {filteredReminders.length === 0 && <div className="text-center text-gray-400 py-10">no data</div>}
            {filteredReminders.length > 50 && (
              <div className="text-center text-gray-400 text-xs py-3 border-t">showing 50 of {filteredReminders.length}</div>
            )}
          </div>
        </div>
      )}

      {/* === SETTINGS TAB === */}
      {tab === 'settings' && config && (
        <div className="space-y-6">
          {/* Save button - sticky */}
          <div className="flex items-center justify-between bg-white rounded-xl border shadow-sm p-4 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-lg">⚙️ הגדרות vaccine-reminders</h2>
              {configDirty && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">שינויים לא שמורים</span>}
            </div>
            <button
              onClick={saveConfig}
              disabled={savingConfig || !configDirty}
              className={`px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-all ${
                configDirty ? 'bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200' : 'bg-gray-300 cursor-not-allowed'
              }`}
            >
              {savingConfig ? 'שומר...' : '💾 שמור הגדרות'}
            </button>
          </div>

          {/* 1. Stage Toggles & Timing */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h3 className="font-bold text-lg mb-2">🎛️ שלבי תזכורת — הפעלה ותזמון</h3>
            <p className="text-sm text-gray-400 mb-4">הפעל/כבה כל שלב וקבע תזמון (ערך שלילי = לפני מועד החיסון, חיובי = אחרי שפג)</p>
            <div className="space-y-3">
              {config.stages.map(s => {
                const info = STAGE_INFO[s.stage];
                return (
                  <div key={s.stage} className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                    s.enabled ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50 opacity-60'
                  }`}>
                    {/* Toggle */}
                    <button
                      onClick={() => updateStageConfig(s.stage, 'enabled', !s.enabled)}
                      className={`w-14 h-7 rounded-full transition-all relative ${s.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-1 transition-all ${s.enabled ? 'right-1' : 'left-1'}`} />
                    </button>

                    {/* Icon + Name */}
                    <div className="flex items-center gap-2 w-40">
                      <span className="text-xl">{info?.icon}</span>
                      <div>
                        <div className="font-medium text-sm">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.description}</div>
                      </div>
                    </div>

                    {/* Days input */}
                    <div className="flex items-center gap-2 mr-auto">
                      <span className="text-sm text-gray-500">שליחה</span>
                      <input
                        type="number"
                        min={-30}
                        max={90}
                        value={s.triggerDaysOverdue}
                        onChange={e => updateStageConfig(s.stage, 'triggerDaysOverdue', parseInt(e.target.value) || 0)}
                        className="w-16 text-center border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:border-emerald-500 outline-none"
                        disabled={!s.enabled}
                      />
                      <span className="text-sm text-gray-500">
                        {s.triggerDaysOverdue < 0 ? 'ימים לפני מועד החיסון' : 'ימים אחרי תפוגה'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tolerance */}
            <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-600">חלון סבילות:</span>
              <div className="flex gap-1">
                {[1, 2, 3, 5].map(d => (
                  <button
                    key={d}
                    onClick={() => updateConfig('toleranceDays', d)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      config.toleranceDays === d ? 'bg-emerald-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    ±{d} ימים
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 2. Message Templates Editor */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h3 className="font-bold text-lg mb-2">💬 תבניות הודעות</h3>
            <p className="text-sm text-gray-400 mb-4">ערוך את ההודעה לכל שלב תזכורת. המשתנים יוחלפו בערכים אמיתיים</p>

            {/* Stage selector */}
            <div className="flex gap-2 mb-4">
              {[1, 2, 3, 4].map(s => {
                const info = STAGE_INFO[s];
                const stageConf = config.stages.find(st => st.stage === s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setEditingStage(s);
                      setTemplateText(config.templates[String(s)] || '');
                    }}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      editingStage === s
                        ? 'bg-emerald-600 text-white shadow-lg'
                        : stageConf?.enabled
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    {info?.icon} {stageConf?.name || `שלב ${s}`}
                  </button>
                );
              })}
            </div>

            {/* Variables chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-xs text-gray-400">משתנים:</span>
              {TEMPLATE_VARS.map(v => (
                <button
                  key={v}
                  onClick={() => {
                    const insertion = `{${v}}`;
                    updateTemplate(editingStage, templateText + insertion);
                  }}
                  className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono hover:bg-blue-100 transition"
                >
                  {`{${v}}`}
                </button>
              ))}
            </div>

            {/* Editor + Preview */}
            <div className="flex gap-4">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-500 mb-2">עריכה</h4>
                <textarea
                  value={templateText}
                  onChange={e => updateTemplate(editingStage, e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg p-3 text-sm leading-relaxed resize-none focus:border-emerald-500 outline-none"
                  dir="rtl"
                  style={{ minHeight: '220px' }}
                />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-500 mb-2">תצוגה מקדימה</h4>
                <div
                  className="w-full bg-emerald-50 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap border border-emerald-200"
                  dir="rtl"
                  style={{ minHeight: '220px' }}
                >
                  {fillPreview(templateText)}
                </div>
              </div>
            </div>
          </div>

          {/* 3. Sending Settings */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h3 className="font-bold text-lg mb-4">📤 הגדרות שליחה</h3>

            {/* Max per day */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">מגבלת הודעות יומית</label>
              <div className="flex gap-2">
                {[10, 20, 30, 50, 100].map(n => (
                  <button
                    key={n}
                    onClick={() => updateConfig('maxPerDay', n)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      config.maxPerDay === n ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={config.maxPerDay}
                  onChange={e => updateConfig('maxPerDay', parseInt(e.target.value) || 30)}
                  className="w-20 text-center border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Auto Approve */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">מסלול אישור</label>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => updateConfig('autoApprove', true)}
                  className={`p-4 rounded-xl border-2 text-right transition-all ${
                    config.autoApprove ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🚀</span>
                    <span className="font-medium">אוטומטי</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 mr-8">שולח ישירות בלי אישור</div>
                </button>
                <button
                  onClick={() => updateConfig('autoApprove', false)}
                  className={`p-4 rounded-xl border-2 text-right transition-all ${
                    !config.autoApprove ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🔒</span>
                    <span className="font-medium">ידני</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 mr-8">ממתין לאישור בדשבורד</div>
                </button>
              </div>
            </div>

            {/* AI Enrichment */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">העשרה ב-AI</label>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => updateConfig('useAI', false)}
                  className={`p-4 rounded-xl border-2 text-right transition-all ${
                    !config.useAI ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📝</span>
                    <span className="font-medium">כבוי</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 mr-8">תבנית כמו שהיא</div>
                </button>
                <button
                  onClick={() => updateConfig('useAI', true)}
                  className={`p-4 rounded-xl border-2 text-right transition-all ${
                    config.useAI ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🤖</span>
                    <span className="font-medium">דלוק</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 mr-8">Claude משפר את הניסוח</div>
                </button>
              </div>
            </div>

            {/* Notify Gil */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">סיכום יומי לגיל</label>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => updateConfig('notifyGil', true)}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    config.notifyGil ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-1">📲</div>
                  <div className="font-medium text-sm">כן — שלח סיכום לגיל</div>
                </button>
                <button
                  onClick={() => updateConfig('notifyGil', false)}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    !config.notifyGil ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-1">🔕</div>
                  <div className="font-medium text-sm">לא — רק בדשבורד</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === LOGIC TAB === */}
      {tab === 'logic' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">🔄 pipeline</h2>
            <div className="flex items-start gap-0">
              {[1, 2, 3, 4].map((stageNum, idx) => {
                const info = STAGE_INFO[stageNum];
                const stageConf = config?.stages?.[stageNum - 1];
                return (
                  <div key={stageNum} className={`flex-1 text-center relative ${stageConf && !stageConf.enabled ? 'opacity-40' : ''}`}>
                    <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center text-xl ${
                      stageNum === 1 ? 'bg-blue-100' : stageNum === 2 ? 'bg-amber-100' :
                      stageNum === 3 ? 'bg-orange-100' : 'bg-red-100'
                    }`}>
                      {info.icon}
                    </div>
                    {idx < 3 && (
                      <div className="absolute top-6 left-0 right-0 h-0.5 bg-gray-200 -z-10" style={{ left: '50%', width: '100%' }} />
                    )}
                    <div className="mt-2 text-sm font-medium">{stageConf?.name || info.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{stageConf?.description || info.desc}</div>
                    <div className="text-xs text-gray-500 mt-1 font-mono">
                      +{stageConf?.triggerDaysOverdue || 0} days
                    </div>
                    {stageConf && !stageConf.enabled && (
                      <div className="text-xs text-red-500 mt-1 font-medium">disabled</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-5">
            <h2 className="font-bold text-lg mb-4">🧠 logic details</h2>
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-bold text-blue-600 mb-2">📅 stage 1</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>scans GetVaccineLaters from ClinicaOnline</li>
                  <li>identifies pets whose vaccine just expired</li>
                  <li>sends warm, friendly reminder</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-amber-600 mb-2">⏰ stage 2</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>checks if client visited since due date</li>
                  <li>if yes: skip (probably already vaccinated)</li>
                  <li>if no: send gentle nudge</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-orange-600 mb-2">⚠️ stage 3</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>re-checks visit history</li>
                  <li>stronger reminder emphasizing protection</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-red-600 mb-2">🔴 stage 4</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>final reminder in the cycle</li>
                  <li>after stage 4: stops reminding (until next vaccine)</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-emerald-600 mb-2">🛡️ safeguards</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>no sending on Shabbat/holidays</li>
                  <li>no sending without phone number</li>
                  <li>no duplicate for same stage</li>
                  <li>auto-skip if client visited since due date</li>
                  <li>daily limit: {config?.maxPerDay || 30}</li>
                  <li>tolerance window: ±{config?.toleranceDays || 2} days</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {configToast && (
        <div className={`fixed bottom-6 left-6 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white z-50 ${
          configToast.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {configToast.msg}
        </div>
      )}
    </div>
  );
}
