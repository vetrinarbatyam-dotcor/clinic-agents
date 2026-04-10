-- ============================================================
-- marpet-audit migration — Supabase
-- Run in Supabase SQL editor (project wbzzoxsynasqkcqcflbw)
-- ============================================================

-- 1. Register agent
INSERT INTO agents (name, display_name, is_active, cron_schedule, config)
VALUES (
  'marpet-audit',
  'ביקורת מרפט יומית 🔍',
  true,
  '0 2 * * *',
  '{
    "emailTo": "vetcenter85@gmail.com",
    "whatsappTo": "0543123419",
    "checkVaccinesNotReported": true,
    "checkVaccinesReportedNotDone": true,
    "checkVisitsNotReported": true,
    "excludeReferrals": true
  }'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  cron_schedule = EXCLUDED.cron_schedule,
  config = agents.config || EXCLUDED.config;

-- 2. marpet_audit_runs — one row per audit day
CREATE TABLE IF NOT EXISTS marpet_audit_runs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_date       DATE NOT NULL UNIQUE,
  run_started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_finished_at  TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running',
  lost_claims      INT DEFAULT 0,
  missing_vaccines INT DEFAULT 0,
  orphans          INT DEFAULT 0,
  total_lost_nis   NUMERIC DEFAULT 0,
  excel_path       TEXT,
  email_sent       BOOLEAN DEFAULT false,
  whatsapp_sent    BOOLEAN DEFAULT false,
  reviewed         BOOLEAN DEFAULT false,
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      TEXT,
  notes            TEXT,
  error_message    TEXT
);

-- 3. marpet_audit_findings — one row per discrepancy
CREATE TABLE IF NOT EXISTS marpet_audit_findings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES marpet_audit_runs(id) ON DELETE CASCADE,
  audit_date  DATE NOT NULL,
  category    TEXT NOT NULL,
  client_name TEXT,
  pet_name    TEXT,
  item_name   TEXT,
  price_nis   NUMERIC,
  raw_data    JSONB,
  reviewed    BOOLEAN DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marpet_findings_date ON marpet_audit_findings(audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_marpet_runs_date ON marpet_audit_runs(audit_date DESC);
