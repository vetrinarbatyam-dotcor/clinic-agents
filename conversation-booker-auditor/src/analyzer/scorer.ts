/**
 * Scoring: compose RuleHits into a 0-100 score, a primary category,
 * and human-readable what-went-wrong / went-well / recommendation strings.
 *
 * Approach: sum hit weights, cap at 100. Primary category = the hit with
 * the highest weight (ties broken by first-hit order). The strings are
 * deterministic for Phase 2 — the LLM deep-review in Phase 3 can rewrite
 * them with more nuance.
 */
import type { AnalysisResult, Conversation, RuleHit } from "../types";
import { runRules } from "./rules";

const CATEGORY_LABELS: Record<string, string> = {
  llm_failure: "שגיאת מודל",
  tool_failure: "כשל כלי",
  emergency_missed: "חירום רפואי שהוחמץ",
  stuck_loop: "שיחה תקועה ללא קביעה",
  missing_tools: "חוסר גישה למידע",
  frustration: "תסכול לקוח",
  self_loop: "חזרה על עצמו",
  no_resolution: "ללא סגירה",
  terminology: "טרמינולוגיה שגויה",
};

const CATEGORY_RECOMMENDATIONS: Record<string, string> = {
  llm_failure: "בדוק את רצף ה-fallback ואת מכסת Claude Max; ודא שהכשלים לא ממשיכים להיכנס לאותה שיחה.",
  tool_failure: "בחן את הקריאה ל-ClinicaOnline שכשלה; ודא שה-502 לא נגרם מתור חסום או סלוט שנתפס.",
  emergency_missed: "חבר את urgency_classifier והעבר את השיחה מייד ל-handoff עם התראה לגיל.",
  stuck_loop: "קצר את הלולאה — אחרי 8 סיבובים ללא בחירת סלוט, הצע handoff אוטומטי.",
  missing_tools: "הוסף לבוט כלים: get_pet_vaccines, get_future_appointments, get_pet_last_visit.",
  frustration: "זהה מילות תסכול מוקדם והצע מעבר לבן-אדם ללא התנגדות.",
  self_loop: "ייצב את זיכרון ההקשר — הבוט חוזר על ההודעה הראשונית במקום להתקדם.",
  no_resolution: "צור follow-up אוטומטי 24h אחרי שיחה שלא נסגרה.",
  terminology: "עדכן את תבניות ההודעה; בדוק שמות חיסונים ופורמט התאריכים.",
};

function pickPrimary(hits: RuleHit[]): RuleHit | null {
  if (hits.length === 0) return null;
  return hits.reduce((best, h) => (h.weight > best.weight ? h : best), hits[0]!);
}

function buildWhatWentWrong(hits: RuleHit[]): string {
  if (hits.length === 0) return "לא זוהו בעיות אוטומטיות.";
  return hits
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => `• [${CATEGORY_LABELS[h.category] ?? h.category}] ${h.evidence}`)
    .join("\n");
}

function buildWhatWentWell(c: Conversation, hits: RuleHit[]): string {
  const parts: string[] = [];
  const booked = (c.events ?? []).some((e) =>
    e.eventType === "live_book" || e.eventType === "llm_booked"
  );
  if (booked) parts.push("התור נקבע בהצלחה");
  if (hits.length === 0 && c.turns.length >= 4) parts.push("שיחה זרמה ללא בעיות שזוהו");
  if (c.source === "appt_reminder" && (c.metadata as Record<string, unknown>).replied) {
    parts.push("הלקוח הגיב לתזכורת");
  }
  return parts.length > 0 ? parts.join("; ") : "—";
}

function buildRecommendation(primary: RuleHit | null): string {
  if (!primary) return "אין צורך בפעולה.";
  return CATEGORY_RECOMMENDATIONS[primary.category] ?? "לבחון את השיחה ידנית.";
}

export function analyze(c: Conversation): AnalysisResult {
  const hits = runRules(c);
  const rawScore = hits.reduce((sum, h) => sum + h.weight, 0);
  const score = Math.min(100, rawScore);
  const primary = pickPrimary(hits);
  return {
    score,
    category: primary?.category ?? "clean",
    hits,
    whatWentWrong: buildWhatWentWrong(hits),
    whatWentWell: buildWhatWentWell(c, hits),
    recommendation: buildRecommendation(primary),
  };
}
