import { useEffect, useState } from 'react';
import AgentStackPanel from '../components/AgentStackPanel';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';

interface Agent {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  cron_schedule: string;
  config: any;
}

interface Template {
  id: string;
  agent_id: string;
  category: string;
  template_text: string;
  is_active: boolean;
}

const categoryLabels: Record<string, string> = {
  medical: '🏥 מקרה רפואי',
  'new-client': '🆕 לקוח חדש',
  surgery: '🔪 ניתוח',
  'vaccine-expired': '💉 חיסון שפג',
  'deep-scan': '🔍 חיפוש מיוחד',
};

const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'sms', label: 'SMS', icon: '📱' },
  { value: 'whatsapp+sms', label: 'WhatsApp + SMS fallback', icon: '💬📱' },
];

const MESSAGE_MODE_OPTIONS = [
  { value: 'templates', label: 'תבניות בלבד', desc: 'הודעה קבועה לפי סוג' },
  { value: 'ai', label: 'AI בלבד', desc: 'Claude מחבר הודעה מותאמת' },
  { value: 'templates+ai', label: 'תבניות + AI', desc: 'תבנית בסיס + העשרה אישית' },
];

const APPROVAL_OPTIONS = [
  { value: 'all', label: 'הכל דורש אישור', desc: 'כל ההודעות ממתינות לאישור בדשבורד', icon: '🔒' },
  { value: 'auto', label: 'הכל אוטומטי', desc: 'כל ההודעות נשלחות בלי אישור', icon: '🚀' },
];

const TIME_PRESETS = [
  { value: '0 8 * * *', label: '08:00' },
  { value: '0 9 * * *', label: '09:00' },
  { value: '45 9 * * *', label: '09:45' },
  { value: '0 10 * * *', label: '10:00' },
  { value: '30 10 * * *', label: '10:30' },
  { value: '0 10 * * 0', label: '10:00 (ראשון)' },
];

