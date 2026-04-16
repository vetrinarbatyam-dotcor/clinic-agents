import { apiFetch } from '../api';
import { useEffect, useState } from 'react';

const API = '/api/opt-out';

interface OptOutEntry {
  id: number;
  phone: string;
  client_name: string | null;
  reason: string | null;
  opted_out_at: string;
  opted_out_via: string | null;
  notes: string | null;
}

export default function OptOut() {
  const [items, setItems] = useState<OptOutEntry[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formPhone, setFormPhone] = useState('');
  const [formName, setFormName] = useState('');
  const [formReason, setFormReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<number | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetch(API);
      const data = await res.json();
      setItems(data.items || []);
      setCount(data.count || 0);
    } catch {
      setError('שגיאה בטעינת הנתונים');
    }
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!formPhone.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch(API, {
        method: 'POST',
        body: JSON.stringify({
          phone: formPhone.trim(),
          client_name: formName.trim() || null,
          reason: formReason.trim() || null,
          via: 'manual_dashboard',
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || 'שגיאה');
        setSubmitting(false);
        return;
      }
      setFormPhone('');
      setFormName('');
      setFormReason('');
      setShowForm(false);
      await loadData();
    } catch {
      setError('שגיאה בשמירה');
    }
    setSubmitting(false);
  }

  async function handleOptBackIn(phone: string) {
    try {
      await apiFetch(`${API}/remove`, {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setConfirmId(null);
      await loadData();
    } catch {
      setError('שגיאה בהחזרה לרשימה');
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('למחוק את הרשומה לצמיתות?')) return;
    try {
      await apiFetch(`${API}/${id}`, { method: 'DELETE' });
      await loadData();
    } catch {
      setError('שגיאה במחיקה');
    }
  }

  function fmtDate(s: string | null) {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function viaLabel(v: string | null) {
    if (!v) return '—';
    const map: Record<string, string> = {
      auto_reply: 'תגובה אוטומטית',
      manual_dashboard: 'ידני',
      whatsapp: 'וואטסאפ',
      phone_call: 'שיחה',
    };
    return map[v] || v;
  }

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">ניהול Opt-Out — לקוחות שביקשו להפסיק</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-6 text-center">
          <div className="text-3xl font-bold text-red-600">{count}</div>
          <div className="text-sm text-gray-500 mt-1">סה״כ Opt-Out פעילים</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
          >
            הוסף ידנית
          </button>
        ) : (
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">טלפון *</label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="05X-XXXXXXX"
                  className="px-3 py-2 border rounded-lg w-44 text-left"
                  dir="ltr"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">שם לקוח</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="אופציונלי"
                  className="px-3 py-2 border rounded-lg w-44"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">סיבה</label>
                <input
                  type="text"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  placeholder="למשל: ביקש בטלפון"
                  className="px-3 py-2 border rounded-lg w-full"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50"
              >
                {submitting ? 'שומר...' : 'שמור'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition"
              >
                ביטול
              </button>
            </div>
          </form>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          {error}
          <button onClick={() => setError('')} className="mr-3 underline">סגור</button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">טוען...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400">אין לקוחות ב-Opt-Out כרגע</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">טלפון</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">שם לקוח</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">סיבה</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">תאריך</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">מקור</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-mono text-left" dir="ltr">{item.phone}</td>
                    <td className="px-4 py-3">{item.client_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{item.reason || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(item.opted_out_at)}</td>
                    <td className="px-4 py-3 text-xs">{viaLabel(item.opted_out_via)}</td>
                    <td className="px-4 py-3">
                      {confirmId === item.id ? (
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-orange-600">בטוח?</span>
                          <button
                            onClick={() => handleOptBackIn(item.phone)}
                            className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                          >
                            כן
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                          >
                            לא
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmId(item.id)}
                            className="px-3 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition"
                          >
                            החזר לרשימה
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100 transition"
                            title="מחיקה לצמיתות"
                          >
                            מחק
                          </button>
                        </div>
                      )}
                    </td>
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
