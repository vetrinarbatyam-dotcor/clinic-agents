/**
 * Shared types for the conversation-booker-auditor.
 * A "conversation" is the unit of audit — it comes from one of three sources:
 * booker sessions (richest), reminder replies, or error-only event streams.
 */

export type ConversationSource = "appt_booker" | "appt_reminder" | "wa_collector";

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
}

export interface Conversation {
  source: ConversationSource;
  sourceId: string;
  phone: string;
  customerName?: string;
  petName?: string;
  turns: ConversationTurn[];
  metadata: Record<string, unknown>;
  startedAt: string;
  lastMessageAt: string;
  events?: RunEvent[];
}

export interface RunEvent {
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface RuleHit {
  rule: string;
  category: string;
  weight: number;
  evidence: string;
}

export interface AnalysisResult {
  score: number;
  category: string;
  hits: RuleHit[];
  whatWentWrong: string;
  whatWentWell: string;
  recommendation: string;
}
