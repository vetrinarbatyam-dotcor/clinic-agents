import { apiFetch } from '../api';
import { useEffect, useState } from 'react';

interface FunnelStage {
  key: string;
  label: string;
  count: number;
  icon: string;
}

interface DayData {
  day: string;
  [key: string]: string | number;
}

export default function Analytics() {
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [queueBreakdown, setQueueBreakdown] = useState<Record<string, number>>({});
  const [apptTrend, setApptTrend] = useState<DayData[]>([]);
  const [reminderTrend, setReminderTrend] = useState<DayData[]>([]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const base = `http://${window.location.hostname}:8000/api/analytics`;
    try {
      const [f, a, r] = await Promise.all([
        apiFetch(`${base}/funnel`).then(r => r.json()),
        apiFetch(`${base}/trends/appointments`).then(r => r.json()),
        apiFetch(`${base}/trends/reminders`).then(r => r.json()),
      ]);
      setFunnel(f.stages || []);
      setQueueBreakdown(f.queue_breakdown || {});
      setApptTrend(a.days || []);
      setReminderTrend(r.days || []);
    } catch {}
  }

  const maxFunnel = Math.max(...funnel.map(s => s.count), 1);

  function formatDay(iso: string): string {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  const STATUS_LABELS: Record<string, string> = {
    sent: 'נשלח',
    replied: 'הגיב',
    booked: 'קבע תור',
    snoozed: 'דחה',
    needs_callback: 'דורש חזרה',
    declined_final: 'סירב',
    pending: 'ממתין',
  };

  return (
    <div dir="rtl" className="space-y-6">
      <h1 className="text-2xl font-bold">ניתוח ומגמות</h1>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="font-bold text-lg mb-4">Conversion Funnel — תזכורת חיסון עד תור (60 יום)</h2>
        <div className="space-y-3">
          {funnel.map((stage, i) => {
            const pct = maxFunnel > 0 ? Math.round((stage.count / maxFunnel) * 100) : 0;
            const convPct = i > 0 && funnel[i - 1].count > 0
              ? Math.round((stage.count / funnel[i - 1].count) * 100)
              : null;
            const colors = ['bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500'];
            return (
              <div key={stage.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{stage.icon}</span>
                    <span className="text-sm font-medium">{stage.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold">{stage.count}</span>
                    {convPct !== null && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        convPct > 50 ? 'bg-emerald-100 text-emerald-700' : convPct > 20 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {convPct}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-6">
                  <div className={`${colors[i]} h-6 rounded-full transition-all duration-500 flex items-center justify-end px-2`} style={{ width: `${Math.max(pct, 2)}%` }}>
                    {pct > 10 && <span className="text-white text-xs font-medium">{pct}%</span>}
                  </div>
                </div>
                {i < funnel.length - 1 && (
                  <div className="text-center text-gray-300 text-lg my-1">↓</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Queue breakdown */}
        {Object.keys(queueBreakdown).length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-sm font-medium text-gray-500 mb-2">פילוח תור קביעה לפי סטטוס</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(queueBreakdown).map(([status, count]) => (
                <div key={status} className="px-3 py-1.5 bg-gray-50 rounded-lg text-sm">
                  <span className="text-gray-500">{STATUS_LABELS[status] || status}: </span>
                  <span className="font-bold">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Appointment Trends */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="font-bold text-lg mb-4">תורים שנקבעו — 30 יום אחרונים</h2>
        {apptTrend.length === 0 ? (
          <p className="text-gray-400 text-sm">אין נתונים עדיין</p>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {apptTrend.map(d => {
              const maxVal = Math.max(...apptTrend.map(x => Number(x.count)), 1);
              const h = Math.max((Number(d.count) / maxVal) * 100, 4);
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.count} תורים`}>
                  <span className="text-[10px] text-gray-500 font-medium">{d.count}</span>
                  <div className="w-full bg-emerald-500 rounded-t" style={{ height: `${h}%` }} />
                  <span className="text-[9px] text-gray-400 -rotate-45 origin-center">{formatDay(d.day)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reminder Trends */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="font-bold text-lg mb-4">תזכורות תורים — אישורים וביטולים (30 יום)</h2>
        {reminderTrend.length === 0 ? (
          <p className="text-gray-400 text-sm">אין נתונים עדיין</p>
        ) : (
          <>
            {/* Legend */}
            <div className="flex gap-4 mb-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded-sm inline-block" /> נשלחו</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded-sm inline-block" /> אושרו</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-sm inline-block" /> בוטלו</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded-sm inline-block" /> נדחו</span>
            </div>
            <div className="flex items-end gap-1 h-40">
              {reminderTrend.map(d => {
                const sent = Number(d.sent) || 0;
                const confirmed = Number(d.confirmed) || 0;
                const canceled = Number(d.canceled) || 0;
                const snoozed = Number(d.snoozed) || 0;
                const total = sent + confirmed + canceled + snoozed;
                const maxVal = Math.max(...reminderTrend.map(x => (Number(x.sent) || 0) + (Number(x.confirmed) || 0) + (Number(x.canceled) || 0) + (Number(x.snoozed) || 0)), 1);
                const scale = 100 / maxVal;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${total} סה"כ`}>
                    <span className="text-[10px] text-gray-500">{total}</span>
                    <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${Math.max(total * scale, 2)}%` }}>
                      {sent > 0 && <div className="bg-blue-400" style={{ height: `${(sent / total) * 100}%` }} />}
                      {confirmed > 0 && <div className="bg-emerald-500" style={{ height: `${(confirmed / total) * 100}%` }} />}
                      {canceled > 0 && <div className="bg-red-400" style={{ height: `${(canceled / total) * 100}%` }} />}
                      {snoozed > 0 && <div className="bg-amber-400" style={{ height: `${(snoozed / total) * 100}%` }} />}
                    </div>
                    <span className="text-[9px] text-gray-400 -rotate-45 origin-center">{formatDay(d.day)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
