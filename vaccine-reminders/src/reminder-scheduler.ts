import type { VaccineLater } from "./vaccine-fetcher";

/**
 * Reminder stages (all AFTER due date since API only returns expired vaccines):
 * Stage 1: 0-3 days after due date (immediate gentle reminder)
 * Stage 2: 7 days after due date (second nudge)
 * Stage 3: 17 days after due date (stronger reminder)
 * Stage 4: 30 days after due date (final reminder)
 */
export interface ReminderStage {
  stage: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  triggerDaysOverdue: number;
  templateFile: string;
}

export const REMINDER_STAGES: ReminderStage[] = [
  {
    stage: 1,
    name: "תזכורת ראשונה",
    description: "מיד אחרי שפג תוקף החיסון",
    triggerDaysOverdue: 1,
    templateFile: "reminder-1.txt",
  },
  {
    stage: 2,
    name: "תזכורת שנייה",
    description: "שבוע אחרי שפג (לא הגיעו)",
    triggerDaysOverdue: 7,
    templateFile: "reminder-2.txt",
  },
  {
    stage: 3,
    name: "תזכורת שלישית",
    description: "שבועיים וחצי אחרי שפג",
    triggerDaysOverdue: 17,
    templateFile: "reminder-3.txt",
  },
  {
    stage: 4,
    name: "תזכורת אחרונה",
    description: "חודש אחרי שפג",
    triggerDaysOverdue: 30,
    templateFile: "reminder-4.txt",
  },
];

export interface ReminderRecord {
  id?: string;
  pet_id: number;
  pet_name: string;
  owner_name: string;
  owner_phone: string;
  vaccine_name: string;
  due_date: string;
  stage: number;
  status: "pending" | "approved" | "sent" | "rejected" | "skipped";
  message_text: string;
  created_at?: string;
  sent_at?: string | null;
}

export function determineReminderStage(
  vaccine: VaccineLater,
  sentStages: number[],
  toleranceDays: number = 2
): ReminderStage | null {
  const overdue = vaccine.DaysOverdue;

  // Must be at least 0 days overdue (vaccine expired)
  if (overdue < 0) return null;

  for (const stage of REMINDER_STAGES) {
    if (sentStages.includes(stage.stage)) continue;

    const triggerDay = stage.triggerDaysOverdue;
    const lowerBound = triggerDay - toleranceDays;
    const upperBound = triggerDay + toleranceDays;

    if (overdue >= lowerBound && overdue <= upperBound) {
      return stage;
    }

    // Catch-up: if we passed this stage's window but haven't sent it
    if (overdue > upperBound && !sentStages.includes(stage.stage)) {
      const nextStage = REMINDER_STAGES.find(s => s.stage === stage.stage + 1);
      if (!nextStage || overdue < nextStage.triggerDaysOverdue - toleranceDays) {
        return stage;
      }
    }
  }

  return null;
}

export function formatDueDateHebrew(date: Date): string {
  return date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
