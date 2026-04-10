// Escalation logic for debt reminders
// Level 1: auto, 1 day after debt
// Level 2: auto, 7 days after debt
// Level 3+: requires Gil approval from dashboard

import type { Pool } from 'pg';

export interface DebtRecord {
  id: number;
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  cell_phone: string;
  amount: number;
  last_visit: string;
  pet_names: string;
  escalation_level: number;
  is_excluded: boolean;
  first_seen_at: string;
}

export interface EscalationDecision {
  debt: DebtRecord;
  newLevel: number;
  autoSend: boolean; // true = send without approval, false = wait for Gil
  reason: string;
}

export async function getConfig(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query('SELECT key, value FROM debt_agent_config');
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export async function getExcludedUserIds(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT user_id FROM debt_excluded_clients');
  return new Set(rows.map(r => r.user_id));
}

export async function getLastReminderLevel(pool: Pool, userId: string): Promise<{ level: number; sentAt: Date | null }> {
  const { rows } = await pool.query(
    `SELECT escalation_level, sent_at FROM debt_reminders
     WHERE user_id = $1 AND status IN ('sent', 'approved')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return { level: 0, sentAt: null };
  return { level: rows[0].escalation_level, sentAt: rows[0].sent_at ? new Date(rows[0].sent_at) : null };
}

export function calculateEscalation(
  debt: DebtRecord,
  lastLevel: number,
  lastSentAt: Date | null,
  maxAutoLevel: number,
  config: Record<string, string>,
): EscalationDecision | null {
  const now = new Date();
  const firstSeen = new Date(debt.first_seen_at);
  const daysSinceFirstSeen = Math.floor((now.getTime() - firstSeen.getTime()) / 86400000);
  const daysSinceLastSent = lastSentAt
    ? Math.floor((now.getTime() - lastSentAt.getTime()) / 86400000)
    : Infinity;

  const level1Delay = parseInt(config.level1_delay_days || '1');
  const level2Delay = parseInt(config.level2_delay_days || '7');
  const level3Delay = parseInt(config.level3_delay_days || '14');

  // Never sent — check if level 1 is due
  if (lastLevel === 0) {
    if (daysSinceFirstSeen >= level1Delay) {
      return {
        debt,
        newLevel: 1,
        autoSend: 1 <= maxAutoLevel,
        reason: `חוב חדש — ${daysSinceFirstSeen} ימים מאז זיהוי ראשון`,
      };
    }
    return null; // Too early
  }

  // Level 1 was sent — check if level 2 is due
  if (lastLevel === 1 && daysSinceLastSent >= level2Delay) {
    return {
      debt,
      newLevel: 2,
      autoSend: 2 <= maxAutoLevel,
      reason: `עברו ${daysSinceLastSent} ימים מהודעה ראשונה`,
    };
  }

  // Level 2 was sent — check if level 3 is due (requires approval)
  if (lastLevel === 2 && daysSinceLastSent >= level3Delay) {
    return {
      debt,
      newLevel: 3,
      autoSend: false, // Always requires approval
      reason: `עברו ${daysSinceLastSent} ימים מהודעה שנייה — דורש אישור`,
    };
  }

  // Level 3+ — each further level after level3Delay days
  if (lastLevel >= 3 && lastLevel < 5 && daysSinceLastSent >= level3Delay) {
    return {
      debt,
      newLevel: lastLevel + 1,
      autoSend: false,
      reason: `עברו ${daysSinceLastSent} ימים מרמה ${lastLevel} — דורש אישור`,
    };
  }

  return null; // No escalation needed
}
