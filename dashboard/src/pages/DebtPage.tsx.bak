/**
 * DebtPage.tsx — Dashboard page for debt agent
 * Copy to: /home/claude-user/clinic-agents/dashboard/src/pages/DebtPage.tsx
 *
 * Layers:
 * 1. Summary (default) — total debt, count, TOP 5, approve button
 * 2. Table — full debtor list with status + send/exclude per client
 * 3. Expandable: Graphs + Log
 * 4. Expandable: Config (tuning)
 * Toggle: weekly / monthly view
 */

import { useEffect, useState } from 'react';
import AgentStackPanel from '../components/AgentStackPanel';
import { supabase } from '../supabase';

interface Debt {
  id: number;
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  cell_phone: string;
  amount: number;
  last_visit: string;
  pet_names: string;
  escalation_level: number;
  is_excluded: boolean;
  first_seen_at: string;
}

interface Reminder {
  id: number;
  user_id: string;
  client_name: string;
  client_phone: string;
  amount: number;
  escalation_level: number;
  message_text: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface ConfigItem {
  key: string;
  value: string;
  description: string;
}

type ViewMode = 'weekly' | 'monthly';

export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [showTable, setShowTable] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadDebts(), loadReminders(), loadConfig()]);
    setLoading(false);
  }

  async function loadDebts() {
    const { data } = await supabase
      .from('debts')
      .select('*')
      .is('resolved_at', null)
      .order('amount', { ascending: false });
    setDebts(data || []);
  }

  async function loadReminders() {
    const since = new Date();
    since.setDate(since.getDate() - (viewMode === 'weekly' ? 7 : 30));
    const { data } = await supabase
      .from('debt_reminders')
      .select('*')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });
    setReminders(data || []);
  }

  async function loadConfig() {
    const { data } = await supabase
      .from('debt_agent_config')
      .select('*')
      .order('key');
    setConfig(data || []);
  }

  // Stats
  const totalDebt = debts.reduce((s, d) => s + d.amount, 0);
  const over500 = debts.filter(d => d.amount >= 500).length;
  const over1000 = debts.filter(d => d.amount >= 1000).length;
  const pendingApproval = reminders.filter(r => r.status === 'pending').length;
  const sentCount = reminders.filter(r => r.status === 'sent').length;
  const top5 = debts.slice(0, 5);

  async function approveReminder(id: number) {
    await supabase.from('debt_reminders').update({ status: 'approved', approved_by: 'gil' }).eq('id', id);
    loadReminders();
  }

  async function rejectReminder(id: number) {
    await supabase.from('debt_reminders').update({ status: 'rejected' }).eq('id', id);
    loadReminders();
  }

  async function excludeClient(userId: string, name: string) {
    await supabase.from('debt_excluded_clients').upsert({ user_id: userId, client_name: name, reason: 'excluded from dashboard' });
    await supabase.from('debts').update({ is_excluded: true }).eq('user_id', userId);
    loadDebts();
  }

  async function saveConfig(key: string, value: string) {
    await supabase.from('debt_agent_config').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    setEditingConfig(null);
    loadConfig();
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-400 text-xl">טוען נתוני חובות...</div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header + View Toggle */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">💰 סוכן גבייה</h1>
        <div className="flex gap-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => { setViewMode('weekly'); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${viewMode === 'weekly' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
          >שבועי</button>
          <button
            onClick={() => { setViewMode('monthly'); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${viewMode === 'monthly' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
          >חודשי</button>
        </div>
      <AgentStackPanel agentName={'debt-agent'} />
      </div>

      {/* Layer 1: Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="סה״כ חוב פתוח" value={`₪${Math.round(totalDebt).toLocaleString()}`} color="red" />
        <StatCard label="לקוחות חייבים" value={debts.length.toString()} color="blue" />
        <StatCard label="מעל ₪1,000" value={over1000.toString()} color="red" />
        <StatCard label="מעל ₪500" value={over500.toString()} color="amber" />
      </div>

      {/* Top 5 */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold mb-3">🏆 TOP 5 חייבים</h2>
        <div className="space-y-2">
          {top5.map((d, i) => (
            <div key={d.id} className="flex items-center justify-between py-1 border-b last:border-0">
              <span className="font-medium">{i + 1}. {d.first_name} {d.last_name}</span>
              <span className="font-bold text-red-600">₪{Math.round(d.amount).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Approvals */}
      {pendingApproval > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-bold text-amber-800 mb-3">⏳ {pendingApproval} הודעות ממתינות לאישורך</h2>
          <div className="space-y-3">
            {reminders.filter(r => r.status === 'pending').map(r => (
              <div key={r.id} className="bg-white rounded-lg p-4 border">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-bold">{r.client_name}</span>
                    <span className="text-gray-400 mr-2">₪{Math.round(r.amount).toLocaleString()}</span>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">רמה {r.escalation_level}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => approveReminder(r.id)} className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700">אשר ✓</button>
                    <button onClick={() => rejectReminder(r.id)} className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200">דחה ✗</button>
                  </div>
                </div>
                <pre className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 rounded p-3">{r.message_text}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Layer 2: Full Table (expandable) */}
      <ExpandableSection title={`📋 טבלת חייבים (${debts.length})`} open={showTable} onToggle={() => setShowTable(!showTable)}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-red-800 text-white">
                <th className="px-3 py-2 text-right">שם</th>
                <th className="px-3 py-2 text-right">טלפון</th>
                <th className="px-3 py-2 text-right">חיות</th>
                <th className="px-3 py-2 text-center">סכום</th>
                <th className="px-3 py-2 text-center">רמה</th>
                <th className="px-3 py-2 text-center">ביקור אחרון</th>
                <th className="px-3 py-2 text-center">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {debts.map(d => (
                <tr key={d.id} className={`border-b hover:bg-gray-50 ${d.is_excluded ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2">{d.first_name} {d.last_name}</td>
                  <td className="px-3 py-2 ltr">{d.cell_phone || d.phone}</td>
                  <td className="px-3 py-2 text-xs">{d.pet_names}</td>
                  <td className="px-3 py-2 text-center font-bold text-red-600">₪{Math.round(d.amount).toLocaleString()}</td>
                  <td className="px-3 py-2 text-center">
                    <LevelBadge level={d.escalation_level} />
                  </td>
                  <td className="px-3 py-2 text-center text-xs">{d.last_visit}</td>
                  <td className="px-3 py-2 text-center">
                    {!d.is_excluded && (
                      <button
                        onClick={() => excludeClient(d.user_id, `${d.first_name} ${d.last_name}`)}
                        className="text-xs text-gray-400 hover:text-red-500"
                        title="החרג מגבייה"
                      >🚫</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ExpandableSection>

      {/* Layer 3: Log (expandable) */}
      <ExpandableSection title={`📜 היסטוריית הודעות (${sentCount} נשלחו)`} open={showLog} onToggle={() => setShowLog(!showLog)}>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {reminders.filter(r => r.status !== 'pending').map(r => (
            <div key={r.id} className="flex items-center justify-between py-2 border-b text-sm">
              <div>
                <span className="font-medium">{r.client_name}</span>
                <span className="text-gray-400 mr-2">₪{Math.round(r.amount).toLocaleString()}</span>
                <LevelBadge level={r.escalation_level} />
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} />
                <span className="text-xs text-gray-400">
                  {r.sent_at ? new Date(r.sent_at).toLocaleDateString('he-IL') : new Date(r.created_at).toLocaleDateString('he-IL')}
                </span>
              </div>
            </div>
          ))}
          {reminders.filter(r => r.status !== 'pending').length === 0 && (
            <div className="text-center text-gray-400 py-8">אין היסטוריה עדיין</div>
          )}
        </div>
      </ExpandableSection>

      {/* Layer 4: Config (expandable) */}
      <ExpandableSection title="⚙️ כיול" open={showConfig} onToggle={() => setShowConfig(!showConfig)}>
        <div className="space-y-3">
          {config.map(c => (
            <div key={c.key} className="flex items-center justify-between py-2 border-b">
              <div>
                <span className="font-medium text-sm">{c.description || c.key}</span>
                <span className="text-xs text-gray-400 block">{c.key}</span>
              </div>
              {editingConfig === c.key ? (
                <div className="flex gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm w-40"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                  />
                  <button onClick={() => saveConfig(c.key, editValue)} className="text-emerald-600 text-sm font-bold">💾</button>
                  <button onClick={() => setEditingConfig(null)} className="text-gray-400 text-sm">✗</button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingConfig(c.key); setEditValue(c.value); }}
                  className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200"
                >
                  {c.value || '(ריק)'}
                </button>
              )}
            </div>
          ))}
        </div>
      </ExpandableSection>
    </div>
  );
}

// ============ Sub-components ============

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.blue}`}>
      <div className="text-xs font-medium opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function LevelBadge({ level }: { level: number }) {
  const colors = ['bg-gray-100 text-gray-500', 'bg-green-100 text-green-700', 'bg-yellow-100 text-yellow-700', 'bg-orange-100 text-orange-700', 'bg-red-100 text-red-700', 'bg-red-200 text-red-800'];
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[level] || colors[0]}`}>{level}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: 'נשלח', cls: 'bg-emerald-100 text-emerald-700' },
    approved: { label: 'אושר', cls: 'bg-blue-100 text-blue-700' },
    rejected: { label: 'נדחה', cls: 'bg-red-100 text-red-700' },
    pending: { label: 'ממתין', cls: 'bg-amber-100 text-amber-700' },
  };
  const s = map[status] || map.pending;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

function ExpandableSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition">
        <h2 className="font-bold">{title}</h2>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
