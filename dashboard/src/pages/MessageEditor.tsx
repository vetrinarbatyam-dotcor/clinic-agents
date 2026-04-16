import { apiFetch } from '../api';
import { useEffect, useState } from 'react';

interface Template {
  key: string;
  label: string;
  content: string;
  variables: string[];
  editable: boolean;
}

interface AgentGroup {
  label: string;
  icon: string;
  templates: Template[];
}

const EXAMPLE_VALUES: Record<string, string> = {
  ownerName: 'יוסי כהן',
  petName: 'רקסי',
  vaccineName: 'משושה',
  dueDate: '01/04/2026',
  lastDate: '01/04/2025',
  vaccineType: 'משושה',
  vaccineList: '- רקסי: משושה (פג 01/04/2025)\n- לולה: מרובע (פג 15/03/2025)',
  aiPersonalNote: 'שמחנו לראות שרקסי מגיב יפה לטיפול!',
  client_name: 'יוסי כהן',
  pet_name: 'רקסי',
  date: '15/04/2026',
  time: '10:30',
  day_name: 'רביעי',
  treatment_name: 'סירוס',
  clientName: 'יוסי כהן',
  amount: '350',
  clinicPhone: '035513649',
};

function fillPreview(content: string, variables: string[]): string {
  let result = content;
  for (const v of variables) {
    const val = EXAMPLE_VALUES[v] || `[${v}]`;
    result = result.replace(new RegExp(`\\{${v}\\}`, 'g'), val);
  }
  return result;
}

export default function MessageEditor() {
  const [data, setData] = useState<Record<string, AgentGroup>>({});
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [editContent, setEditContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const res = await apiFetch(`http://${window.location.hostname}:8000/api/templates`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        const firstAgent = Object.keys(d)[0];
        if (firstAgent && d[firstAgent].templates.length > 0) {
          setSelectedAgent(firstAgent);
          setSelectedKey(d[firstAgent].templates[0].key);
          setEditContent(d[firstAgent].templates[0].content);
          setOriginalContent(d[firstAgent].templates[0].content);
        }
      }
    } catch {}
  }

  function selectTemplate(agentId: string, key: string) {
    setSelectedAgent(agentId);
    setSelectedKey(key);
    const tmpl = data[agentId]?.templates.find(t => t.key === key);
    if (tmpl) {
      setEditContent(tmpl.content);
      setOriginalContent(tmpl.content);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch(`http://${window.location.hostname}:8000/api/templates`, {
        method: 'PUT',
        body: JSON.stringify({ agent: selectedAgent, key: selectedKey, content: editContent }),
      });
      if (res.ok) {
        setToast({ msg: 'נשמר בהצלחה!', type: 'ok' });
        setOriginalContent(editContent);
        // Update local data
        setData(prev => {
          const next = { ...prev };
          const ag = next[selectedAgent];
          if (ag) {
            ag.templates = ag.templates.map(t => t.key === selectedKey ? { ...t, content: editContent } : t);
          }
          return next;
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({ msg: err.detail || 'שגיאה בשמירה', type: 'err' });
      }
    } catch {
      setToast({ msg: 'שגיאת רשת', type: 'err' });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  }

  const currentTemplate = data[selectedAgent]?.templates.find(t => t.key === selectedKey);
  const hasChanges = editContent !== originalContent;

  return (
    <div dir="rtl" className="flex gap-6 h-[calc(100vh-120px)]">
      {/* Sidebar */}
      <div className="w-64 shrink-0 overflow-y-auto bg-white rounded-xl border shadow-sm p-4">
        <h2 className="font-bold text-lg mb-4">עורך הודעות</h2>
        {Object.entries(data).map(([agentId, group]) => (
          <div key={agentId} className="mb-4">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-1.5">
              <span>{group.icon}</span>
              <span>{group.label}</span>
            </div>
            {group.templates.map(t => (
              <button
                key={t.key}
                onClick={() => selectTemplate(agentId, t.key)}
                className={`block w-full text-right px-3 py-1.5 text-xs rounded-lg mb-0.5 transition ${
                  selectedAgent === agentId && selectedKey === t.key
                    ? 'bg-emerald-100 text-emerald-800 font-medium'
                    : 'hover:bg-gray-100 text-gray-600'
                } ${!t.editable ? 'opacity-60' : ''}`}
              >
                {t.label}
                {!t.editable && <span className="text-[9px] mr-1 text-gray-400">(קריאה)</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Main editor */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {currentTemplate ? (
          <>
            {/* Header */}
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">
                  {data[selectedAgent]?.icon} {currentTemplate.label}
                  <span className="text-xs text-gray-400 font-normal mr-2">({selectedAgent})</span>
                </h3>
                <div className="flex gap-2">
                  {hasChanges && currentTemplate.editable && (
                    <button onClick={() => { setEditContent(originalContent); }} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
                      אפס
                    </button>
                  )}
                  {currentTemplate.editable && (
                    <button
                      onClick={save}
                      disabled={saving || !hasChanges}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium text-white ${
                        hasChanges ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'
                      }`}
                    >
                      {saving ? 'שומר...' : 'שמור'}
                    </button>
                  )}
                </div>
              </div>

              {/* Variables chips */}
              {currentTemplate.variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-gray-400">משתנים:</span>
                  {currentTemplate.variables.map(v => (
                    <button
                      key={v}
                      onClick={() => {
                        if (currentTemplate.editable) {
                          setEditContent(prev => prev + `{${v}}`);
                        }
                      }}
                      className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono hover:bg-blue-100 transition"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Editor + Preview side by side */}
            <div className="flex gap-4 flex-1 min-h-0">
              {/* Editor */}
              <div className="flex-1 bg-white rounded-xl border shadow-sm p-5 flex flex-col">
                <h4 className="text-sm font-medium text-gray-500 mb-2">עריכה</h4>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  disabled={!currentTemplate.editable}
                  className={`flex-1 w-full border rounded-lg p-3 text-sm leading-relaxed resize-none font-sans ${
                    currentTemplate.editable ? 'bg-white' : 'bg-gray-50 text-gray-500'
                  }`}
                  dir="rtl"
                  style={{ minHeight: '200px' }}
                />
              </div>

              {/* Preview */}
              <div className="flex-1 bg-white rounded-xl border shadow-sm p-5 flex flex-col">
                <h4 className="text-sm font-medium text-gray-500 mb-2">תצוגה מקדימה</h4>
                <div className="flex-1 bg-emerald-50 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap border border-emerald-200" dir="rtl" style={{ minHeight: '200px' }}>
                  {fillPreview(editContent, currentTemplate.variables)}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-4xl mb-2">📝</div>
              בחר תבנית מהרשימה
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-6 left-6 px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white ${
            toast.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'
          }`}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
