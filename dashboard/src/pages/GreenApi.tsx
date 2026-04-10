import { useEffect, useState } from 'react';

interface AccountStatus {
  label: string;
  instance_id: string;
  state: string;
  wid?: string;
  webhook_url?: string;
  latency_ms?: number;
  error?: string;
}

interface RecentItem {
  agent: string;
  created_at: string;
  phone: string;
  status: string;
  preview: string;
}

export default function GreenApi() {
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [stats, setStats] = useState<{ today: number; week: number; month: number }>({ today: 0, week: 0, month: 0 });
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pinging, setPinging] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, st, rc] = await Promise.all([
        fetch('/api/integrations/green-api/status').then(r => r.json()),
        fetch('/api/integrations/green-api/stats').then(r => r.json()),
        fetch('/api/integrations/green-api/recent').then(r => r.json()),
      ]);
      setAccounts(s.accounts || []);
      setStats(st);
      setRecent(rc.items || []);
    } finally {
      setLoading(false);
    }
  };

  const ping = async () => {
    setPinging(true);
    try {
      await fetch('/api/integrations/green-api/ping', { method: 'POST' });
      await load();
    } finally {
      setPinging(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stateBadge = (s: string) => {
    const cls = s === 'authorized' ? 'bg-green-500' : s === 'notAuthorized' ? 'bg-yellow-500' : s === 'starting' ? 'bg-blue-500' : 'bg-red-500';
    const txt = s === 'authorized' ? 'מחובר' : s === 'notAuthorized' ? 'דרוש QR' : s === 'starting' ? 'מתחיל' : s;
    return <span className={`px-2 py-0.5 rounded text-xs text-white ${cls}`}>{txt}</span>;
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          💬 Green API — סטטוס
        </h1>
        <div className="flex gap-2">
          <button onClick={ping} disabled={pinging} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
            {pinging ? 'בודק...' : '🔄 בדוק חיבור'}
          </button>
          <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
            ↗ קונסולה
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">היום</div>
          <div className="text-3xl font-bold">{stats.today}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">7 ימים</div>
          <div className="text-3xl font-bold">{stats.week}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">30 ימים</div>
          <div className="text-3xl font-bold">{stats.month}</div>
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4">
        <h2 className="font-bold mb-3">חשבונות</h2>
        {loading && accounts.length === 0 && <div>טוען...</div>}
        {!loading && accounts.length === 0 && <div className="text-gray-400">לא הוגדרו חשבונות Green API</div>}
        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.instance_id} className="border rounded-lg p-3 flex items-center justify-between">
              <div className="space-y-1">
                <div className="font-semibold flex items-center gap-2">{a.label} {stateBadge(a.state)}</div>
                <div className="text-xs text-gray-500">Instance: {a.instance_id}</div>
                {a.wid && <div className="text-xs">📱 {a.wid}</div>}
                {a.webhook_url && <div className="text-xs truncate max-w-md">🔗 {a.webhook_url}</div>}
                {a.error && <div className="text-xs text-red-600">{a.error}</div>}
              </div>
              {a.latency_ms !== undefined && <div className="text-sm text-gray-500">{a.latency_ms}ms</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-xl p-4">
        <h2 className="font-bold mb-3">20 הודעות אחרונות</h2>
        {recent.length === 0 ? (
          <div className="text-gray-400 text-sm">אין הודעות עדיין</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-gray-500 border-b">
                  <th className="py-1">סוכן</th><th>טלפון</th><th>סטטוס</th><th>תצוגה</th><th>זמן</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{r.agent}</td>
                    <td>{r.phone}</td>
                    <td>{r.status}</td>
                    <td className="max-w-xs truncate">{r.preview}</td>
                    <td className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString('he-IL')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