export default function AgentConfig() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saved, setSaved] = useState(false);
  const [customCron, setCustomCron] = useState(false);
  const [showLogic, setShowLogic] = useState(false);

  useEffect(() => { loadData(); }, [agentId]);

  async function loadData() {
    const { data: a } = await supabase.from('agents').select('*').eq('id', agentId).single();
    if (a) {
      setAgent(a);
      setCustomCron(!TIME_PRESETS.some(p => p.value === a.cron_schedule));
    }
    const { data: t } = await supabase.from('agent_templates').select('*').eq('agent_id', agentId);
    if (t) setTemplates(t);
  }

  async function updateAgent(updates: Partial<Agent>) {
    await supabase.from('agents').update(updates).eq('id', agentId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    loadData();
  }

  function updateConfig(key: string, value: any) {
    if (!agent) return;
    const config = { ...agent.config, [key]: value };
    updateAgent({ config });
  }

  async function saveTemplate(id: string) {
    await supabase.from('agent_templates').update({ template_text: editText }).eq('id', id);
    setEditingTemplate(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    loadData();
  }

  if (!agent) return <div className="text-center py-20 text-gray-400">טוען...</div>;

  const config = agent.config || {};
  const isRemindAgent = agent.name === 'remind-agent';
  const isFollowupAgent = agent.name === 'followup-agents';

  const templatePlaceholders = isRemindAgent
    ? ['{ownerName}', '{petName}', '{vaccineType}', '{lastDate}', '{vaccineList}']
    : ['{ownerName}', '{petName}', '{aiPersonalNote}'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-2xl font-bold">הגדרות: {agent.display_name}</h1>
        </div>
      <AgentStackPanel agentName={agent.name} />
        {saved && (
          <span className="text-emerald-600 text-sm font-medium bg-emerald-50 px-3 py-1 rounded-full animate-pulse">✓ נשמר</span>
        )}
      </div>

      {/* REMIND-AGENT: Vaccine Logic */}
      {isRemindAgent && (
        <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-lg">💉 לוגיקת תזכורות חיסונים</h2>
            <button onClick={() => setShowLogic(!showLogic)} className="text-sm text-emerald-600 hover:text-emerald-700">
              {showLogic ? 'הסתר' : 'הצג פירוט'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-3">איך הסוכן מזהה חיסונים שפגו ולמי לשלוח</p>

          <div className="grid gap-3 md:grid-cols-3 mb-3">
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
              <div className="font-medium text-purple-800 mb-1">📋 מצב רגיל</div>
              <div className="text-xs text-purple-700">מאחרים מעל שבועיים — שנה אחורה</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <div className="font-medium text-amber-800 mb-1">🔍 חיפוש מיוחד</div>
              <div className="text-xs text-amber-700">סריקה עמוקה — 3+ שנים, מעל חודש</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <div className="font-medium text-emerald-800 mb-1">🤖 מקור נתונים</div>
              <div className="text-xs text-emerald-700">GetVaccineLaters API — רשימה מוכנה</div>
            </div>
          </div>

          {showLogic && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-4">
              <div>
                <div className="font-bold text-purple-600 mb-2">📋 מצב רגיל (שבועי)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>שולף את כל החיסונים שפג תוקפם בשנה האחרונה</li>
                  <li>מסנן: רק עם טלפון, לא מאושרים, בלי תור קיים</li>
                  <li>מאחד לפי בעלים (כמה חיות = הודעה אחת)</li>
                  <li>סוגי חיסונים: כלבת, משושה, מרובע, תילוע, תולעת הפארק, סימפריקה</li>
                </ul>
              </div>
              <div>
                <div className="font-bold text-amber-600 mb-2">🔍 חיפוש מיוחד (ידני)</div>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  <li>סורק {config.deepScanYears || 3} שנים אחורה</li>
                  <li>רק מי שפג מעל {config.minMonthsExpired || 3} חודשים</li>
                  <li>{config.onlyMandatory ? 'רק חיסוני חובה' : 'כל החיסונים'}</li>
                  <li>{config.excludeWithAppointment !== false ? 'מדלג על מי שכבר קבע תור' : 'כולל גם מי שקבע תור'}</li>
                  <li>הפעלה ידנית: <code className="bg-gray-200 px-1 rounded">bun run remind:deep</code></li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FOLLOWUP-AGENT: Visit Classification */}
      {isFollowupAgent && (
        <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-lg">🧠 לוגיקת סיווג ביקורים</h2>
            <button onClick={() => setShowLogic(!showLogic)} className="text-sm text-emerald-600 hover:text-emerald-700">
              {showLogic ? 'הסתר' : 'הצג פירוט'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-3">איך הסוכן מחליט למי לשלוח פולואפ</p>
          <div className="grid gap-3 md:grid-cols-3 mb-3">
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
              <div className="font-medium text-emerald-800 mb-1">✅ שולח פולואפ</div>
              <div className="text-xs text-emerald-700">ביקור רפואי, ניתוח, לקוח חדש/גור</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 border border-red-200">
              <div className="font-medium text-red-800 mb-1">❌ לא שולח</div>
              <div className="text-xs text-red-700">חיסונים, מוצרים, מזון, תרופות בלבד</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <div className="font-medium text-amber-800 mb-1">⏰ תזמון מיוחד</div>
              <div className="text-xs text-amber-700">שבת/חג = דחייה ליום חול, ניתוח = למחרת</div>
            </div>
          </div>
          {showLogic && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-3">
              <div><span className="font-bold text-emerald-700">🏥 רפואי:</span> ממצאים/הוראות בביקור, או פריטים רפואיים</div>
              <div><span className="font-bold text-red-600">🔪 ניתוח:</span> ניתוח/סירוס/עיקור/כריתה → למחרת</div>
              <div><span className="font-bold text-blue-600">🆕 חדש:</span> חיסון ראשון, גור, תיק חדש</div>
              <div><span className="font-bold text-gray-500">⏭️ דילוג:</span> חיסון שגרתי, מוצרים, אין טלפון</div>
            </div>
          )}
        </div>
      )}

      {/* General Settings */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-4">כללי</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">שם הסוכן</label>
            <input
              value={agent.display_name}
              onChange={e => setAgent({ ...agent, display_name: e.target.value })}
              onBlur={() => updateAgent({ display_name: agent.display_name })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">סטטוס</label>
            <button
              onClick={() => updateAgent({ is_active: !agent.is_active })}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                agent.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {agent.is_active ? '✓ פעיל' : '✗ כבוי'}
            </button>
          </div>
        </div>
      </div>

      {/* Send Time */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">שעת שליחה</h2>
        <p className="text-sm text-gray-400 mb-4">{isRemindAgent ? 'מתי לסרוק חיסונים ולשלוח תזכורות?' : 'באיזו שעה לשלוח כל בוקר?'}</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {TIME_PRESETS.map(t => (
            <button
              key={t.value}
              onClick={() => { setCustomCron(false); updateAgent({ cron_schedule: t.value }); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !customCron && agent.cron_schedule === t.value ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => setCustomCron(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${customCron ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            מותאם
          </button>
        </div>
        {customCron && (
          <input
            value={agent.cron_schedule}
            onChange={e => setAgent({ ...agent, cron_schedule: e.target.value })}
            onBlur={() => updateAgent({ cron_schedule: agent.cron_schedule })}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" dir="ltr"
            placeholder="0 10 * * 0"
          />
        )}
      </div>

      {/* REMIND-AGENT: Deep Scan Parameters */}
      {isRemindAgent && (
        <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
          <h2 className="font-bold text-lg mb-2">🔍 כיוונון חיפוש מיוחד (Deep Scan)</h2>
          <p className="text-sm text-gray-400 mb-4">פרמטרים לסריקה העמוקה — מופעלת ידנית לחיפוש לקוחות ותיקים</p>

          <div className="space-y-5">
            {/* Years to scan */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">כמה שנים אחורה לסרוק?</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(y => (
                  <button
                    key={y}
                    onClick={() => updateConfig('deepScanYears', y)}
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      (config.deepScanYears || 3) === y ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {y} {y === 1 ? 'שנה' : 'שנים'}
                  </button>
                ))}
              </div>
            </div>

            {/* Min months expired */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">מינימום חודשי איחור (לסינון רעש)</label>
              <div className="flex gap-2">
                {[1, 2, 3, 6, 12].map(m => (
                  <button
                    key={m}
                    onClick={() => updateConfig('minMonthsExpired', m)}
                    className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      (config.minMonthsExpired || 3) === m ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {m} {m === 1 ? 'חודש' : 'חודשים'}
                  </button>
                ))}
              </div>
            </div>

            {/* Only mandatory */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">סוגי חיסונים</label>
              <div className="flex gap-3">
                <button
                  onClick={() => updateConfig('onlyMandatory', false)}
                  className={`flex-1 p-4 rounded-xl border-2 text-right transition-colors ${
                    !config.onlyMandatory ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">כל החיסונים</div>
                  <div className="text-xs text-gray-500 mt-1">כלבת, משושה, תילוע, תולעת הפארק, סימפריקה...</div>
                </button>
                <button
                  onClick={() => updateConfig('onlyMandatory', true)}
                  className={`flex-1 p-4 rounded-xl border-2 text-right transition-colors ${
                    config.onlyMandatory ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">חובה בלבד</div>
                  <div className="text-xs text-gray-500 mt-1">רק כלבת, משושה, מרובע, מתומן</div>
                </button>
              </div>
            </div>

            {/* Exclude with appointment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">לקוחות שכבר קבעו תור</label>
              <div className="flex gap-3">
                <button
                  onClick={() => updateConfig('excludeWithAppointment', true)}
                  className={`flex-1 p-4 rounded-xl border-2 text-right transition-colors ${
                    config.excludeWithAppointment !== false ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">דלג עליהם ✓</div>
                  <div className="text-xs text-gray-500 mt-1">לא שולח למי שכבר קבע תור</div>
                </button>
                <button
                  onClick={() => updateConfig('excludeWithAppointment', false)}
                  className={`flex-1 p-4 rounded-xl border-2 text-right transition-colors ${
                    config.excludeWithAppointment === false ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">שלח בכל מקרה</div>
                  <div className="text-xs text-gray-500 mt-1">גם מי שקבע תור מקבל תזכורת</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Channel */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">ערוץ שליחה</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {CHANNEL_OPTIONS.map(ch => (
            <button
              key={ch.value}
              onClick={() => updateConfig('channel', ch.value)}
              className={`p-4 rounded-xl border-2 text-right transition-colors ${
                (config.channel || 'whatsapp') === ch.value ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">{ch.icon}</div>
              <div className="font-medium text-sm">{ch.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Message Mode */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">תוכן ההודעה</h2>
        <div className="space-y-3">
          {MESSAGE_MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateConfig('messageMode', opt.value)}
              className={`w-full p-4 rounded-xl border-2 text-right transition-colors ${
                (config.messageMode || 'templates') === opt.value ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-sm text-gray-500 mt-1">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Approval Mode */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">מסלול אישור</h2>
        <div className="space-y-3">
          {APPROVAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateConfig('approvalMode', opt.value)}
              className={`w-full p-4 rounded-xl border-2 text-right transition-colors ${
                (config.approvalMode || 'all') === opt.value ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{opt.icon}</span>
                <span className="font-medium">{opt.label}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1 mr-8">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Gil Notification */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">התראות</h2>
        <p className="text-sm text-gray-400 mb-4">האם לשלוח סיכום לגיל בוואטסאפ?</p>
        <div className="flex gap-4">
          <button
            onClick={() => updateConfig('notifyGil', true)}
            className={`flex-1 p-4 rounded-xl border-2 text-center transition-colors ${
              config.notifyGil !== false ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-1">📲</div>
            <div className="font-medium text-sm">כן — שלח סיכום לגיל</div>
          </button>
          <button
            onClick={() => updateConfig('notifyGil', false)}
            className={`flex-1 p-4 rounded-xl border-2 text-center transition-colors ${
              config.notifyGil === false ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-1">🔕</div>
            <div className="font-medium text-sm">לא — רק בדשבורד</div>
          </button>
        </div>
      </div>

      {/* Templates */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-4">
        <h2 className="font-bold text-lg mb-2">תבניות הודעות</h2>
        <p className="text-sm text-gray-400 mb-2">ערוך את ההודעות לכל סוג. משתנים זמינים:</p>
        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs font-mono text-gray-600 flex flex-wrap gap-2" dir="ltr">
          {templatePlaceholders.map(p => (
            <span key={p} className="bg-white border px-2 py-1 rounded">{p}</span>
          ))}
        </div>
        <div className="space-y-4">
          {templates.map(t => (
            <div key={t.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{categoryLabels[t.category] || t.category}</span>
                <div className="flex gap-2">
                  {editingTemplate === t.id && (
                    <button onClick={() => setEditingTemplate(null)} className="text-sm text-gray-400 hover:text-gray-600">ביטול</button>
                  )}
                  <button
                    onClick={() => {
                      if (editingTemplate === t.id) { saveTemplate(t.id); }
                      else { setEditingTemplate(t.id); setEditText(t.template_text); }
                    }}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    {editingTemplate === t.id ? '💾 שמור' : '✏️ ערוך'}
                  </button>
                </div>
              </div>
              {editingTemplate === t.id ? (
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm min-h-[160px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  dir="rtl"
                />
              ) : (
                <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap" dir="rtl">
                  {t.template_text}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
