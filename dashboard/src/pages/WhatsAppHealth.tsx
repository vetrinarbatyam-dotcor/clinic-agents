import { useEffect, useState } from 'react';

type NumberStatus = {
  phone: string;
  label: string;
  sent_today: number;
  cap_today: number;
  remaining: number;
  configured: boolean;
  role: string;
};

type StatusResp = {
  date: string;
  numbers: NumberStatus[];
  blocked_senders: string[];
  cold_send_hours: [number, number];
  warm_send_hours: [number, number];
  delay_range_by_sender: Record<string, [number, number]>;
  warm_delay_range: [number, number];
  burst_every: number;
};

type LogRow = {
  ts: string;
  from_phone: string;
  to_phone: string;
  category: string;
  agent: string;
  status: string;
  error: string;
};

export default function WhatsAppHealth() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        fetch('/api/whatsapp/status').then(r => r.json()),
        fetch('/api/whatsapp/log?limit=30').then(r => r.json()),
      ]);
      setStatus(s);
      setLog(l.rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const promote = async (phone: string) => {
    await fetch(`/api/whatsapp/promote/${phone}`, { method: 'POST' });
    load();
  };

  if (loading && !status) return <div className="p-6">טוען...</div>;
  if (!status) return <div className="p-6">שגיאה בטעינה</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <h1 className="text-2xl font-bold mb-2">בריאות WhatsApp — הגנה מחסימה</h1>
      <p className="text-sm text-gray-600 mb-6">
        ניתוב הודעות בין מספרי המרפאה עם warm-up, השהיות וניטור. תאריך: {status.date}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {status.numbers.map(n => {
          const pct = Math.min(100, Math.round((n.sent_today / Math.max(n.cap_today, 1)) * 100));
          const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500';
          return (
            <div key={n.phone} className="border rounded-xl p-5 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-lg font-bold">{n.phone}</div>
                  <div className="text-sm text-gray-500">
                    {n.label} · {n.role === 'primary' ? 'ראשי' : 'בחימום'}
                  </div>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${n.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {n.configured ? 'מחובר' : 'לא מוגדר'}
                </span>
              </div>

              <div className="text-sm mb-1">
                נשלחו היום: <b>{n.sent_today}</b> / {n.cap_today} (נותרו {n.remaining})
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
              </div>

              <button
                onClick={() => promote(n.phone)}
                className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
              >
                הגדל cap (+30%)
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-gray-50 border rounded-xl p-4 mb-6 text-sm">
        <div className="font-bold mb-1">חוקי הגנה פעילים</div>
        <ul className="list-disc pr-5 space-y-1 text-gray-700">
          <li>שעות שליחה (ראשי/cold): {status.cold_send_hours[0]}:00 – {status.cold_send_hours[1]}:00 (לא בשבת)</li>
          <li>שעות שליחה (warm-up): {status.warm_send_hours[0]}:00 – {status.warm_send_hours[1]}:00</li>
          <li>השהיה warm-up: {status.warm_delay_range[0]}–{status.warm_delay_range[1]} שניות בין הודעות</li>
          {Object.entries(status.delay_range_by_sender).map(([phone, range]) => (
            <li key={phone}>השהיה {phone}: {range[0]}–{range[1]} שניות</li>
          ))}
          <li>הפסקת burst כל {status.burst_every} הודעות</li>
          <li>מספרים חסומים לסוכנים: {status.blocked_senders.join(', ')}</li>
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-bold mb-3">לוג שליחות אחרונות</h2>
        <div className="overflow-x-auto border rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right p-2">סטטוס</th>
                <th className="text-right p-2">סוכן</th>
                <th className="text-right p-2">קטגוריה</th>
                <th className="text-right p-2">אל</th>
                <th className="text-right p-2">מ-</th>
                <th className="text-right p-2">זמן</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-gray-400">אין שליחות עדיין</td></tr>
              )}
              {log.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${r.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : r.status === 'skipped' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-2">{r.agent || '-'}</td>
                  <td className="p-2">{r.category || '-'}</td>
                  <td className="p-2 font-mono text-xs">{r.to_phone}</td>
                  <td className="p-2 font-mono text-xs">{r.from_phone || '-'}</td>
                  <td className="p-2 text-xs text-gray-500">{r.ts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
