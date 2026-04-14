import type { VaccineLater } from "./vaccine-fetcher";
import { pool } from "../../shared/db";

export interface ReminderStage {
  stage: 1 | 2 | 3 | 4;
  name: string;
  description: string;
  triggerDaysOverdue: number; // negative = before due date, positive = after
  enabled: boolean;
  templateFile: string;
}

// Correct stages: stage 1 is a PRE-reminder (7 days before due date)
const DEFAULT_STAGES: ReminderStage[] = [
  { stage: 1, name: "תזכורת מקדימה", description: "שבוע לפני תפוגת החיסון", triggerDaysOverdue: -7, enabled: true, templateFile: "reminder-1.txt" },
  { stage: 2, name: "תזכורת שנייה", description: "3 ימים אחרי שפג (לא הגיעו ואין תור)", triggerDaysOverdue: 3, enabled: true, templateFile: "reminder-2.txt" },
  { stage: 3, name: "תזכורת שלישית", description: "10 ימים אחרי שפג", triggerDaysOverdue: 10, enabled: true, templateFile: "reminder-3.txt" },
  { stage: 4, name: "תזכורת אחרונה", description: "25 ימים אחרי שפג", triggerDaysOverdue: 25, enabled: true, templateFile: "reminder-4.txt" },
];

// Cache for DB config
let _cachedConfig: any = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

export async function loadConfig(): Promise<any> {
  const now = Date.now();
  if (_cachedConfig && now - _cacheTime < CACHE_TTL) return _cachedConfig;

  try {
    const { rows } = await pool.query(
      "SELECT config FROM agent_configs WHERE agent_name = 'vaccine-reminders'"
    );
    if (rows.length > 0) {
      _cachedConfig = rows[0].config;
      _cacheTime = now;
      return _cachedConfig;
    }
  } catch (e) {
    console.error("[vaccine] Failed to load config from DB:", e);
  }
  return null;
}

export async function getStages(): Promise<ReminderStage[]> {
  const config = await loadConfig();
  if (config?.stages) {
    return config.stages.map((s: any) => ({
      stage: s.stage,
      name: s.name || DEFAULT_STAGES[s.stage - 1]?.name || `שלב ${s.stage}`,
      description: s.description || DEFAULT_STAGES[s.stage - 1]?.description || "",
      triggerDaysOverdue: s.triggerDaysOverdue ?? DEFAULT_STAGES[s.stage - 1]?.triggerDaysOverdue ?? 0,
      enabled: s.enabled !== false,
      templateFile: `reminder-${s.stage}.txt`,
    }));
  }
  return DEFAULT_STAGES;
}

export async function getToleranceDays(): Promise<number> {
  const config = await loadConfig();
  return config?.toleranceDays ?? 2;
}

export async function getMaxPerDay(): Promise<number> {
  const config = await loadConfig();
  return config?.maxPerDay ?? 30;
}

export async function getAutoApprove(): Promise<boolean> {
  const config = await loadConfig();
  return config?.autoApprove !== false;
}

export async function getUseAI(): Promise<boolean> {
  const config = await loadConfig();
  return config?.useAI === true;
}

export async function getNotifyGil(): Promise<boolean> {
  const config = await loadConfig();
  return config?.notifyGil !== false;
}

// Exported for dashboard display
export const REMINDER_STAGES = DEFAULT_STAGES;

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
  toleranceDays: number,
  stages: ReminderStage[]
): ReminderStage | null {
  const overdue = vaccine.DaysOverdue;

  // Filter to enabled stages only, sorted by triggerDaysOverdue ascending
  const enabledStages = stages
    .filter(s => s.enabled)
    .sort((a, b) => a.triggerDaysOverdue - b.triggerDaysOverdue);

  for (const stage of enabledStages) {
    if (sentStages.includes(stage.stage)) continue;

    const triggerDay = stage.triggerDaysOverdue;
    const lowerBound = triggerDay - toleranceDays;
    const upperBound = triggerDay + toleranceDays;

    // Exact match within tolerance window
    if (overdue >= lowerBound && overdue <= upperBound) {
      return stage;
    }

    // Catch-up: if we missed the window, send it before the next stage kicks in
    if (overdue > upperBound) {
      const nextStage = enabledStages.find(s => s.stage > stage.stage && !sentStages.includes(s.stage));
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
