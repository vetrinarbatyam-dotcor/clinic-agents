/**
 * audit_findings storage: one row per conversation the analyzer surfaced.
 * We persist the full conversation JSON so the dashboard can render it
 * without hitting the source tables later (which may have TTL'd out).
 */
import { pool } from "../../../shared/db";
import type { AnalysisResult, Conversation } from "../types";

export interface FindingInput {
  conversation: Conversation;
  analysis: AnalysisResult;
  llmReviewed?: boolean;
}

export async function insertFindings(
  runId: number,
  findings: FindingInput[]
): Promise<number> {
  if (findings.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let p = 1;
  for (const { conversation, analysis, llmReviewed } of findings) {
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++}::jsonb, $${p++}, $${p++}, $${p++}, $${p++})`
    );
    values.push(
      runId,
      conversation.source,
      conversation.sourceId,
      conversation.phone,
      conversation.customerName ?? null,
      conversation.petName ?? null,
      analysis.category,
      analysis.score,
      JSON.stringify(analysis.hits),
      JSON.stringify({
        turns: conversation.turns,
        metadata: conversation.metadata,
        events: conversation.events ?? [],
        startedAt: conversation.startedAt,
        lastMessageAt: conversation.lastMessageAt,
      }),
      analysis.whatWentWrong,
      analysis.whatWentWell,
      analysis.recommendation,
      llmReviewed ?? false
    );
  }

  const sql = `
    INSERT INTO audit_findings
      (run_id, source, source_id, phone, customer_name, pet_name,
       category, score, matched_rules, conversation,
       what_went_wrong, what_went_well, recommendation, llm_reviewed)
    VALUES ${placeholders.join(",\n")}
  `;
  const res = await pool.query(sql, values);
  return res.rowCount ?? 0;
}
