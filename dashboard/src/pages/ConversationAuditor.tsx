import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

const AUDITOR_API =
  window.location.hostname === "localhost"
    ? "http://localhost:3006"
    : `http://${window.location.hostname}:3006`;

interface RunSummary {
  id: string;
  run_type: string;
  period_start: string;
  period_end: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  stats: {
    conversationsScanned: number;
    findingsTotal: number;
    findingsBySeverity: { critical: number; high: number; medium: number; low: number };
    findingsByCategory: Record<string, number>;
  } | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

interface RunFull extends RunSummary {
  summary_markdown: string | null;
  aggregate_insights: Record<string, unknown> | null;
}

interface Finding {
  id: string;
  source: string;
  source_id: string;
  phone: string;
  customer_name: string | null;
  pet_name: string | null;
  category: string;
  score: number;
  matched_rules: Array<{ rule: string; category: string; weight: number; evidence: string }>;
  conversation?: {
    turns: Array<{ role: string; content: string; ts: string }>;
    events?: Array<{ eventType: string; details: Record<string, unknown>; createdAt: string }>;
    metadata?: Record<string, unknown>;
  };
  what_went_wrong: string;
  what_went_well: string;
  recommendation: string;
  llm_reviewed: boolean;
  human_reviewed: boolean;
  human_decision: string | null;
  human_notes: string | null;
}

interface AuditorConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  run_hour: number;
  send_whatsapp: boolean;
  whatsapp_recipients: string[];
  llm_model: string;
  top_n_problematic: number;
  llm_review_threshold_score: number;
  include_success_sample: boolean;
  timezone: string;
}

const CATEGORY_HEBREW: Record<string, string> = {
  emergency_missed: "חירום שהוחמץ",
  llm_failure: "שגיאת מודל",
  tool_failure: "כשל כלי",
  stuck_loop: "שיחה תקועה",
  missing_tools: "חסר כלים",
  frustration: "תסכול לקוח",
  self_loop: "חזרה על עצמו",
  no_resolution: "ללא סגירה",
  terminology: "טרמינולוגיה",
};

function severityColor(score: number): string {
  if (score >= 70) return "bg-red-100 text-red-800 border-red-300";
  if (score >= 40) return "bg-amber-100 text-amber-800 border-amber-300";
  if (score >= 20) return "bg-blue-100 text-blue-800 border-blue-300";
  return "bg-gray-100 text-gray-700 border-gray-300";
}

function severityLabel(score: number): string {
  if (score >= 70) return "קריטי";
  if (score >= 40) return "גבוה";
  if (score >= 20) return "בינוני";
  return "נמוך";
}

