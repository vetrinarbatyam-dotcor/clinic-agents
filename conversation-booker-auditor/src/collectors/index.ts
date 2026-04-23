/**
 * Collectors entry — merges booker sessions + reminder rows into a single
 * Conversation[] the analyzer can iterate uniformly.
 *
 * Note: appt_booker_runs events are NOT collected standalone. They're
 * attached to each booker session via phone join in sessions.ts, which is
 * where they're interpretable. Orphan events (e.g. ignored_not_allowed for
 * phones with no session) are signals about the filter, not conversations
 * — out of scope for Phase 2.
 */
import type { Conversation } from "../types";
import { collectBookerSessions } from "./sessions";
import { collectReminders } from "./reminders";

export async function collectAll(
  periodStart: string,
  periodEnd: string
): Promise<Conversation[]> {
  const [sessions, reminders] = await Promise.all([
    collectBookerSessions(periodStart, periodEnd),
    collectReminders(periodStart, periodEnd),
  ]);
  return [...sessions, ...reminders];
}
