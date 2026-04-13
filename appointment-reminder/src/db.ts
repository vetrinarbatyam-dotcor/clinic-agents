import { pool } from '../../shared/db';
export { pool };

export async function loadConfig(): Promise<any> {
  const r = await pool.query("SELECT config FROM agent_configs WHERE agent_name='appointment_reminder'");
  return r.rows[0]?.config || null;
}
export async function saveConfig(cfg: any) {
  await pool.query(`
    INSERT INTO agent_configs (agent_name, config, updated_at)
    VALUES ('appointment_reminder', $1::jsonb, NOW())
    ON CONFLICT (agent_name) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
  `, [JSON.stringify(cfg)]);
}
export async function logRun(eventType: string, phone: string | null, details: any) {
  await pool.query(
    `INSERT INTO appt_reminder_runs (event_type, phone, details) VALUES ($1, $2, $3::jsonb)`,
    [eventType, phone, JSON.stringify(details)],
  );
}
