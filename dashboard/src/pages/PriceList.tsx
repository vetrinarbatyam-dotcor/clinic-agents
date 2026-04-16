import { apiFetch } from '../api';
import { useEffect, useState } from 'react';

const API = `http://${window.location.hostname}:3003`;

interface CatalogItem {
  id: number;
  name: string;
  category: string;
  price: number;
  field_id: number;
  full_path: string;
  updated_at: string;
}

interface TopSeller {
  item_name: string;
  times_sold: number;
  total_quantity: number;
  total_revenue: number;
  avg_price: number;
  first_sold: string;
  last_sold: string;
}

interface PeriodSeller {
  item_name: string;
  field_id: number;
  times_sold: number;
  total_quantity: number;
  total_revenue: number;
  avg_price: number;
  times_sold_prev: number;
  total_quantity_prev: number;
  total_revenue_prev: number;
  quantity_diff: number;
  quantity_diff_pct: number | null;
  revenue_diff: number;
  revenue_diff_pct: number | null;
}

type Period = 'all' | '1m' | '3m' | '6m' | '12m';

interface PriceChange {
  item_name: string;
  field_id: number;
  old_price: number;
  new_price: number;
  change_amount: number;
  change_pct: number;
  changed_by: string;
  changed_at: string;
}

interface PriceStats {
  total_items: number;
  with_names: number;
  with_prices: number;
  categories: number;
  last_sync: string;
  price_changes: number;
}

