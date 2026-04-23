/**
 * Collector: pull appt_booker_sessions touched within a period and
 * normalize each one to a Conversation with full turn history.
 * context.history is an array of {ts, role, content} — already in the shape we want.
 */
import { pool } from "../../../shared/db";
import type { Conversation, ConversationTurn, RunEvent } from "../types";

interface SessionRow {
  id: number;
  agent_name: string;
  phone: string;
  state: string;
  context: {
    history?: ConversationTurn[];
    advisor_customer_name?: string;
    outbound_pet_name?: string;
    [k: string]: unknown;
  } | null;
  last_msg_at: string;
  created_at: string;
}

export async function collectBookerSessions(
  periodStart: string,
  periodEnd: string
): Promise<Conversation[]> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT id, agent_name, phone, state, context, last_msg_at, created_at
       FROM appt_booker_sessions
      WHERE last_msg_at >= $1::date
        AND last_msg_at <  ($2::date + INTERVAL '1 day')
      ORDER BY id ASC`,
    [periodStart, periodEnd]
  );

  const eventsByPhone = await fetchEventsForPhones(
    rows.map((r) => r.phone),
    periodStart,
    periodEnd
  );

  return rows.map((r) => {
    const turns = Array.isArray(r.context?.history) ? r.context!.history : [];
    // Attach only events that fall within this session's active window,
    // otherwise all sessions for the same phone share the same event list
    // and the analyzer double-counts failures. Window: [created_at, last_msg_at + 30s).
    const windowStart = new Date(r.created_at).getTime();
    const windowEnd = new Date(r.last_msg_at).getTime() + 30_000;
    const events = (eventsByPhone.get(r.phone) ?? []).filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= windowStart && t < windowEnd;
    });
    return {
      source: "appt_booker",
      sourceId: String(r.id),
      phone: r.phone,
      customerName: r.context?.advisor_customer_name,
      petName: r.context?.outbound_pet_name,
      turns,
      metadata: {
        state: r.state,
        agentName: r.agent_name,
        context: r.context ?? {},
      },
      startedAt: r.created_at,
      lastMessageAt: r.last_msg_at,
      events,
    } satisfies Conversation;
  });
}

async function fetchEventsForPhones(
  phones: string[],
  periodStart: string,
  periodEnd: string
): Promise<Map<string, RunEvent[]>> {
  const map = new Map<string, RunEvent[]>();
  if (phones.length === 0) return map;
  const { rows } = await pool.query<{
    phone: string;
    event_type: string;
    details: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT phone, event_type, details, created_at
       FROM appt_booker_runs
      WHERE phone = ANY($1::text[])
        AND created_at >= $2::date
        AND created_at <  ($3::date + INTERVAL '1 day')
      ORDER BY created_at ASC`,
    [phones, periodStart, periodEnd]
  );
  for (const row of rows) {
    if (!map.has(row.phone)) map.set(row.phone, []);
    map.get(row.phone)!.push({
      eventType: row.event_type,
      details: row.details ?? {},
      createdAt: row.created_at,
    });
  }
  return map;
}
