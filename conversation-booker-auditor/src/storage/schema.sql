-- Schema for conversation-booker-auditor
-- Run once via: bun run scripts/create-tables.ts
--
-- audit_runs     — one row per daily/weekly audit invocation
-- audit_findings — one row per problematic conversation

CREATE TABLE IF NOT EXISTS audit_runs (
  id               BIGSERIAL PRIMARY KEY,
  run_type         TEXT        NOT NULL CHECK (run_type IN ('daily', 'weekly', 'manual')),
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'pending_review', 'approved', 'rejected', 'failed')),
  stats            JSONB,
  aggregate_insights JSONB,
  summary_markdown TEXT,
  error_message    TEXT,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  reviewer_notes   TEXT,
  UNIQUE (run_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_runs_period ON audit_runs (period_start, period_end);

CREATE TABLE IF NOT EXISTS audit_findings (
  id               BIGSERIAL PRIMARY KEY,
  run_id           BIGINT      NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  source           TEXT        NOT NULL CHECK (source IN ('appt_booker', 'appt_reminder', 'wa_collector')),
  source_id        BIGINT,
  phone            TEXT,
  customer_name    TEXT,
  pet_name         TEXT,
  category         TEXT        NOT NULL,
  score            INT         NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  matched_rules    JSONB,
  conversation     JSONB,
  what_went_wrong  TEXT,
  what_went_well   TEXT,
  recommendation   TEXT,
  llm_reviewed     BOOL        NOT NULL DEFAULT FALSE,
  human_reviewed   BOOL        NOT NULL DEFAULT FALSE,
  human_notes      TEXT,
  human_decision   TEXT        CHECK (human_decision IN ('ack', 'ignore', 'needs_action', NULL)),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_findings_run ON audit_findings (run_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_score ON audit_findings (run_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_findings_category ON audit_findings (category);
CREATE INDEX IF NOT EXISTS idx_audit_findings_human_review ON audit_findings (human_reviewed, run_id);

-- Default agent config row (enabled=false — user flips via dashboard)
INSERT INTO agent_configs (agent_name, config, updated_at, updated_by)
VALUES (
  'conversation_booker_auditor',
  jsonb_build_object(
    'enabled', false,
    'frequency', 'daily',
    'run_hour', 6,
    'send_whatsapp', true,
    'whatsapp_recipients', jsonb_build_array('0543123419'),
    'llm_model', 'claude-max',
    'top_n_problematic', 10,
    'llm_review_threshold_score', 40,
    'include_success_sample', true,
    'timezone', 'Asia/Jerusalem'
  ),
  NOW(),
  'system'
)
ON CONFLICT (agent_name) DO NOTHING;
