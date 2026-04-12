import { apiFetch } from '../api';
import { useState, useEffect } from 'react';
import AgentStackPanel from '../components/AgentStackPanel';

const API_BASE = `http://${window.location.hostname}:3002`;

interface FilteredClient {
  user_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  cell_phone: string;
  pet_id: number;
  pet_name: string;
  species: string;
  breed: string;
  age_years: number | null;
  insurance_name: string;
  last_visit: string | null;
  weight: number;
}

interface FilterSummary {
  totalClients: number;
  uniquePhones: number;
  dogs: number;
  cats: number;
  other: number;
  withInsurance: number;
  avgAge: number | null;
}

interface SendResult {
  sent: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}

const TEMPLATES: Record<string, { name: string; text: string }> = {
  'vaccination-reminder': {
    name: 'תזכורת חיסון שנתי',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nרצינו להזכיר שהגיע הזמן לחיסון השנתי של {שם_חיה}.\nנשמח לקבוע תור בטלפון 09-7408611.\nצוות המרפאה 💙',
  },
  'senior-checkup': {
    name: 'בדיקת דם לחיות מבוגרות',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\n{שם_חיה} כבר בגיל {גיל} ואנחנו ממליצים על בדיקת דם תקופתית לוודא שהכל תקין.\nלקביעת תור: 09-7408611\nצוות המרפאה 💙',
  },
  'missing-clients': {
    name: 'לקוחות שלא ביקרו',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nשמנו לב שלא ביקרתם אצלנו כבר תקופה.\nנשמח לראות את {שם_חיה} ולוודא שהכל בסדר.\nלקביעת תור: 09-7408611 💙',
  },
  'insurance-promo': {
    name: 'קידום ביטוח',
    text: 'שלום {שם} 🐾\nמהמרכז לרפואה וטרינרית ד"ר גיל קרן.\nידעת שביטוח בריאות לחיות מחמד יכול לחסוך אלפי שקלים?\nנשמח לספר ל{שם_חיה} על האפשרויות.\nלפרטים: 09-7408611 💙',
  },
  'custom': {
    name: 'הודעה מותאמת אישית',
    text: '',
  },
};

const INSURANCE_OPTIONS = ['מרפאט', 'חיותא', 'פניקס', 'הפניקס', 'בי פרנד', 'ליברה'];

