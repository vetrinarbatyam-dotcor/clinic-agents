import { useEffect, useState } from 'react';
import { apiFetch, authHeaders } from '../api';

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
  discount_mode?: 'bonus' | 'percent';
  discount_pct?: number | null;
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

type Tab = 'upload' | 'table' | 'decisions' | 'history' | 'catalog';

interface CatalogItem {
  id: string;
  supplier_item_id?: number;
  company_name: string;
  category: string | null;
  item_name: string;
  code: string | null;
  price_no_vat: number | null;
  price_with_vat: number | null;
  shelf_life_months: number | null;
  avg_monthly_sales: number | null;
  current_stock: number | null;
  clinic_item_id?: number | null;
  linked_clinic_name?: string | null;
  link_score?: number | null;
  link_status?: 'auto' | 'manual' | 'review' | null;
}

interface MatchCandidate {
  clinic_id: number;
  clinic_name: string;
  score: number;
}

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
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [catalogCompany, setCatalogCompany] = useState<string>('');
  const [catalogQuery, setCatalogQuery] = useState<string>('');
  const [catalogSource, setCatalogSource] = useState<'clinic' | 'suppliers'>('clinic');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [suppliersWithData, setSuppliersWithData] = useState<string[]>([]);
  const [linkModal, setLinkModal] = useState<{ item: CatalogItem; candidates: MatchCandidate[] } | null>(null);
  const [dealUrl, setDealUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (tab === 'history') loadSessions();
    if (tab === 'catalog') { loadCompanies(); loadSuppliers(); loadCatalog(); }
  }, [tab]);

  useEffect(() => {
    if (tab === 'catalog') loadCatalog();
  }, [catalogCompany, catalogQuery, catalogSource]);

  async function loadCompanies() {
    try {
      const r = await apiFetch(`${API}/companies`).then((x) => x.json());
      setCompanies(r.companies || []);
    } catch (e: any) { /* silent */ }
  }

  async function loadSuppliers() {
    try {
      const r = await apiFetch(`${API}/supplier-catalogs/suppliers`).then((x) => x.json());
      setSuppliers(r.suppliers || []);
      setSuppliersWithData(r.with_data || []);
    } catch (e: any) { /* silent */ }
  }

  async function loadCatalog() {
    try {
      const params = new URLSearchParams({ limit: '500' });
      let endpoint = `${API}/prices`;
      if (catalogSource === 'suppliers') {
        endpoint = `${API}/supplier-catalogs`;
        if (catalogCompany) params.set('supplier', catalogCompany);
      } else {
        if (catalogCompany) params.set('company', catalogCompany);
      }
      if (catalogQuery) params.set('query', catalogQuery);
      const r = await apiFetch(`${endpoint}?${params}`).then((x) => x.json());
      setCatalog(r.items || []);
    } catch (e: any) {
      setErr('שגיאה בטעינת מחירון: ' + e.message);
    }
  }

  async function runAutoLink() {
    setBusy(true); setErr(''); setInfo('');
    try {
      const params = new URLSearchParams();
      if (catalogSource === 'suppliers' && catalogCompany) params.set('supplier', catalogCompany);
      const resp = await apiFetch(`${API}/supplier-catalogs/auto-link?${params}`, { method: 'POST' });
      if (!resp.ok) throw new Error(await resp.text());
      const d = await resp.json();
      setInfo(`${d.auto_linked} קושרו · ${d.review_needed} לשאילתי · ${d.unlinked} לא נמצא`);
      await loadCatalog();
    } catch (e: any) {
      setErr('שגיאת התאמה: ' + e.message);
    } finally { setBusy(false); }
  }

  async function openLinkModal(item: CatalogItem) {
    if (!item.supplier_item_id) return;
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`${API}/supplier-catalogs/${item.supplier_item_id}/matches`).then((x) => x.json());
      setLinkModal({ item, candidates: r.candidates || [] });
    } catch (e: any) {
      setErr('שגיאה: ' + e.message);
    } finally { setBusy(false); }
  }

  async function confirmLink(clinic_id: number) {
    if (!linkModal?.item.supplier_item_id) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('clinic_item_id', String(clinic_id));
      const resp = await fetch(`${API}/supplier-catalogs/${linkModal.item.supplier_item_id}/link`, {
        method: 'POST', body: fd, headers: { Authorization: authHeaders.Authorization },
      });
      if (!resp.ok) throw new Error(await resp.text());
      setLinkModal(null);
      setInfo('הקישור נשמר');
      await loadCatalog();
    } catch (e: any) {
      setErr('שגיאה: ' + e.message);
    } finally { setBusy(false); }
  }

  async function unlinkItem(supplier_item_id: number) {
    setBusy(true);
    try {
      await apiFetch(`${API}/supplier-catalogs/${supplier_item_id}/link`, { method: 'DELETE' });
      setLinkModal(null);
      await loadCatalog();
    } finally { setBusy(false); }
  }

  async function confirmAutoLink(supplier_item_id: number) {
    setBusy(true);
    try {
      await apiFetch(`${API}/supplier-catalogs/${supplier_item_id}/confirm`, { method: 'POST' });
      await loadCatalog();
    } catch (e: any) {
      setErr('שגיאה: ' + e.message);
    } finally { setBusy(false); }
  }

  async function rejectLink(supplier_item_id: number) {
    setBusy(true);
    try {
      await apiFetch(`${API}/supplier-catalogs/${supplier_item_id}/link`, { method: 'DELETE' });
      await loadCatalog();
    } finally { setBusy(false); }
  }

  async function uploadSupplierCatalog(e: React.ChangeEvent<HTMLInputElement>, supplier: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!supplier) { setErr('בחר ספק לפני העלאה'); return; }
    setBusy(true); setErr(''); setInfo('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('supplier', supplier);
      fd.append('replace', 'true');
      const resp = await fetch(`${API}/supplier-catalogs/upload`, {
        method: 'POST',
        body: fd,
        headers: { Authorization: authHeaders.Authorization },
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setInfo(`הועלו ${data.inserted} פריטים עבור ${data.supplier}`);
      await loadSuppliers();
      await loadCatalog();
    } catch (e: any) {
      setErr('שגיאת העלאה: ' + e.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function useInDeal(item: CatalogItem) {
    const newRow: DealRow = {
      ...EMPTY_ROW,
      item_name: item.item_name,
      sku: item.code || '',
      unit_price: item.price_with_vat ?? item.price_no_vat ?? '',
      regular_unit_price: item.price_with_vat ?? item.price_no_vat,
      shelf_life_months: item.shelf_life_months,
      avg_monthly_sales: item.avg_monthly_sales,
      current_stock: item.current_stock || 0,
    };
    setRows((prev) => {
      const firstEmpty = prev.findIndex((r) => !r.item_name);
      if (firstEmpty >= 0) {
        const copy = [...prev];
        copy[firstEmpty] = newRow;
        return copy;
      }
      return [...prev, newRow];
    });
    setInfo(`נוסף "${item.item_name}" לטבלת המבצע`);
    setTab('table');
  }

  async function loadSessions() {
    try {
      const r = await apiFetch(`${API}/sessions?limit=30`).then((x) => x.json());
      setSessions(r.sessions || []);
    } catch (e: any) {
      setErr('שגיאה בטעינת היסטוריה: ' + e.message);
    }
  }

  async function handleUrl() {
    if (!dealUrl.trim()) { setErr('הזן כתובת URL'); return; }
    setBusy(true); setErr(''); setInfo('');
    try {
      const resp = await apiFetch(`${API}/parse-url`, {
        method: 'POST',
        body: JSON.stringify({ url: dealUrl.trim() }),
      });
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
        setErr('לא נמצאו מבצעים בעמוד' + (data.warnings?.length ? ` (${data.warnings.join(', ')})` : ''));
      } else {
        setRows(parsedRows);
        setTab('table');
        setInfo(`נטענו ${parsedRows.length} שורות מ-URL`);
        setDealUrl('');
      }
    } catch (e: any) {
      setErr('שגיאה: ' + e.message);
    } finally { setBusy(false); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'excel' | 'pdf' | 'image') {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(''); setInfo('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      const resp = await fetch(`${API}/parse`, {
        method: 'POST',
        body: fd,
        headers: { Authorization: authHeaders.Authorization },
      });
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
      const validRows = rows.filter((r) => {
        if (!r.item_name || r.unit_price === '') return false;
        if (r.discount_mode === 'percent') return r.discount_pct != null && r.discount_pct > 0;
        return r.paid_qty !== '';
      });
      if (validRows.length === 0) { setErr('אין שורות תקינות לחישוב'); return; }

      const payload = {
        rows: validRows.map((r) => ({
          item_name: r.item_name,
          sku: r.sku || null,
          unit_price: Number(r.unit_price),
          paid_qty: Number(r.paid_qty || 1),
          bonus_qty: Number(r.bonus_qty || 0),
          bonus_product_value: Number(r.bonus_product_value || 0),
          regular_unit_price: r.regular_unit_price ?? null,
          shelf_life_months: r.shelf_life_months ?? null,
          avg_monthly_sales: r.avg_monthly_sales ?? null,
          current_stock: r.current_stock || 0,
          discount_mode: r.discount_mode || 'bonus',
          discount_pct: r.discount_pct ?? null,
        })),
      };

      const resp = await apiFetch(`${API}/calculate`, {
        method: 'POST',
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
      const resp = await apiFetch(`${API}/save-session`, {
        method: 'POST',
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
      const resp = await apiFetch(`${API}/export`, {
        method: 'POST',
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
            ['catalog', '📚 מחירון'],
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

            <div className="pt-2 border-t">
              <label className="block mb-2 text-sm font-medium text-gray-700">🔗 לינק לדף מבצע (HTML)</label>
              <div className="flex gap-2">
                <input type="url" value={dealUrl} onChange={(e) => setDealUrl(e.target.value)}
                  dir="ltr" placeholder="https://www.zoetis.co.il/deal/..."
                  className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-emerald-500" />
                <button onClick={handleUrl} disabled={busy || !dealUrl.trim()}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? 'טוען...' : 'טען מבצעים'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">הסוכן יוריד את הדף, יחפש טבלאות/מבצעים בפורמט X+Y, ויטען לטבלה.</p>
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
                    <th className="text-right p-2">סוג הנחה</th>
                    <th className="text-right p-2">פורמט / אחוז</th>
                    <th className="text-right p-2">מחיר יחידה ₪</th>
                    <th className="text-right p-2">מחיר רגיל ₪</th>
                    <th className="text-right p-2">שווי בונוס נפרד ₪</th>
                    <th className="text-right p-2">תוקף (חודשים)</th>
                    <th className="text-right p-2">מכירה חודשית</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const mode = r.discount_mode || 'bonus';
                    return (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="p-1"><input className="w-full px-2 py-1 border rounded" value={r.item_name} onChange={(e) => updateRow(i, { item_name: e.target.value })} /></td>
                      <td className="p-1"><input className="w-full px-2 py-1 border rounded" value={r.sku || ''} onChange={(e) => updateRow(i, { sku: e.target.value })} /></td>
                      <td className="p-1">
                        <select value={mode} onChange={(e) => updateRow(i, { discount_mode: e.target.value as 'bonus' | 'percent' })}
                          className="px-2 py-1 border rounded">
                          <option value="bonus">בונוס X+Y</option>
                          <option value="percent">אחוז %</option>
                        </select>
                      </td>
                      <td className="p-1">
                        {mode === 'percent' ? (
                          <input type="number" step="0.1" min="0" max="100" className="w-24 px-2 py-1 border rounded"
                            value={r.discount_pct ?? ''} placeholder="20"
                            onChange={(e) => updateRow(i, { discount_pct: e.target.value === '' ? null : Number(e.target.value) })} />
                        ) : (
                          <input className="w-24 px-2 py-1 border rounded"
                            value={r.deal_format || (r.paid_qty && r.bonus_qty !== '' ? `${r.paid_qty}+${r.bonus_qty}` : '')}
                            onChange={(e) => updateDealFormat(i, e.target.value)} placeholder="4+1" />
                        )}
                      </td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.unit_price} onChange={(e) => updateRow(i, { unit_price: e.target.value === '' ? '' : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.regular_unit_price ?? ''} onChange={(e) => updateRow(i, { regular_unit_price: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-24 px-2 py-1 border rounded" value={r.bonus_product_value} onChange={(e) => updateRow(i, { bonus_product_value: Number(e.target.value) || 0 })} disabled={mode === 'percent'} /></td>
                      <td className="p-1"><input type="number" className="w-20 px-2 py-1 border rounded" value={r.shelf_life_months ?? ''} onChange={(e) => updateRow(i, { shelf_life_months: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><input type="number" step="0.1" className="w-20 px-2 py-1 border rounded" value={r.avg_monthly_sales ?? ''} onChange={(e) => updateRow(i, { avg_monthly_sales: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                      <td className="p-1"><button onClick={() => removeRow(i)} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded">✕</button></td>
                    </tr>
                  );
                  })}
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

        {tab === 'catalog' && (
          <div className="bg-white rounded-xl border p-4">
            <div className="flex gap-2 mb-4">
              <button onClick={() => { setCatalogSource('clinic'); setCatalogCompany(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${catalogSource === 'clinic' ? 'bg-emerald-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                🏥 מחירון מרפאה (1720)
              </button>
              <button onClick={() => { setCatalogSource('suppliers'); setCatalogCompany(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${catalogSource === 'suppliers' ? 'bg-emerald-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                🏭 מחירוני ספקים ({suppliersWithData.length})
              </button>
            </div>

            {catalogSource === 'suppliers' && (
              <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b">
                <button onClick={() => setCatalogCompany('')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catalogCompany === '' ? 'bg-emerald-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                  🔍 כל הספקים
                </button>
                {suppliersWithData.map((s) => (
                  <button key={s} onClick={() => setCatalogCompany(s)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catalogCompany === s ? 'bg-amber-500 text-white' : 'bg-amber-50 hover:bg-amber-100 text-amber-800'}`}>
                    {s}
                  </button>
                ))}
                {suppliers.filter((s) => !suppliersWithData.includes(s)).map((s) => (
                  <button key={s} onClick={() => setCatalogCompany(s)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition border border-dashed ${catalogCompany === s ? 'bg-gray-500 text-white' : 'bg-white hover:bg-gray-50 text-gray-400'}`}
                    title="ללא נתונים — העלה קטלוג">
                    {s} ⬆
                  </button>
                ))}
              </div>
            )}

            {catalogSource === 'clinic' && (
              <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b">
                <button onClick={() => setCatalogCompany('')}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catalogCompany === '' ? 'bg-emerald-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                  🔍 כל הקטגוריות
                </button>
                {companies.map((c) => (
                  <button key={c} onClick={() => setCatalogCompany(c)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${catalogCompany === c ? 'bg-teal-500 text-white' : 'bg-teal-50 hover:bg-teal-100 text-teal-800'}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3 mb-4 items-end flex-wrap">
              <label className="block flex-1 min-w-[200px]">
                <span className="text-sm text-gray-600">{catalogSource === 'suppliers' ? 'ספק' : 'קטגוריה'}</span>
                <select value={catalogCompany} onChange={(e) => setCatalogCompany(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-emerald-500">
                  <option value="">— הכול —</option>
                  {(catalogSource === 'suppliers' ? suppliers : companies).map((c) => (
                    <option key={c} value={c}>{c}{catalogSource === 'suppliers' && suppliersWithData.includes(c) ? ' ✓' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="block flex-1 min-w-[200px]">
                <span className="text-sm text-gray-600">חיפוש מוצר</span>
                <input type="text" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="סימפריקה / נקסגארד..."
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:outline-none focus:border-emerald-500" />
              </label>
              {catalogSource === 'suppliers' && catalogCompany && (
                <label className={`cursor-pointer px-3 py-2 mt-1 border-2 border-dashed rounded-lg text-sm hover:bg-amber-50 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                  📤 העלה קטלוג ל-{catalogCompany}
                  <input type="file" accept=".xlsx,.csv" onChange={(e) => uploadSupplierCatalog(e, catalogCompany)} className="hidden" disabled={busy} />
                </label>
              )}
              {catalogSource === 'suppliers' && (
                <button onClick={runAutoLink} disabled={busy}
                  className="px-3 py-2 mt-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg text-sm font-medium disabled:opacity-50">
                  🔗 התאם למחירון מרפאה
                </button>
              )}
              <div className="text-sm text-gray-500 pb-2">{catalog.length} פריטים</div>
            </div>

            {!catalog.length ? (
              <p className="text-gray-500 text-center py-8">אין פריטים להצגה</p>
            ) : (
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b">
                    <tr>
                      <th className="text-right p-2">מוצר</th>
                      <th className="text-right p-2">חברה</th>
                      <th className="text-right p-2">קטגוריה</th>
                      <th className="text-right p-2">קוד</th>
                      <th className="text-right p-2">מחיר ללא מע"מ</th>
                      <th className="text-right p-2">מחיר כולל</th>
                      {catalogSource === 'suppliers' && <th className="text-right p-2">מקושר למרפאה</th>}
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.map((c) => {
                      const linkBg = c.link_status === 'manual' ? 'bg-blue-50' :
                                     c.link_status === 'auto' && (c.link_score || 0) >= 85 ? 'bg-green-50' :
                                     c.clinic_item_id ? 'bg-yellow-50' :
                                     catalogSource === 'suppliers' ? 'bg-gray-50' : '';
                      return (
                      <tr key={c.id} className={`border-b hover:bg-gray-100 ${linkBg}`}>
                        <td className="p-2 font-medium">{c.item_name}</td>
                        <td className="p-2 text-gray-600">{c.company_name}</td>
                        <td className="p-2 text-gray-500 text-xs">{c.category || '—'}</td>
                        <td className="p-2 text-gray-500 text-xs">{c.code || '—'}</td>
                        <td className="p-2">{c.price_no_vat !== null ? `₪${c.price_no_vat}` : '—'}</td>
                        <td className="p-2 font-medium">{c.price_with_vat !== null ? `₪${c.price_with_vat}` : '—'}</td>
                        {catalogSource === 'suppliers' && (
                          <td className="p-2 text-xs">
                            {c.linked_clinic_name ? (
                              <span>
                                {c.link_status === 'manual' ? '👤' : c.link_status === 'confirmed' ? '✔️' : '🤖'} {c.linked_clinic_name}
                                {c.link_score && <span className="text-gray-400 mr-1">({c.link_score}%)</span>}
                              </span>
                            ) : (
                              <span className="text-gray-400">❌ לא מקושר</span>
                            )}
                          </td>
                        )}
                        <td className="p-1 flex gap-1 flex-wrap">
                          <button onClick={() => useInDeal(c)}
                            className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded text-xs whitespace-nowrap">
                            ➕ למבצע
                          </button>
                          {catalogSource === 'suppliers' && c.supplier_item_id && (
                            <>
                              {c.link_status === 'auto' && c.clinic_item_id && (
                                <>
                                  <button onClick={() => confirmAutoLink(c.supplier_item_id!)} disabled={busy}
                                    title="אשר קישור — לא יוחלף בריצות עתידיות"
                                    className="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-xs whitespace-nowrap">
                                    ✓ אשר
                                  </button>
                                  <button onClick={() => rejectLink(c.supplier_item_id!)} disabled={busy}
                                    title="דחה והסר קישור"
                                    className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-xs whitespace-nowrap">
                                    ✕ דחה
                                  </button>
                                </>
                              )}
                              <button onClick={() => openLinkModal(c)}
                                className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded text-xs whitespace-nowrap">
                                🔗 {c.clinic_item_id ? 'שנה' : 'קשר'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
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

        {linkModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setLinkModal(null)}>
            <div className="bg-white rounded-xl border shadow-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-1">קישור למחירון מרפאה</h2>
              <p className="text-sm text-gray-600 mb-4">{linkModal.item.company_name} · {linkModal.item.item_name}</p>

              {linkModal.item.clinic_item_id && (
                <div className="mb-3 p-3 bg-blue-50 rounded-lg flex items-center justify-between">
                  <span className="text-sm">כרגע מקושר: <b>{linkModal.item.linked_clinic_name}</b></span>
                  <button onClick={() => unlinkItem(linkModal.item.supplier_item_id!)}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs">
                    ✕ הסר קישור
                  </button>
                </div>
              )}

              <div className="text-sm font-medium mb-2">מועמדים מובילים:</div>
              {linkModal.candidates.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">לא נמצאו מועמדים</p>
              ) : (
                <div className="space-y-2">
                  {linkModal.candidates.map((c) => (
                    <button key={c.clinic_id} onClick={() => confirmLink(c.clinic_id)}
                      className="w-full text-right p-3 border rounded-lg hover:bg-emerald-50 hover:border-emerald-300 flex items-center justify-between">
                      <span className={`text-xs px-2 py-1 rounded ${c.score >= 85 ? 'bg-green-100 text-green-800' : c.score >= 65 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>
                        {c.score.toFixed(0)}%
                      </span>
                      <span className="font-medium">{c.clinic_name}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end mt-4">
                <button onClick={() => setLinkModal(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">סגור</button>
              </div>
            </div>
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
