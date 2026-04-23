/**
 * Rule-based detection layer.
 * Each rule is a pure function: Conversation → RuleHit | null.
 * Rules are independent and composable — add new ones by appending to ALL_RULES.
 *
 * Weights reflect the severity findings from the 2026-04-20 first-day audit:
 *   missed medical emergency is worst (40), LLM failure + tool error close behind (30),
 *   frustration/loops/access-denied mid-tier (15-20), terminology/no-resolution low (10-15).
 */
import type { Conversation, ConversationTurn, RuleHit } from "../types";

type Rule = (c: Conversation) => RuleHit | null;

const EMERGENCY_KEYWORDS = [
  "דם", "שותת", "דימום", "חירום", "דחוף", "גסיס", "לא זז", "לא קם",
  "לא נושם", "פרכוס", "עווית", "התקף", "רעיל", "רעל", "בלע",
  "נדרס", "תאונה", "נפל", "שבר", "פציעה", "קוטע", "גוסס",
];

const FRUSTRATION_KEYWORDS = [
  "מעצבן", "שטויות", "לא עונה", "לא מבין", "נמאס", "איפה התשובה",
  "תענו כבר", "מזכירה", "בן אדם", "דבר עם", "בנאדם",
  "עזבי", "עזוב", "די עם", "לא רלוונטי", "ברברת",
];

const BOT_NO_ACCESS_MARKERS = [
  "אין לי גישה", "לא יכולה לראות", "לא יכול לראות",
  "לא יכולה לבדוק", "לא יכול לבדוק", "אין לי מידע",
];

const WRONG_TERMINOLOGY = [
  "תילוע",
  "תולעת הפארק",
  "חג עצמאות שמח",
];

/**
 * Internal system messages the runtime injects into the history:
 * - "🔔 *handoff*" — self-loop forwarded to staff
 * - "⚠️ [appt_booker]" — error notices
 * These are not patient messages even though they carry role='user' in some
 * paths, so we strip them before any keyword analysis to avoid false positives.
 */
function isInternalMessage(content: string): boolean {
  const t = content.trimStart();
  return t.startsWith("🔔") || t.startsWith("⚠️") || t.startsWith("*handoff*");
}

function textOfRole(turns: ConversationTurn[], role: "user" | "assistant"): string {
  return turns
    .filter((t) => t.role === role && !isInternalMessage(t.content))
    .map((t) => t.content)
    .join(" \n ");
}

/**
 * Hebrew/Unicode word-boundary match. Prevents "דם" matching inside "מוקדם".
 */
function hasWholeWord(haystack: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, "u");
  return re.test(haystack);
}

function findMatches(haystack: string, needles: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of needles) if (hasWholeWord(haystack, n)) out.push(n);
  return out;
}

function snippet(t: string, max = 120): string {
  const clean = t.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max) + "…";
}

const ruleLlmFailure: Rule = (c) => {
  const evts = (c.events ?? []).filter((e) => e.eventType === "llm_failed");
  if (evts.length === 0) return null;
  return {
    rule: "llm_failure",
    category: "llm_failure",
    weight: 30,
    evidence: `${evts.length} llm_failed event(s) — last at ${evts[evts.length - 1]!.createdAt}`,
  };
};

const ruleToolError: Rule = (c) => {
  const errs = (c.events ?? []).filter((e) =>
    e.eventType === "book_error" || e.eventType === "slots_error" || e.eventType === "llm_book_failed"
  );
  if (errs.length === 0) return null;
  const last = errs[errs.length - 1]!;
  const detail = JSON.stringify(last.details).slice(0, 140);
  return {
    rule: "tool_error",
    category: "tool_failure",
    weight: 30,
    evidence: `${last.eventType}: ${detail}`,
  };
};

const ruleEmergencyMissed: Rule = (c) => {
  const userText = textOfRole(c.turns, "user");
  const matched = findMatches(userText, EMERGENCY_KEYWORDS);
  if (matched.length === 0) return null;
  const hadHandoff = (c.events ?? []).some((e) =>
    e.eventType === "handoff" || e.eventType === "emergency_escalated"
  );
  if (hadHandoff) return null;
  const firstMatch = c.turns.find(
    (t) =>
      t.role === "user" &&
      !isInternalMessage(t.content) &&
      matched.some((k) => hasWholeWord(t.content, k))
  );
  return {
    rule: "emergency_missed",
    category: "emergency_missed",
    weight: 40,
    evidence: `keywords [${matched.join(", ")}] — no handoff. Msg: "${snippet(firstMatch?.content ?? "")}"`,
  };
};