export default function PetConnect() {
  // Filter state
  const [species, setSpecies] = useState('all');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [breed, setBreed] = useState('');
  const [hasInsurance, setHasInsurance] = useState('all');
  const [insuranceName, setInsuranceName] = useState('');
  const [daysSinceVisit, setDaysSinceVisit] = useState('');
  const [lastVisitBefore, setLastVisitBefore] = useState('');
  const [lastVisitAfter, setLastVisitAfter] = useState('');

  // Message state
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageText, setMessageText] = useState('');
  const [approvalMode, setApprovalMode] = useState<'preview' | 'direct' | 'individual'>('preview');

  // Results state
  const [clients, setClients] = useState<FilteredClient[]>([]);
  const [summary, setSummary] = useState<FilterSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [previewMessage, setPreviewMessage] = useState('');

  // Breeds list
  const [breedOptions, setBreedOptions] = useState<string[]>([]);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/breeds`).then(r => r.json()).then(setBreedOptions).catch(() => {});
  }, []);

  function buildFilters() {
    const filters: any = {};
    if (species !== 'all') filters.species = species;
    if (minAge) filters.minAge = parseInt(minAge);
    if (maxAge) filters.maxAge = parseInt(maxAge);
    if (breed) filters.breed = breed;
    if (hasInsurance === 'yes') filters.hasInsurance = true;
    if (hasInsurance === 'no') filters.hasInsurance = false;
    if (insuranceName) filters.insuranceName = insuranceName;
    if (daysSinceVisit) filters.daysSinceLastVisit = parseInt(daysSinceVisit);
    if (lastVisitBefore) filters.lastVisitBefore = lastVisitBefore;
    if (lastVisitAfter) filters.lastVisitAfter = lastVisitAfter;
    return filters;
  }

  async function handleFilter() {
    setLoading(true);
    setSendResult(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: buildFilters() }),
      });
      const data = await res.json();
      setClients(data.clients || []);
      setSummary(data.summary || null);
    } catch (e) {
      alert('שגיאה בסינון: ' + e);
    }
    setLoading(false);
  }

  async function handleSend(dryRun: boolean) {
    if (!messageText && selectedTemplate === 'custom') {
      alert('נא לכתוב הודעה');
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: buildFilters(),
          message: messageText || TEMPLATES[selectedTemplate]?.text || '',
          category: selectedTemplate || 'custom',
          dryRun,
        }),
      });
      const data = await res.json();
      setSendResult(data);
    } catch (e) {
      alert('שגיאה בשליחה: ' + e);
    }
    setSending(false);
  }

  function handleTemplateChange(key: string) {
    setSelectedTemplate(key);
    if (key !== 'custom') {
      setMessageText(TEMPLATES[key]?.text || '');
    } else {
      setMessageText('');
    }
  }

  // Preview personalized message for first client
  useEffect(() => {
    if (clients.length > 0 && messageText) {
      const c = clients[0];
      let msg = messageText
        .replace(/\{שם_בעלים\}/g, c.full_name)
        .replace(/\{שם\}/g, c.first_name || c.full_name?.split(' ')[0] || '')
        .replace(/\{שם_חיה\}/g, c.pet_name || '')
        .replace(/\{גזע\}/g, c.breed || '')
        .replace(/\{סוג\}/g, c.species || '')
        .replace(/\{גיל\}/g, c.age_years?.toString() || '')
        .replace(/\{ביטוח\}/g, c.insurance_name || '');
      setPreviewMessage(msg);
    }
  }, [clients, messageText]);

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-3xl">📱</span> פטקונקט
          </h1>
          <p className="text-sm text-gray-500">שליחת הודעות WhatsApp ללקוחות המרפאה</p>
        </div>
      <AgentStackPanel agentName={'petconnect'} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2">🔍 סינון לקוחות</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">

          {/* Species */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">סוג חיה</label>
            <select value={species} onChange={e => setSpecies(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="all">הכל</option>
              <option value="dog">🐕 כלב</option>
              <option value="cat">🐈 חתול</option>
            </select>
          </div>

          {/* Age */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">גיל (שנים)</label>
            <div className="flex gap-2">
              <input type="number" placeholder="מ-" value={minAge} onChange={e => setMinAge(e.target.value)}
                className="w-1/2 border rounded-lg px-2 py-2 text-sm" min="0" max="25" />
              <input type="number" placeholder="עד" value={maxAge} onChange={e => setMaxAge(e.target.value)}
                className="w-1/2 border rounded-lg px-2 py-2 text-sm" min="0" max="25" />
            </div>
          </div>

          {/* Breed */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">גזע</label>
            <input type="text" placeholder="חפש גזע..." value={breed} onChange={e => setBreed(e.target.value)}
              list="breed-list" className="w-full border rounded-lg px-3 py-2 text-sm" />
            <datalist id="breed-list">
              {breedOptions.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>

          {/* Insurance */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">ביטוח</label>
            <select value={hasInsurance} onChange={e => setHasInsurance(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="all">הכל</option>
              <option value="yes">יש ביטוח</option>
              <option value="no">אין ביטוח</option>
            </select>
          </div>

          {/* Insurance company */}
          {hasInsurance === 'yes' && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">חברת ביטוח</label>
              <select value={insuranceName} onChange={e => setInsuranceName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">הכל</option>
                {INSURANCE_OPTIONS.map(ins => <option key={ins} value={ins}>{ins}</option>)}
              </select>
            </div>
          )}

          {/* Days since visit */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">ימים מביקור אחרון</label>
            <input type="number" placeholder="לפחות X ימים" value={daysSinceVisit}
              onChange={e => setDaysSinceVisit(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" min="0" />
          </div>

          {/* Last visit range */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">ביקור אחרון מ-</label>
            <input type="date" value={lastVisitAfter} onChange={e => setLastVisitAfter(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">ביקור אחרון עד</label>
            <input type="date" value={lastVisitBefore} onChange={e => setLastVisitBefore(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={handleFilter} disabled={loading}
          className="mt-4 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 transition">
          {loading ? '🔄 מסנן...' : '🔍 סנן לקוחות'}
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="bg-gradient-to-l from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-5">
          <h2 className="font-bold text-lg mb-3 text-emerald-800">📊 תוצאות סינון</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-center">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-emerald-700">{summary.totalClients}</div>
              <div className="text-xs text-gray-500">סה"כ</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-blue-600">{summary.uniquePhones}</div>
              <div className="text-xs text-gray-500">טלפונים</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-amber-600">{summary.dogs}</div>
              <div className="text-xs text-gray-500">🐕 כלבים</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-purple-600">{summary.cats}</div>
              <div className="text-xs text-gray-500">🐈 חתולים</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-gray-600">{summary.other}</div>
              <div className="text-xs text-gray-500">אחר</div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-2xl font-bold text-teal-600">{summary.withInsurance}</div>
              <div className="text-xs text-gray-500">עם ביטוח</div>
            </div>
            {summary.avgAge && (
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="text-2xl font-bold text-orange-600">{summary.avgAge}</div>
                <div className="text-xs text-gray-500">גיל ממוצע</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Client list */}
      {clients.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold text-lg mb-3">👥 רשימת לקוחות ({clients.length})</h2>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-right px-3 py-2">שם בעלים</th>
                  <th className="text-right px-3 py-2">חיה</th>
                  <th className="text-right px-3 py-2">סוג</th>
                  <th className="text-right px-3 py-2">גזע</th>
                  <th className="text-right px-3 py-2">גיל</th>
                  <th className="text-right px-3 py-2">ביטוח</th>
                  <th className="text-right px-3 py-2">ביקור אחרון</th>
                  <th className="text-right px-3 py-2">טלפון</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => (
                  <tr key={`${c.user_id}-${c.pet_id}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium">{c.full_name}</td>
                    <td className="px-3 py-2">{c.pet_name}</td>
                    <td className="px-3 py-2">{c.species === 'כלב' ? '🐕' : c.species === 'חתול' ? '🐈' : '🐾'} {c.species}</td>
                    <td className="px-3 py-2">{c.breed || '-'}</td>
                    <td className="px-3 py-2">{c.age_years ?? '-'}</td>
                    <td className="px-3 py-2">{c.insurance_name || '-'}</td>
                    <td className="px-3 py-2">{c.last_visit || '-'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.cell_phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Message Composer */}
      {clients.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">✉️ הודעה</h2>

          {/* Template selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-600 mb-1">בחר תבנית</label>
            <select value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">— בחר תבנית —</option>
              {Object.entries(TEMPLATES).map(([key, tmpl]) => (
                <option key={key} value={key}>{tmpl.name}</option>
              ))}
            </select>
          </div>

          {/* Message editor */}
          {selectedTemplate && (
            <>
              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  תוכן ההודעה
                  <span className="text-xs text-gray-400 mr-2">
                    פלייסהולדרים: {'{שם}'} {'{שם_חיה}'} {'{גזע}'} {'{גיל}'} {'{ביטוח}'}
                  </span>
                </label>
                <textarea value={messageText} onChange={e => setMessageText(e.target.value)}
                  rows={5} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" dir="rtl" />
              </div>

              {/* Preview */}
              {previewMessage && (
                <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs text-green-600 mb-1 font-medium">תצוגה מקדימה (ללקוח הראשון):</div>
                  <div className="text-sm whitespace-pre-wrap">{previewMessage}</div>
                </div>
              )}

              {/* Approval mode */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-1">מצב אישור</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name="approval" value="preview" checked={approvalMode === 'preview'}
                      onChange={() => setApprovalMode('preview')} />
                    תצוגה מקדימה
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name="approval" value="direct" checked={approvalMode === 'direct'}
                      onChange={() => setApprovalMode('direct')} />
                    שליחה ישירה
                  </label>
                </div>
              </div>

              {/* Send buttons */}
              <div className="flex gap-3">
                <button onClick={() => handleSend(true)} disabled={sending}
                  className="px-5 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 transition">
                  {sending ? '🔄' : '🧪'} הרצת ניסיון (Dry Run)
                </button>
                <button onClick={() => handleSend(false)} disabled={sending}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 transition">
                  {sending ? '🔄' : '📤'} שלח {clients.length} הודעות
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Send Results */}
      {sendResult && (
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="font-bold text-lg mb-3">📊 תוצאות שליחה</h2>
          <div className="grid grid-cols-3 gap-4 text-center mb-4">
            <div className="bg-emerald-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-emerald-700">{sendResult.sent}</div>
              <div className="text-xs text-gray-500">נשלחו</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-amber-700">{sendResult.skipped}</div>
              <div className="text-xs text-gray-500">דולגו</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-red-700">{sendResult.failed}</div>
              <div className="text-xs text-gray-500">נכשלו</div>
            </div>
          </div>
          {Object.keys(sendResult.reasons).length > 0 && (
            <div className="text-sm text-gray-600">
              <strong>סיבות דילוג:</strong>
              {Object.entries(sendResult.reasons).map(([reason, count]) => (
                <span key={reason} className="mr-3">{reason}: {count}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