export default function ConversationAuditor() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunFull | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [config, setConfig] = useState<AuditorConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const res = await apiFetch(`${AUDITOR_API}/api/runs`);
      if (!res.ok) throw new Error(`GET /api/runs ${res.status}`);
      const data = (await res.json()) as { runs: RunSummary[] };
      setRuns(data.runs);
      if (!selectedRunId && data.runs.length > 0) setSelectedRunId(data.runs[0]!.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedRunId]);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiFetch(`${AUDITOR_API}/api/config`);
      if (!res.ok) throw new Error(`GET /api/config ${res.status}`);
      const data = (await res.json()) as { config: AuditorConfig };
      setConfig(data.config);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadRunDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [runRes, findRes] = await Promise.all([
        apiFetch(`${AUDITOR_API}/api/runs/${id}`),
        apiFetch(`${AUDITOR_API}/api/runs/${id}/findings`),
      ]);
      if (!runRes.ok || !findRes.ok) throw new Error("Failed to load run details");
      const runData = (await runRes.json()) as { run: RunFull };
      const findData = (await findRes.json()) as { findings: Finding[] };
      setRunDetail(runData.run);
      setFindings(findData.findings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
    loadConfig();
  }, [loadRuns, loadConfig]);

  useEffect(() => {
    if (selectedRunId) loadRunDetail(selectedRunId);
  }, [selectedRunId, loadRunDetail]);

  const reviewFinding = async (findingId: string, decision: "ack" | "ignore" | "needs_action", notes = "") => {
    try {
      const res = await apiFetch(`${AUDITOR_API}/api/findings/${findingId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      });
      if (!res.ok) throw new Error(`Review failed: ${res.status}`);
      showToast(`סומן כ-${decision}`);
      if (selectedRunId) loadRunDetail(selectedRunId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const approveRun = async () => {
    if (!selectedRunId) return;
    const res = await apiFetch(`${AUDITOR_API}/api/runs/${selectedRunId}/approve`, {
      method: "POST",
      body: JSON.stringify({ reviewer: "gil" }),
    });
    if (res.ok) {
      showToast("הריצה אושרה");
      loadRuns();
      loadRunDetail(selectedRunId);
    }
  };

  const triggerRun = async () => {
    const res = await apiFetch(`${AUDITOR_API}/api/trigger`, { method: "POST" });
    if (res.ok) showToast("ריצה ידנית הופעלה ברקע — רענן בעוד דקה");
  };

  const saveConfig = async (patch: Partial<AuditorConfig>) => {
    try {
      const res = await apiFetch(`${AUDITOR_API}/api/config`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const data = (await res.json()) as { config: AuditorConfig };
      setConfig(data.config);
      showToast("תצורה נשמרה");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pendingCount = useMemo(
    () => findings.filter((f) => !f.human_reviewed).length,
    [findings]
  );

  const selectedFinding = useMemo(
    () => findings.find((f) => f.id === selectedFindingId) ?? null,
    [findings, selectedFindingId]
  );

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ביקורת שיחות — Booker + Reminders</h1>
            <p className="text-sm text-gray-600 mt-1">
              עשר השיחות הבעייתיות ביותר לאישור יומי. {pendingCount > 0 && (
                <span className="inline-block mx-2 rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">
                  {pendingCount} ממצאים ממתינים
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={triggerRun}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              הפעל ריצה ידנית
            </button>
            <button
              onClick={() => { loadRuns(); if (selectedRunId) loadRunDetail(selectedRunId); }}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50"
            >
              רענן
            </button>
          </div>
        </header>

        {config && <ActivationCard config={config} onToggle={(enabled) => saveConfig({ enabled })} />}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
            {error}
            <button onClick={() => setError(null)} className="mr-4 font-medium hover:underline">סגור</button>
          </div>
        )}

        {toast && (
          <div className="fixed top-4 left-4 z-50 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          <aside className="col-span-12 md:col-span-3">
            <div className="bg-white rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b text-sm font-medium text-gray-700">ריצות אחרונות</div>
              <ul className="divide-y max-h-[70vh] overflow-y-auto">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedRunId(r.id)}
                      className={`w-full text-right px-4 py-3 text-sm hover:bg-gray-50 ${
                        selectedRunId === r.id ? "bg-emerald-50" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">#{r.id}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {r.period_start === r.period_end
                          ? r.period_start.slice(0, 10)
                          : `${r.period_start.slice(0, 10)} ← ${r.period_end.slice(0, 10)}`}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {r.stats?.findingsTotal ?? 0} ממצאים · {r.run_type}
                      </div>
                    </button>
                  </li>
                ))}
                {runs.length === 0 && (
                  <li className="px-4 py-6 text-sm text-gray-400 text-center">אין ריצות עדיין</li>
                )}
              </ul>
            </div>
          </aside>

          <main className="col-span-12 md:col-span-9 space-y-4">
            {loading && <div className="text-sm text-gray-500">טוען...</div>}

            {runDetail && !loading && (
              <>
                <RunHeader run={runDetail} onApprove={approveRun} />
                {runDetail.status === "failed" && runDetail.error_message && (
                  <pre className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-xs overflow-auto">
                    {runDetail.error_message}
                  </pre>
                )}
                <FindingsTable
                  findings={findings}
                  selectedId={selectedFindingId}
                  onSelect={setSelectedFindingId}
                  onReview={reviewFinding}
                />
              </>
            )}

            {selectedFinding && (
              <FindingModal finding={selectedFinding} onClose={() => setSelectedFindingId(null)} onReview={reviewFinding} />
            )}

            {config && <ConfigPanel config={config} onSave={saveConfig} />}
          </main>
        </div>
      </div>
    </div>
  );
}

