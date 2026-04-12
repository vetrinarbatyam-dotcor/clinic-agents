import { apiFetch } from '../api';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase';

interface Message {
  id: string;
  client_name: string;
  client_phone: string;
  pet_name: string;
  category: string;
  message_text: string;
  status: string;
  approved_by: string | null;
  sent_at: string | null;
  created_at: string;
}

const categoryLabels: Record<string, string> = {
  medical: '🏥 מקרה רפואי',
  'new-client': '🆕 לקוח חדש',
  surgery: '🔪 ניתוח',
  'vaccine-expired': '💉 חיסון שפג',
  'deep-scan': '🔍 חיפוש מיוחד',
};

export default function ApprovalQueue() {
  const { agentId } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<string>('pending');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    loadMessages();
  }, [agentId, filter]);

  async function loadMessages() {
    let query = supabase
      .from('pending_messages')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data } = await query;
    setMessages(data || []);
  }

  async function approve(msg: Message) {
    setSending(msg.id);
    // Update status to approved — the agent will send via WhatsApp
    await supabase.from('pending_messages').update({
      status: 'approved',
      approved_by: 'gil',
    }).eq('id', msg.id);

    // Call WhatsApp send via the server (for now just mark as sent)
    try {
      const res = await apiFetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msg.id, phone: msg.client_phone, text: msg.message_text }),
      });
      if (res.ok) {
        await supabase.from('pending_messages').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', msg.id);
      }
    } catch {
      // If API not available, just mark approved
    }

    setSending(null);
    loadMessages();
  }

  async function reject(id: string) {
    await supabase.from('pending_messages').update({ status: 'rejected' }).eq('id', id);
    loadMessages();
  }

  async function saveEdit(id: string) {
    await supabase.from('pending_messages').update({ message_text: editText }).eq('id', id);
    setEditingId(null);
    loadMessages();
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id);
    setEditText(msg.message_text);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-400 hover:text-gray-600">←</Link>
          <h1 className="text-2xl font-bold">תור אישור הודעות</h1>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[
            { key: 'pending', label: 'ממתינות' },
            { key: 'approved', label: 'אושרו' },
            { key: 'sent', label: 'נשלחו' },
            { key: 'rejected', label: 'נדחו' },
            { key: 'all', label: 'הכל' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 rounded-md text-sm ${
                filter === f.key ? 'bg-white shadow text-emerald-700 font-medium' : 'text-gray-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-lg">{msg.client_name}</span>
                  <span className="text-sm bg-gray-100 px-2 py-0.5 rounded">{msg.client_phone}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>🐾 {msg.pet_name}</span>
                  <span>{categoryLabels[msg.category] || msg.category}</span>
                </div>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                msg.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                msg.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                msg.status === 'sent' ? 'bg-emerald-100 text-emerald-700' :
                'bg-red-100 text-red-600'
              }`}>
                {msg.status === 'pending' ? 'ממתינה' :
                 msg.status === 'approved' ? 'אושרה' :
                 msg.status === 'sent' ? 'נשלחה' : 'נדחתה'}
              </div>
            </div>

            {editingId === msg.id ? (
              <div className="mb-3">
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  className="w-full border rounded-lg p-3 text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  dir="rtl"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => saveEdit(msg.id)}
                    className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm"
                  >
                    שמור
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-4 py-1.5 border rounded-lg text-sm"
                  >
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-3 mb-3 text-sm whitespace-pre-wrap" dir="rtl">
                {msg.message_text}
              </div>
            )}

            {msg.status === 'pending' && editingId !== msg.id && (
              <div className="flex gap-2">
                <button
                  onClick={() => approve(msg)}
                  disabled={sending === msg.id}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {sending === msg.id ? 'שולח...' : '✅ אשר ושלח'}
                </button>
                <button
                  onClick={() => startEdit(msg)}
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  ✏️ ערוך
                </button>
                <button
                  onClick={() => reject(msg.id)}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50"
                >
                  ❌ דחה
                </button>
              </div>
            )}

            <div className="text-xs text-gray-400 mt-2">
              {new Date(msg.created_at).toLocaleString('he-IL')}
              {msg.sent_at && ` | נשלחה: ${new Date(msg.sent_at).toLocaleString('he-IL')}`}
            </div>
          </div>
        ))}

        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-16">
            <div className="text-4xl mb-2">📭</div>
            אין הודעות {filter === 'pending' ? 'ממתינות' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
