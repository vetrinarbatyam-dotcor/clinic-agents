import { useEffect, useState } from 'react';

const API = '/api/agents/deal-calculator';

interface DealRow {
  item_name: string;
  sku?: string | null;
  unit_price: number | '';
  paid_qty: number | '';
  bonus_qty: number | '';
  deal_format?: string;
  bonus_product_value: number;
  regular_unit_price?: number | null;
  shelf_life_months?: number | null;
  avg_monthly_sales?: number | null;
  current_stock?: number;
}

interface Decision {
  item_name: string;
  sku?: string | null;
  regular_unit_price: number;
  effective_unit_price: number;
  saving_pct: number;
  total_units: number;
  total_cost: number;
  months_of_stock: number | null;
  shelf_life_months: number | null;
  score: number;
  recommendation: string;
  recommended_qty: number;
  warnings: string[];
}

interface Summary {
  total_cost: number;
  total_savings: number;
  items_to_buy: number;
}

interface SessionRow {
  id: string;
  supplier: string | null;
  deal_date: string | null;
  created_at: string;
  google_sheet_url: string | null;
}

type Tab = 'upload' | 'table' | 'decisions' | 'history';

const EMPTY_ROW: DealRow = {
  item_name: '',
  sku: '',
  unit_price: '',
  paid_qty: '',
  bonus_qty: 0,
  bonus_product_value: 0,
};

function parseDealFormat(text: string): { paid: number; bonus: number } | null {
  const m = text.match(/^\s*(\d+)\s*\+\s*(\d+)\s*$/);
  return m ? { paid: parseInt(m[1]), bonus: parseInt(m[2]) } : null;
}