function ActivationCard({
  config,
  onToggle,
}: {
  config: AuditorConfig;
  onToggle: (enabled: boolean) => void;
}) {
  const active = config.enabled;
  return (
    <div
      className={`rounded-xl border-2 shadow-sm p-5 flex items-center justify-between gap-6 ${
        active ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"
      }`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              active ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
            }`}
          />
          <h2 className="text-lg font-bold text-gray-900">
            {active ? "הסוכן פעיל" : "הסוכן כבוי"}
          </h2>
        </div>
        <p className="text-sm text-gray-700">
          {active
            ? `רץ אוטומטית כל יום ב-${String(config.run_hour).padStart(2, "0")}:00 (${config.timezone}). הפעלה ידנית זמינה בכפתור "הפעל ריצה ידנית" בראש הדף.`
            : "הטיימר מוגדר אבל הסוכן לא יבצע כלום עד שתלחץ הפעל. אפשר גם להריץ ידנית כל עוד הכפתור כבוי."}
        </p>
      </div>
      <button
        onClick={() => {
          if (active) {
            if (!confirm("לכבות את הסוכן? ריצות מתוזמנות ייעצרו.")) return;
          }
          onToggle(!active);
        }}
        className={`px-6 py-3 rounded-xl text-base font-bold shadow-md transition-all ${
          active
            ? "bg-white text-red-700 border-2 border-red-300 hover:bg-red-50"
            : "bg-emerald-600 text-white hover:bg-emerald-700"
        }`}
      >
        {active ? "כבה את הסוכן" : "הפעל את הסוכן"}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-blue-100 text-blue-800",
    pending_review: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-gray-100 text-gray-800",
    failed: "bg-red-100 text-red-800",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-800";
  return <span className={`${cls} text-xs px-2 py-0.5 rounded`}>{status}</span>;
}

function RunHeader({ run, onApprove }: { run: RunFull; onApprove: () => void }) {
  const s = run.stats;
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-gray-900">
            ריצה #{run.id} — {run.period_start.slice(0, 10)}
            {run.period_start !== run.period_end && ` עד ${run.period_end.slice(0, 10)}`}
          </div>
          <div className="text-sm text-gray-500 mt-1 flex gap-3">
            <span>{run.run_type}</span>
            <StatusBadge status={run.status} />
          </div>
        </div>
        {run.status === "pending_review" && (
          <button
            onClick={onApprove}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            אשר ריצה
          </button>
        )}
      </div>
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
          <Stat label="שיחות נסרקו" value={s.conversationsScanned} />
          <Stat label="ממצאים" value={s.findingsTotal} />
          <Stat label="קריטי" value={s.findingsBySeverity.critical} accent="red" />
          <Stat label="גבוה" value={s.findingsBySeverity.high} accent="amber" />
          <Stat label="בינוני" value={s.findingsBySeverity.medium} accent="blue" />
          <Stat label="נמוך" value={s.findingsBySeverity.low} accent="gray" />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = "gray" }: { label: string; value: number; accent?: string }) {
  const colors: Record<string, string> = {
    red: "text-red-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    gray: "text-gray-900",
  };
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${colors[accent]}`}>{value}</div>
    </div>
  );
}

