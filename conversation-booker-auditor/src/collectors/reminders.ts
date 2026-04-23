/**
 * Collector: pull appt_reminders_sent rows from a period.
 * Each reminder is a 1- or 2-turn mini-conversation:
 *   assistant: message_body  (always present)
 *   user: reply_text         (only if patient replied)
 * We include unreplied reminders too — the analyzer can decide whether
 * "no reply to a reminder" is a finding worth surfacing.
 */
import { pool } from "../../../shared/db";
import type { Conversation, ConversationTurn } from "../types";

interface ReminderRow {
  id: number;
  phone: string;
  patient_id: string | null;
  pet_name: string | null;
  treatment_type: string | null;
  appointment_at: string | null;
  reminder_type: string | null;
  sent_at: string;
  status: string | null;
  replied_at: string | null;
  reply_text: string | null;
  message_body: string | null;
}

export async function collectReminders(
  periodStart: string,
  periodEnd: string
): Promise<Conversation[]> {
  const { rows } = await pool.query<ReminderRow>(
    `SELECT id, phone, patient_id, pet_name, treatment_type, appointment_at,
            reminder_type, sent_at, status, replied_at, reply_text, message_body
       FROM appt_reminders_sent
      WHERE sent_at >= $1::date
        AND sent_at <  ($2::date + INTERVAL '1 day')
      ORDER BY sent_at ASC`,
    [periodStart, periodEnd]
  );

  return rows.map((r) => {
    const turns: ConversationTurn[] = [];
    if (r.message_body) {
      turns.push({
        role: "assistant",
        content: r.message_body,
        ts: r.sent_at,
      });
    }
    if (r.reply_text && r.replied_at) {
      turns.push({
        role: "user",
        content: r.reply_text,
        ts: r.replied_at,
      });
    }
    return {
      source: "appt_reminder",
      sourceId: String(r.id),
      phone: r.phone,
      petName: r.pet_name ?? undefined,
      turns,
      metadata: {
        treatmentType: r.treatment_type,
        reminderType: r.reminder_type,
        appointmentAt: r.appointment_at,
        status: r.status,
        replied: Boolean(r.reply_text),
      },
      startedAt: r.sent_at,
      lastMessageAt: r.replied_at ?? r.sent_at,
    } satisfies Conversation;
  });
}
