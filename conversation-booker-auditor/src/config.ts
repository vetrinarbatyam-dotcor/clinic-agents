/**
 * Load and persist the auditor's configuration from agent_configs.
 * The whole design is toggle-driven — every knob lives in the DB row so
 * Gil can flip behavior from the dashboard without a restart.
 */
import { pool } from "../../shared/db";

export interface AuditorConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  run_hour: number;                        // 0-23, clinic timezone
  send_whatsapp: boolean;
  whatsapp_recipients: string[];           // normalized Israeli phones (0XXXXXXXXX)
  llm_model: "claude-max" | "gemini-flash" | "deepseek";
  top_n_problematic: number;
  llm_review_threshold_score: number;      // findings with score >= this get deep LLM review
  include_success_sample: boolean;
  timezone: string;
}

const AGENT_NAME = "conversation_booker_auditor";

const DEFAULTS: AuditorConfig = {
  enabled: false,
  frequency: "daily",
  run_hour: 6,
  send_whatsapp: true,
  whatsapp_recipients: ["0543123419"],
  llm_model: "claude-max",
  top_n_problematic: 10,
  llm_review_threshold_score: 40,
  include_success_sample: true,
  timezone: "Asia/Jerusalem",
};

export async function loadConfig(): Promise<AuditorConfig> {
  const { rows } = await pool.query(
    "SELECT config FROM agent_configs WHERE agent_name = $1",
    [AGENT_NAME]
  );
  if (!rows.length) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(rows[0].config as Partial<AuditorConfig>) };
}

export async function saveConfig(patch: Partial<AuditorConfig>): Promise<AuditorConfig> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await pool.query(
    `INSERT INTO agent_configs (agent_name, config, updated_at, updated_by)
     VALUES ($1, $2::jsonb, NOW(), 'dashboard')
     ON CONFLICT (agent_name) DO UPDATE
     SET config = EXCLUDED.config, updated_at = NOW(), updated_by = 'dashboard'`,
    [AGENT_NAME, JSON.stringify(next)]
  );
  return next;
}
