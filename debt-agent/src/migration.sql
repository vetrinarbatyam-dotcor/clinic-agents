-- Debt Agent: Postgres migration for clinicpal DB
-- Run once: psql -U clinicpal_user -d clinicpal -f migration.sql

-- Current debts snapshot (updated each run)
CREATE TABLE IF NOT EXISTS debts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  cust_number INTEGER,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(50),
  cell_phone VARCHAR(50),
  email VARCHAR(200),
  city VARCHAR(100),
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_visit DATE,
  pet_names TEXT, -- comma-separated
  escalation_level INTEGER NOT NULL DEFAULT 0,
  is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  exclude_reason TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

-- Debt amount changes over time
CREATE TABLE IF NOT EXISTS debt_history (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  previous_amount NUMERIC(10,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_debt_history_user ON debt_history(user_id);
CREATE INDEX IF NOT EXISTS idx_debt_history_date ON debt_history(recorded_at);

-- WhatsApp reminders sent to clients
CREATE TABLE IF NOT EXISTS debt_reminders (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  client_name VARCHAR(200),
  client_phone VARCHAR(50),
  amount NUMERIC(10,2),
  escalation_level INTEGER NOT NULL,
  message_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, sent, rejected
  approved_by VARCHAR(100),
  sent_at TIMESTAMPTZ,
  whatsapp_msg_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_debt_reminders_user ON debt_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_debt_reminders_status ON debt_reminders(status);

-- Agent configuration (tunable from dashboard)
CREATE TABLE IF NOT EXISTS debt_agent_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default config values
INSERT INTO debt_agent_config (key, value, description) VALUES
  ('min_debt', '50', 'Minimum debt amount (NIS) to track'),
  ('cron_schedule', '0 8 * * 0', 'Cron expression (Sunday 08:00)'),
  ('cron_day', 'sunday', 'Day of week for weekly run'),
  ('cron_hour', '08:00', 'Time of day for scheduled run'),
  ('max_auto_level', '2', 'Max escalation level sent without approval (1-2 auto, 3+ needs Gil)'),
  ('level1_delay_days', '1', 'Days after debt to send level 1'),
  ('level2_delay_days', '7', 'Days after debt to send level 2'),
  ('level3_delay_days', '14', 'Days after level 2 to unlock level 3 (needs approval)'),
  ('clinic_phone', '03-XXXXXXX', 'Clinic phone shown in messages'),
  ('bank_details', '', 'Bank account details for messages'),
  ('claude_analysis_enabled', 'false', 'Enable Claude AI analysis of debt patterns'),
  ('gil_phone', '972543123419', 'Gil WhatsApp number for summaries')
ON CONFLICT (key) DO NOTHING;

-- Excluded clients
CREATE TABLE IF NOT EXISTS debt_excluded_clients (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL UNIQUE,
  client_name VARCHAR(200),
  reason TEXT,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluded_by VARCHAR(100) DEFAULT 'gil'
);

-- Register debt-agent in the agents table (used by dashboard Home page)
INSERT INTO agents (name, display_name, is_active, cron_schedule, config)
VALUES (
  'debt-agent',
  'סוכן גבייה',
  true,
  '0 8 * * 0',
  '{"description": "מעקב חובות שבועי — שליפה מ-ClinicaOnline, תזכורות WhatsApp, אסקלציה ב-5 רמות"}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, config = EXCLUDED.config;
