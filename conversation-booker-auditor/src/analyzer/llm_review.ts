/**
 * LLM deep-review: takes rule-flagged findings, sends them as a single batch
 * to Claude Max via `claude -p`, and gets back refined Hebrew narratives plus
 * a severity adjustment (-20..+20) that lets the LLM downgrade obvious false
 * positives (e.g. "בדיקת דם" routine test flagged as emergency).
 *
 * Design choices:
 * - One batch call instead of N — cheaper, leverages Claude's context, single quota hit.
 * - JSON in / JSON out with a { "reviews": [...] } envelope the prompt asks for
 *   explicitly; robust to the model occasionally wrapping output in ```json fences.
 * - On ANY error (timeout, quota, parse fail) we swallow and leave the rule-based
 *   narrative intact. Auditor must never hard-fail because of LLM weirdness.
 */
import { execSync } from "node:child_process";
import type { FindingInput } from "../storage/findings";

export interface LLMReview {
  findingId: number;
  whatWentWrong: string;
  whatGoodWell: string;
  recommendation: string;
  severityAdjustment: number;
}

const CLAUDE_TIMEOUT_MS = 180_000;
const CLAUDE_MAX_BUFFER = 10 * 1024 * 1024;

function buildPrompt(findings: FindingInput[]): string {
  const items = findings.map((f, i) => {
    const turns = f.conversation.turns
      .slice(-30)
      .map((t) => `  [${t.role}] ${t.content.replace(/\s+/g, " ").slice(0, 400)}`)
      .join("\n");
    const events = (f.conversation.events ?? [])
      .map((e) => `  <${e.eventType}>`)
      .join(" ");
    const hits = f.analysis.hits
      .map((h) => `${h.rule}(${h.weight}): ${h.evidence}`)
      .join(" | ");
    const name = f.conversation.customerName ?? "לא ידוע";
    const pet = f.conversation.petName ?? "-";
    return [
      `### finding_id=${i + 1}`,
      `לקוח: ${name} / חיית מחמד: ${pet} / טלפון: ${f.conversation.phone}`,
      `מקור: ${f.conversation.source} (session_id=${f.conversation.sourceId})`,
      `ניקוד-כללים: ${f.analysis.score} | קטגוריה: ${f.analysis.category}`,
      `חוקים שנדלקו: ${hits}`,
      `אירועים: ${events || "—"}`,
      `שיחה (עד 30 פניות אחרונות):`,
      turns || "  (אין פניות)",
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    "אתה מבקר איכות של בוט-וואטסאפ לקביעת תורים במרפאה וטרינרית (שם הבוט 'אלכס').",
    "קיבלת רשימה של שיחות שזוהו אוטומטית כבעייתיות. עבור כל אחת הפק ביקורת אנושית ומדודה.",
    "",
    "**הנחיות:**",
    "- קרא כל שיחה לעומק והבן האם הניקוד האוטומטי מוצדק או מנופח.",
    "- לדוגמה: 'בדיקת דם לcreatinine' הוא טיפול שגרתי — לא חירום, יש להוריד severity.",
    "- לדוגמה: 'שבר באגן' בחתול רחוב הוא חירום אמיתי — יש לשמר severity.",
    "- נסח 'what_went_wrong' במשפט אחד חד בעברית.",
    "- נסח 'what_went_well' במשפט אחד בעברית (אם שום דבר לא עבד — כתוב '—').",
    "- נסח 'recommendation' כהוראה פעילה לתיקון הבוט (מה לשנות בקוד/פרומפט/כלי).",
    "- severity_adjustment: מספר בין -20 ל-+20. שלילי = הניקוד היה מנופח. חיובי = חמור יותר.",
    "",
    "**פורמט פלט (JSON בלבד, ללא טקסט עטיפה):**",
    '{ "reviews": [ { "finding_id": 1, "what_went_wrong": "...", "what_went_well": "...", "recommendation": "...", "severity_adjustment": 0 }, ... ] }',
    "",
    "---",
    "",
    "## השיחות לבדיקה:",
    "",
    items,
    "",
    "---",
    "החזר JSON תקין בלבד.",
  ].join("\n");
}

function parseReviews(raw: string): LLMReview[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0) throw new Error("no JSON object in output");
  const json = text.slice(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(json) as { reviews?: unknown };
  if (!Array.isArray(parsed.reviews)) throw new Error("missing reviews[] array");
  return parsed.reviews.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      findingId: Number(row.finding_id),
      whatWentWrong: String(row.what_went_wrong ?? ""),
      whatGoodWell: String(row.what_went_well ?? ""),
      recommendation: String(row.recommendation ?? ""),
      severityAdjustment: clamp(Number(row.severity_adjustment ?? 0), -20, 20),
    };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

export async function reviewBatch(findings: FindingInput[]): Promise<Map<number, LLMReview>> {
  const map = new Map<number, LLMReview>();
  if (findings.length === 0) return map;

  const prompt = buildPrompt(findings);
  const cmd = `claude -p ${JSON.stringify(prompt)} --output-format text`;

  let stdout: string;
  try {
    stdout = execSync(cmd, {
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: CLAUDE_MAX_BUFFER,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[llm_review] claude -p failed — keeping rule-based narratives: ${msg.slice(0, 300)}`);
    return map;
  }

  if (/hit your limit|rate limit/i.test(stdout)) {
    console.error("[llm_review] claude quota hit — keeping rule-based narratives");
    return map;
  }

  let reviews: LLMReview[];
  try {
    reviews = parseReviews(stdout);
  } catch (err) {
    console.error(
      `[llm_review] parse failed (${(err as Error).message}) — keeping rule-based narratives. Output head: ${stdout.slice(0, 300)}`
    );
    return map;
  }

  for (const r of reviews) {
    if (r.findingId >= 1 && r.findingId <= findings.length) {
      map.set(r.findingId - 1, r);
    }
  }
  console.log(`[llm_review] received ${reviews.length} reviews for ${findings.length} findings`);
  return map;
}

export function applyReviews(
  findings: FindingInput[],
  reviews: Map<number, LLMReview>
): { applied: number; reviewed: boolean[] } {
  const reviewed = new Array<boolean>(findings.length).fill(false);
  let applied = 0;
  findings.forEach((f, i) => {
    const r = reviews.get(i);
    if (!r) return;
    if (r.whatWentWrong) f.analysis.whatWentWrong = r.whatWentWrong;
    if (r.whatGoodWell) f.analysis.whatWentWell = r.whatGoodWell;
    if (r.recommendation) f.analysis.recommendation = r.recommendation;
    f.analysis.score = clamp(f.analysis.score + r.severityAdjustment, 0, 100);
    reviewed[i] = true;
    applied++;
  });
  return { applied, reviewed };
}