export default function DealCalculator() {
  const [tab, setTab] = useState<Tab>('upload');
  const [rows, setRows] = useState<DealRow[]>([{ ...EMPTY_ROW }]);
  const [supplier, setSupplier] = useState('');
  const [dealExpiry, setDealExpiry] = useState('');
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (tab === 'history') loadSessions();
  }, [tab]);

  async function loadSessions() {
    try {
      const r = await fetch(`${API}/sessions?limit=30`).then((x) => x.json());
      setSessions(r.sessions || []);
    } catch (e: any) {
      setErr('שגיאה בטעינת היסטוריה: ' + e.message);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'excel' | 'pdf' | 'image') {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(''); setInfo('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      const resp = await fetch(`${API}/parse`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const parsedRows: DealRow[] = (data.rows || []).map((r: any) => ({
        item_name: r.item_name || '',
        sku: r.sku || '',
        unit_price: r.unit_price ?? '',
        paid_qty: r.paid_qty ?? '',
        bonus_qty: r.bonus_qty ?? 0,
        bonus_product_value: r.bonus_product_value || 0,
        deal_format: r.deal_format,
      }));
      if (parsedRows.length === 0) {
        setErr('לא נמצאו שורות בקובץ');
      } else {
        setRows(parsedRows);
        setTab('table');
        setInfo(`נטענו ${parsedRows.length} שורות`);
      }
    } catch (e: any) {
      setErr('שגיאה בפרסור: ' + e.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function updateRow(i: number, patch: Partial<DealRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function updateDealFormat(i: number, text: string) {
    const parsed = parseDealFormat(text);
    if (parsed) {
      updateRow(i, { paid_qty: parsed.paid, bonus_qty: parsed.bonus, deal_format: `${parsed.paid}+${parsed.bonus}` });
    } else {
      updateRow(i, { deal_format: text });
    }
  }

  function addRow() { setRows((r) => [...r, { ...EMPTY_ROW }]); }
  function removeRow(i: number) { setRows((r) => r.filter((_, idx) => idx !== i)); }

  async function calculate() {
    setBusy(true); setErr(''); setInfo('');
    try {
      const validRows = rows.filter((r) => r.item_name && r.unit_price !== '' && r.paid_qty !== '');
      if (validRows.length === 0) { setErr('אין שורות תקינות לחישוב'); return; }

      const payload = {
        rows: validRows.map((r) => ({
          item_name: r.item_name,
          sku: r.sku || null,
          unit_price: Number(r.unit_price),
          paid_qty: Number(r.paid_qty),
          bonus_qty: Number(r.bonus_qty || 0),
          bonus_product_value: Number(r.bonus_product_value || 0),
          regular_unit_price: r.regular_unit_price ?? null,
          shelf_life_months: r.shelf_life_months ?? null,
          avg_monthly_sales: r.avg_monthly_sales ?? null,
          current_stock: r.current_stock || 0,
        })),
      };

      const resp = await fetch(`${API}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setDecisions(data.decisions);
      setSummary(data.summary);
      setTab('decisions');
    } catch (e: any) {
      setErr('שגיאה בחישוב: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSession() {
    if (!decisions.length) return;
    setBusy(true);
    try {
      const resp = await fetch(`${API}/save-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: supplier || null,
          deal_expiry: dealExpiry || null,
          rows: decisions,
          decision: summary,
          created_by: 'dashboard',
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setInfo('נשמר בהצלחה');
    } catch (e: any) {
      setErr('שגיאת שמירה: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportResults(sendWhatsapp: boolean) {
    if (!decisions.length || !summary) return;
    setBusy(true);
    try {
      const resp = await fetch(`${API}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions, summary, supplier, send_whatsapp: sendWhatsapp }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const parts = ['יוצא'];
      if (data.drive_path) parts.push(`Drive: ${data.drive_path}`);
      if (data.whatsapp_sent) parts.push('WhatsApp נשלח לגיל');
      setInfo(parts.join(' · '));
    } catch (e: any) {
      setErr('שגיאת ייצוא: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const recColor = (rec: string) =>
    rec.startsWith('✅') ? 'bg-green-50 text-green-800' :
    rec.startsWith('⚠️') ? 'bg-yellow-50 text-yellow-800' :
    'bg-red-50 text-red-800';

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-4xl">📊</span>
          <h1 className="text-2xl font-bold">סוכן מבצעים</h1>
          <span className="text-sm text-gray-500">— חישוב כדאיות ומחיר אפקטיבי</span>
        </div>

        {(err || info) && (
          <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${err ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {err || info}
          </div>
        )}

        <div className="flex gap-2 mb-6 border-b">
          {([
            ['upload', '📤 העלאה'],
            ['table', '📝 טבלה'],
            ['decisions', '🎯 החלטות'],
            ['history', '🕓 היסטוריה'],
          ] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 font-medium transition ${tab === k ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'upload' && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm text-gray-600">ספק</span>
                <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="block">
                <span className="text-sm text-gray-600">תוקף מבצע</span>
                <input type="date" value={dealExpiry} onChange={(e) => setDealExpiry(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-emerald-500" />
              </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <UploadButton label="📊 Excel / CSV" accept=".xlsx,.csv" onChange={(e) => handleUpload(e, 'excel')} disabled={busy} />
              <UploadButton label="📄 PDF" accept=".pdf" onChange={(e) => handleUpload(e, 'pdf')} disabled={busy} />
              <UploadButton label="📷 תמונה / צילום" accept="image/*" onChange={(e) => handleUpload(e, 'image')} disabled={busy} />
              <button onClick={() => { setRows([{ ...EMPTY_ROW }]); setTab('table'); }}
                className="py-4 border-2 border-dashed rounded-lg hover:bg-gray-50">
                ✍️ הזנה ידנית
              </button>
            </div>
          </div>
        )}

        {tab === 'table' && (
          <div className="bg-white rounded-xl border p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-right p-2">מוצר</th>
                    <th className="text-right p-2">SKU</th>
                    <th className="text-right p-2">פורמט מבצע (4+1)</th>
                    <th className="text-right p-2">מחיר יחידה ₪</th>
                    <th className="text-right p-2">מחיר רגיל ₪</th>
                    <th className="text-right p-2">שווי בונוס נפרד ₪</th>
                    <th className="text-right p-2">תוקף (חודשים)</th>
                    <th className="text-right p-2">מכירה חודשית</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="p-1"><input className="w-full px-2 py-1 border rounded" value={r.item_name} onChange={(e) => updateRow(i, { item_name: e.target.value })} /></td>
                      <td className="p-1"><input className="w-full px-2 py-1 border rounded" value={r.sku || ''} onChange={(e) => updateRow(i, { sku: e.target.value })} /></td>
                      <td className="p-1"><input className="w-full px-2 py-1 border rounded" value={r.deal_format || (r.paid_qty && r.bonus_qty !== '' ? `${r.paid_qty}+${r.bonus_qty}` : '')} onChange={(e) => updateDealFormat(i, e.target.value)} placeholder="4+1" /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.unit_price} onChange={(e) => updateRow(i, { unit_price: e.target.value === '' ? '' : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.regular_unit_price ?? ''} onChange={(e) => updateRow(i, { regular_unit_price: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.bonus_product_value} onChange={(e) => updateRow(i, { bonus_product_value: Number(e.target.value) || 0 })} /></td>
                      <td className="p-1"><input type="number" className="w-20 px-2 py-1 border rounded" value={r.shelf_life_months ?? ''} onChange={(e) => updateRow(i, { shelf_life_months: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.1" className="w-20 px-2 py-1 border rounded" value={r.avg_monthly_sales ?? ''} onChange={(e) => updateRow(i, { avg_monthly_sales: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><button onClick={() => removeRow(i)} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={addRow} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg">+ הוסף שורה</button>
              <button onClick={calculate} disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {busy ? 'מחשב...' : '🎯 חשב המלצות'}
              </button>
            </div>
          </div>
        )}

        {tab === 'decisions' && (
          <div className="bg-white rounded-xl border p-4">
            {!decisions.length ? (
              <p className="text-gray-500 text-center py-8">אין עדיין החלטות — חזור לטאב "טבלה" וחשב</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-right p-2">מוצר</th>
                        <th className="text-right p-2">מחיר רגיל</th>
                        <th className="text-right p-2">מחיר אפקטיבי</th>
                        <th className="text-right p-2">חיסכון</th>
                        <th className="text-right p-2">חודשי מלאי</th>
                        <th className="text-right p-2">ציון</th>
                        <th className="text-right p-2">המלצה</th>
                        <th className="text-right p-2">כמות מוצעת</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decisions.map((d, i) => (
                        <tr key={i} className={`border-b ${recColor(d.recommendation)}`}>
                          <td className="p-2 font-medium">{d.item_name}</td>
                          <td className="p-2">₪{d.regular_unit_price}</td>
                          <td className="p-2 font-bold">₪{d.effective_unit_price}</td>
                          <td className="p-2">{(d.saving_pct * 100).toFixed(1)}%</td>
                          <td className="p-2">{d.months_of_stock ?? '—'}</td>
                          <td className="p-2">{d.score}</td>
                          <td className="p-2">{d.recommendation}</td>
                          <td className="p-2">{d.recommended_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {summary && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg grid grid-cols-3 gap-4 text-center">
                    <div><div className="text-xs text-gray-500">להוצאה</div><div className="text-xl font-bold">₪{summary.total_cost.toLocaleString()}</div></div>
                    <div><div className="text-xs text-gray-500">חיסכון</div><div className="text-xl font-bold text-green-700">₪{summary.total_savings.toLocaleString()}</div></div>
                    <div><div className="text-xs text-gray-500">פריטים לרכישה</div><div className="text-xl font-bold">{summary.items_to_buy}</div></div>
                  </div>
                )}
                <div className="mt-4 flex gap-2 justify-end">
                  <button onClick={saveSession} disabled={busy} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg">💾 שמור סשן</button>
                  <button onClick={() => exportResults(false)} disabled={busy} className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg">📊 ייצא ל-Drive</button>
                  <button onClick={() => exportResults(true)} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">📱 ייצא + וואטסאפ לגיל</button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-white rounded-xl border p-4">
            {!sessions.length ? (
              <p className="text-gray-500 text-center py-8">אין סשנים שמורים</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-right p-2">תאריך</th>
                    <th className="text-right p-2">ספק</th>
                    <th className="text-right p-2">Drive</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-gray-50">
                      <td className="p-2">{new Date(s.created_at).toLocaleString('he-IL')}</td>
                      <td className="p-2">{s.supplier || '—'}</td>
                      <td className="p-2">{s.google_sheet_url ? <a href={s.google_sheet_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">קישור</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadButton({ label, accept, onChange, disabled }: { label: string; accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled: boolean }) {
  return (
    <label className={`cursor-pointer py-4 border-2 border-dashed rounded-lg text-center hover:bg-gray-50 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {label}
      <input type="file" accept={accept} onChange={onChange} className="hidden" disabled={disabled} />
    </label>
  );
}