export default function PriceList() {
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [topSellers, setTopSellers] = useState<TopSeller[]>([]);
  const [periodSellers, setPeriodSellers] = useState<PeriodSeller[]>([]);
  const [period, setPeriod] = useState<Period>('1m');
  const [periodLoading, setPeriodLoading] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceChange[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'catalog' | 'top' | 'history'>('catalog');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    loadTopSellers();
    loadHistory();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.length >= 2) loadItems(search);
      else if (search === '') loadItems('');
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function loadStats() {
    try {
      const r = await apiFetch(`${API}/api/prices/stats`);
      const d = await r.json();
      setStats(d);
    } catch {}
  }

  async function loadItems(q: string) {
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/api/prices/catalog?search=${encodeURIComponent(q)}&limit=100`);
      const d = await r.json();
      setItems(d);
    } catch {}
    setLoading(false);
  }

  async function loadTopSellers() {
    try {
      const r = await apiFetch(`${API}/api/prices/top-sellers?limit=25`);
      const d = await r.json();
      setTopSellers(d);
    } catch {}
  }

  async function loadHistory() {
    try {
      const r = await apiFetch(`${API}/api/prices/history?limit=50`);
      const d = await r.json();
      setPriceHistory(d);
    } catch {}
  }

  useEffect(() => {
    if (period === 'all') return;
    loadPeriodSellers(period);
  }, [period]);

  async function loadPeriodSellers(p: Period) {
    if (p === 'all') return;
    setPeriodLoading(true);
    try {
      const r = await apiFetch(`${API}/api/prices/top-sellers-by-period?period=${p}&limit=100`);
      const d = await r.json();
      setPeriodSellers(d.rows || []);
    } catch {}
    setPeriodLoading(false);
  }

  const fmt = (n: number) => new Intl.NumberFormat('he-IL').format(Math.round(n));

  return (
    <div className="max-w-6xl mx-auto p-4" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">💰</span>
        <div>
          <h1 className="text-2xl font-bold">מחירון המרפאה</h1>
          <p className="text-sm text-gray-500">ניהול מחירים, מכירות והיסטוריית שינויים</p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          <StatCard label="פריטים במחירון" value={fmt(stats.total_items)} color="blue" />
          <StatCard label="עם שמות" value={fmt(stats.with_names)} color="green" />
          <StatCard label="עם מחירים" value={fmt(stats.with_prices)} color="emerald" />
          <StatCard label="קטגוריות" value={fmt(stats.categories)} color="purple" />
          <StatCard label="שינויי מחיר" value={fmt(stats.price_changes)} color="orange" />
          <StatCard label="סנכרון אחרון" value={stats.last_sync ? new Date(stats.last_sync).toLocaleDateString('he-IL') : '-'} color="gray" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        {(['catalog', 'top', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'catalog' ? '📋 מחירון' : t === 'top' ? '🏆 הנמכרים ביותר' : '📊 היסטוריית מחירים'}
          </button>
        ))}
      </div>

      {/* Catalog Tab */}
      {tab === 'catalog' && (
        <div>
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חפש פריט... (למשל: סימפריקה, בדיקה, חיסון)"
              className="w-full md:w-96 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {loading ? (
            <p className="text-gray-500">טוען...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-right p-2 border-b font-medium">שם פריט</th>
                    <th className="text-right p-2 border-b font-medium">קטגוריה</th>
                    <th className="text-left p-2 border-b font-medium">מחיר</th>
                    <th className="text-left p-2 border-b font-medium">Field ID</th>
                    <th className="text-left p-2 border-b font-medium">עדכון</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50 border-b">
                      <td className="p-2 font-medium">{item.name || <span className="text-gray-400">ללא שם</span>}</td>
                      <td className="p-2 text-gray-600">{item.category}</td>
                      <td className="p-2 text-left font-mono">{item.price > 0 ? `${fmt(item.price)} ₪` : '-'}</td>
                      <td className="p-2 text-left text-gray-400 text-xs">{item.field_id}</td>
                      <td className="p-2 text-left text-gray-400 text-xs">{item.updated_at ? new Date(item.updated_at).toLocaleDateString('he-IL') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-2">{items.length} פריטים מוצגים</p>
            </div>
          )}
        </div>
      )}

      {/* Top Sellers Tab */}
      {tab === 'top' && (
        <div>
          {/* Period selector */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {([
              { k: '1m',  label: 'חודש אחרון' },
              { k: '3m',  label: '3 חודשים' },
              { k: '6m',  label: '6 חודשים' },
              { k: '12m', label: 'שנה אחרונה' },
              { k: 'all', label: 'כל הזמן' },
            ] as { k: Period; label: string }[]).map(p => (
              <button
                key={p.k}
                onClick={() => setPeriod(p.k)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  period === p.k
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
            {period !== 'all' && (
              <span className="text-xs text-gray-400 self-center mr-2">
                השוואה לתקופה המקבילה הקודמת
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            {period === 'all' ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-right p-2 border-b font-medium">#</th>
                    <th className="text-right p-2 border-b font-medium">פריט</th>
                    <th className="text-left p-2 border-b font-medium">פעמים</th>
                    <th className="text-left p-2 border-b font-medium">כמות</th>
                    <th className="text-left p-2 border-b font-medium">הכנסה</th>
                    <th className="text-left p-2 border-b font-medium">מחיר ממוצע</th>
                    <th className="text-left p-2 border-b font-medium">מכירה אחרונה</th>
                  </tr>
                </thead>
                <tbody>
                  {topSellers.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50 border-b">
                      <td className="p-2 text-gray-400">{i + 1}</td>
                      <td className="p-2 font-medium">{s.item_name}</td>
                      <td className="p-2 text-left font-mono">{fmt(s.times_sold)}</td>
                      <td className="p-2 text-left font-mono">{fmt(s.total_quantity)}</td>
                      <td className="p-2 text-left font-mono font-bold text-emerald-700">{fmt(s.total_revenue)} ₪</td>
                      <td className="p-2 text-left font-mono">{fmt(s.avg_price)} ₪</td>
                      <td className="p-2 text-left text-xs text-gray-500">{s.last_sold ? new Date(s.last_sold).toLocaleDateString('he-IL') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : periodLoading ? (
              <p className="text-gray-500">טוען...</p>
            ) : periodSellers.length === 0 ? (
              <p className="text-gray-500 p-4">אין מכירות בתקופה זו</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-right p-2 border-b font-medium">#</th>
                    <th className="text-right p-2 border-b font-medium">פריט</th>
                    <th className="text-left p-2 border-b font-medium">יחידות</th>
                    <th className="text-left p-2 border-b font-medium">יחידות קודם</th>
                    <th className="text-left p-2 border-b font-medium">הפרש יחידות</th>
                    <th className="text-left p-2 border-b font-medium">הכנסה</th>
                    <th className="text-left p-2 border-b font-medium">הכנסה קודם</th>
                    <th className="text-left p-2 border-b font-medium">הפרש הכנסה</th>
                    <th className="text-left p-2 border-b font-medium">מחיר ממוצע</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSellers.map((s, i) => {
                    const qUp = s.quantity_diff > 0;
                    const qDown = s.quantity_diff < 0;
                    const rUp = s.revenue_diff > 0;
                    const rDown = s.revenue_diff < 0;
                    return (
                      <tr key={i} className="hover:bg-gray-50 border-b">
                        <td className="p-2 text-gray-400">{i + 1}</td>
                        <td className="p-2 font-medium">{s.item_name}</td>
                        <td className="p-2 text-left font-mono">{fmt(s.total_quantity)}</td>
                        <td className="p-2 text-left font-mono text-gray-500">{fmt(s.total_quantity_prev)}</td>
                        <td className={`p-2 text-left font-mono font-bold ${qUp ? 'text-emerald-700' : qDown ? 'text-red-600' : 'text-gray-400'}`}>
                          {qUp ? '▲' : qDown ? '▼' : '•'} {fmt(Math.abs(s.quantity_diff))}
                          {s.quantity_diff_pct !== null && (
                            <span className="text-xs font-normal mr-1">({qUp ? '+' : ''}{s.quantity_diff_pct}%)</span>
                          )}
                        </td>
                        <td className="p-2 text-left font-mono font-bold text-emerald-700">{fmt(s.total_revenue)} ₪</td>
                        <td className="p-2 text-left font-mono text-gray-500">{fmt(s.total_revenue_prev)} ₪</td>
                        <td className={`p-2 text-left font-mono font-bold ${rUp ? 'text-emerald-700' : rDown ? 'text-red-600' : 'text-gray-400'}`}>
                          {rUp ? '▲' : rDown ? '▼' : '•'} {fmt(Math.abs(s.revenue_diff))} ₪
                          {s.revenue_diff_pct !== null && (
                            <span className="text-xs font-normal mr-1">({rUp ? '+' : ''}{s.revenue_diff_pct}%)</span>
                          )}
                        </td>
                        <td className="p-2 text-left font-mono">{fmt(s.avg_price)} ₪</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Price History Tab */}
      {tab === 'history' && (
        <div className="overflow-x-auto">
          {priceHistory.length === 0 ? (
            <p className="text-gray-500 p-4">אין שינויי מחיר עדיין (רק סנכרון ראשוני)</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-right p-2 border-b font-medium">פריט</th>
                  <th className="text-left p-2 border-b font-medium">מחיר ישן</th>
                  <th className="text-left p-2 border-b font-medium">מחיר חדש</th>
                  <th className="text-left p-2 border-b font-medium">שינוי</th>
                  <th className="text-left p-2 border-b font-medium">%</th>
                  <th className="text-left p-2 border-b font-medium">ע"י</th>
                  <th className="text-left p-2 border-b font-medium">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.filter(h => h.old_price !== null).map((h, i) => (
                  <tr key={i} className="hover:bg-gray-50 border-b">
                    <td className="p-2 font-medium">{h.item_name}</td>
                    <td className="p-2 text-left font-mono">{fmt(h.old_price)} ₪</td>
                    <td className="p-2 text-left font-mono">{fmt(h.new_price)} ₪</td>
                    <td className={`p-2 text-left font-mono font-bold ${h.change_amount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {h.change_amount > 0 ? '+' : ''}{fmt(h.change_amount)} ₪
                    </td>
                    <td className="p-2 text-left text-xs">{h.change_pct != null ? `${h.change_pct}%` : ''}</td>
                    <td className="p-2 text-left text-xs text-gray-500">{h.changed_by}</td>
                    <td className="p-2 text-left text-xs text-gray-500">{new Date(h.changed_at).toLocaleDateString('he-IL')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color] || colors.gray}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
    </div>
  );
}