function FindingsTable({
  findings,
  selectedId,
  onSelect,
  onReview,
}: {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReview: (id: string, decision: "ack" | "ignore" | "needs_action") => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-8 text-center text-gray-500 text-sm">
        אין ממצאים בריצה זו
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b text-sm font-medium text-gray-700">
        ממצאים ({findings.length})
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 text-right">ציון</th>
            <th className="px-3 py-2 text-right">קטגוריה</th>
            <th className="px-3 py-2 text-right">לקוח / חיה</th>
            <th className="px-3 py-2 text-right">מה השתבש</th>
            <th className="px-3 py-2 text-right">פעולה</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {findings.map((f) => (
            <tr
              key={f.id}
              className={`hover:bg-gray-50 cursor-pointer ${selectedId === f.id ? "bg-emerald-50" : ""}`}
              onClick={() => onSelect(f.id)}
            >
              <td className="px-3 py-3 align-top">
                <div className={`inline-block px-2 py-1 rounded border text-xs font-semibold ${severityColor(f.score)}`}>
                  {f.score} · {severityLabel(f.score)}
                </div>
                {f.llm_reviewed && <div className="text-[10px] text-gray-400 mt-1">LLM reviewed</div>}
              </td>
              <td className="px-3 py-3 align-top text-xs">
                {CATEGORY_HEBREW[f.category] ?? f.category}
              </td>
              <td className="px-3 py-3 align-top text-xs">
                <div className="font-medium">{f.customer_name ?? f.phone}</div>
                {f.pet_name && <div className="text-gray-500">{f.pet_name}</div>}
              </td>
              <td className="px-3 py-3 align-top text-xs text-gray-700 max-w-md">
                {f.what_went_wrong.split("\n")[0]}
              </td>
              <td className="px-3 py-3 align-top">
                {f.human_reviewed ? (
                  <span className="text-xs text-emerald-700 font-medium">{f.human_decision}</span>
                ) : (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onReview(f.id, "ack")}
                      className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    >
                      אשר
                    </button>
                    <button
                      onClick={() => onReview(f.id, "needs_action")}
                      className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                    >
                      לטפל
                    </button>
                    <button
                      onClick={() => onReview(f.id, "ignore")}
                      className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      התעלם
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingModal({
  finding,
  onClose,
  onReview,
}: {
  finding: Finding;
  onClose: () => void;
  onReview: (id: string, decision: "ack" | "ignore" | "needs_action") => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">
              {finding.customer_name ?? finding.phone}
              {finding.pet_name && <span className="text-gray-500"> · {finding.pet_name}</span>}
            </div>
            <div className="flex gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded border text-xs ${severityColor(finding.score)}`}>
                {finding.score} · {severityLabel(finding.score)}
              </span>
              <span className="text-xs text-gray-500">
                {CATEGORY_HEBREW[finding.category] ?? finding.category}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <div className="text-xs text-gray-500 font-medium mb-1">מה השתבש</div>
            <div className="text-sm text-gray-800 whitespace-pre-line">{finding.what_went_wrong}</div>
          </div>
          {finding.what_went_well && finding.what_went_well !== "—" && (
            <div>
              <div className="text-xs text-gray-500 font-medium mb-1">מה עבד טוב</div>
              <div className="text-sm text-gray-800">{finding.what_went_well}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500 font-medium mb-1">המלצה</div>
            <div className="text-sm text-emerald-800 bg-emerald-50 rounded p-2">{finding.recommendation}</div>
          </div>

          {finding.conversation?.turns && (
            <div>
              <div className="text-xs text-gray-500 font-medium mb-1">שיחה מלאה ({finding.conversation.turns.length} פניות)</div>
              <div className="space-y-2 bg-gray-50 rounded p-3 max-h-96 overflow-y-auto">
                {finding.conversation.turns.map((t, i) => (
                  <div key={i} className={`text-sm ${t.role === "user" ? "text-blue-900" : "text-gray-800"}`}>
                    <span className="text-xs text-gray-400 ml-2">[{t.role}]</span>
                    <span className="whitespace-pre-line">{t.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs text-gray-500 font-medium mb-1">חוקים שנדלקו</div>
            <ul className="text-xs text-gray-700 space-y-1">
              {finding.matched_rules.map((r, i) => (
                <li key={i} className="bg-gray-50 rounded p-2">
                  <span className="font-medium">{r.rule}</span> ({r.weight}): {r.evidence}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="px-5 py-3 border-t bg-gray-50">
          {finding.human_reviewed ? (
            <div className="text-sm text-gray-600">
              כבר נסקר ({finding.human_decision}) {finding.human_notes && `— ${finding.human_notes}`}
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { onReview(finding.id, "ack"); onClose(); }}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                אשר (ראיתי)
              </button>
              <button
                onClick={() => { onReview(finding.id, "needs_action"); onClose(); }}
                className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
              >
                יש לטפל
              </button>
              <button
                onClick={() => { onReview(finding.id, "ignore"); onClose(); }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-100"
              >
                התעלם
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigPanel({
  config,
  onSave,
}: {
  config: AuditorConfig;
  onSave: (patch: Partial<AuditorConfig>) => void;
}) {
  const [local, setLocal] = useState(config);
  useEffect(() => setLocal(config), [config]);

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">תצורה</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={local.enabled}
            onChange={(e) => setLocal({ ...local, enabled: e.target.checked })}
            className="w-4 h-4"
          />
          <span>הסוכן פעיל (cron)</span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={local.send_whatsapp}
            onChange={(e) => setLocal({ ...local, send_whatsapp: e.target.checked })}
            className="w-4 h-4"
          />
          <span>שלח סיכום בוואטסאפ לגיל</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">תדירות</span>
          <select
            value={local.frequency}
            onChange={(e) => setLocal({ ...local, frequency: e.target.value as "daily" | "weekly" })}
            className="border rounded px-2 py-1"
          >
            <option value="daily">יומי</option>
            <option value="weekly">שבועי</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">שעת ריצה</span>
          <input
            type="number"
            min={0}
            max={23}
            value={local.run_hour}
            onChange={(e) => setLocal({ ...local, run_hour: Number(e.target.value) })}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">מס׳ ממצאים מינימלי</span>
          <input
            type="number"
            min={1}
            value={local.top_n_problematic}
            onChange={(e) => setLocal({ ...local, top_n_problematic: Number(e.target.value) })}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">סף ציון ל-LLM review</span>
          <input
            type="number"
            min={0}
            max={100}
            value={local.llm_review_threshold_score}
            onChange={(e) => setLocal({ ...local, llm_review_threshold_score: Number(e.target.value) })}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>
      <button
        onClick={() => onSave(local)}
        className="mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
      >
        שמור תצורה
      </button>
    </div>
  );
}