const ruleStuckLoop: Rule = (c) => {
  if (c.source !== "appt_booker") return null;
  if (c.turns.length < 10) return null;
  const booked = (c.events ?? []).some((e) =>
    e.eventType === "live_book" || e.eventType === "llm_booked"
  );
  if (booked) return null;
  return {
    rule: "stuck_loop",
    category: "stuck_loop",
    weight: 15,
    evidence: `${c.turns.length} turns, state=${(c.metadata as Record<string, unknown>).state}, no booking event`,
  };
};

const ruleBotNoAccess: Rule = (c) => {
  const assistantText = textOfRole(c.turns, "assistant");
  let count = 0;
  for (const marker of BOT_NO_ACCESS_MARKERS) {
    const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    count += (assistantText.match(re) ?? []).length;
  }
  if (count < 2) return null;
  return {
    rule: "bot_no_access",
    category: "missing_tools",
    weight: 20,
    evidence: `bot said "no access / can't check" ${count} times`,
  };
};

const ruleCustomerFrustration: Rule = (c) => {
  const userText = textOfRole(c.turns, "user");
  const matched = findMatches(userText, FRUSTRATION_KEYWORDS);
  if (matched.length === 0) return null;
  const firstMatch = c.turns.find(
    (t) =>
      t.role === "user" &&
      !isInternalMessage(t.content) &&
      matched.some((k) => hasWholeWord(t.content, k))
  );
  return {
    rule: "frustration",
    category: "frustration",
    weight: 20,
    evidence: `keywords [${matched.join(", ")}] — "${snippet(firstMatch?.content ?? "")}"`,
  };
};

const ruleSelfLoop: Rule = (c) => {
  if (c.turns.length < 4) return null;
  const assistantTurns = c.turns.filter((t) => t.role === "assistant");
  if (assistantTurns.length < 3) return null;
  const seen = new Map<string, number>();
  for (const t of assistantTurns) {
    const key = t.content.slice(0, 80);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const maxRepeat = Math.max(...seen.values());
  if (maxRepeat < 3) return null;
  return {
    rule: "self_loop",
    category: "self_loop",
    weight: 15,
    evidence: `assistant repeated same opening ${maxRepeat} times`,
  };
};

const ruleNoResolution: Rule = (c) => {
  if (c.source !== "appt_booker") return null;
  const state = String((c.metadata as Record<string, unknown>).state ?? "");
  const terminalBad = ["expired", "error", "abandoned"].includes(state);
  const booked = (c.events ?? []).some((e) =>
    e.eventType === "live_book" || e.eventType === "llm_booked"
  );
  if (!terminalBad && booked) return null;
  if (!terminalBad) return null;
  return {
    rule: "no_resolution",
    category: "no_resolution",
    weight: 10,
    evidence: `ended in state=${state} without booking`,
  };
};

const ruleTerminologyWrong: Rule = (c) => {
  const assistantText = textOfRole(c.turns, "assistant");
  const matched = WRONG_TERMINOLOGY.filter((k) => assistantText.includes(k));
  if (matched.length === 0) return null;
  return {
    rule: "terminology",
    category: "terminology",
    weight: 15,
    evidence: `bot used wrong term(s): [${matched.join(", ")}]`,
  };
};

const ruleEmptySessionErrored: Rule = (c) => {
  if (c.source !== "appt_booker") return null;
  if (c.turns.length >= 2) return null;
  const hadErr = (c.events ?? []).some((e) =>
    e.eventType === "llm_failed" || e.eventType === "book_error" || e.eventType === "slots_error"
  );
  if (!hadErr) return null;
  return {
    rule: "empty_errored",
    category: "llm_failure",
    weight: 10,
    evidence: `session errored with ${c.turns.length} turn(s) recorded`,
  };
};

const ruleReminderNoReply: Rule = (c) => {
  if (c.source !== "appt_reminder") return null;
  const replied = Boolean((c.metadata as Record<string, unknown>).replied);
  if (replied) return null;
  return {
    rule: "reminder_no_reply",
    category: "no_resolution",
    weight: 5,
    evidence: `reminder sent, no patient reply within period`,
  };
};

export const ALL_RULES: Rule[] = [
  ruleLlmFailure,
  ruleToolError,
  ruleEmergencyMissed,
  ruleStuckLoop,
  ruleBotNoAccess,
  ruleCustomerFrustration,
  ruleSelfLoop,
  ruleNoResolution,
  ruleTerminologyWrong,
  ruleEmptySessionErrored,
  ruleReminderNoReply,
];

export function runRules(c: Conversation): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of ALL_RULES) {
    const hit = rule(c);
    if (hit) hits.push(hit);
  }
  return hits;
}
