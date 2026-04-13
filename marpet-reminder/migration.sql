-- ============================================================
-- marpet-reminder migration
-- Run in Supabase SQL editor
-- ============================================================

-- 1. Register agent in agents table
INSERT INTO agents (name, display_name, is_active, cron_schedule, config)
VALUES (
  'marpet-reminder',
  'מרפט רמיינדר 💉',
  true,
  'manual',
  '{
    "triggerMode": 1,
    "daysBeforeEligible": 14,
    "cooldownDays": 30,
    "maxPerOwnerPerMonth": 2,
    "approvalMode": "manual",
    "messageTemplate": null,
    "notifyGil": true
  }'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  config = agents.config || EXCLUDED.config;

-- 2. marpet_owner_map: client_id -> owner TZ mapping cache
CREATE TABLE IF NOT EXISTS marpet_owner_map (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     TEXT NOT NULL UNIQUE,
  owner_tz      TEXT NOT NULL,
  found_via     TEXT NOT NULL CHECK (found_via IN ('clinica_id_field', 'clinica_claims', 'client_notes', 'pet_notes', 'marpet_discovery')),
  last_verified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marpet_owner_map_tz ON marpet_owner_map (owner_tz);
CREATE INDEX IF NOT EXISTS idx_marpet_owner_map_client ON marpet_owner_map (client_id);

-- 3. marpet_eligibility: vaccine eligibility per pet per owner
CREATE TABLE IF NOT EXISTS marpet_eligibility (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_name     TEXT NOT NULL,
  owner_tz     TEXT NOT NULL,
  vaccine_name TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('eligible', 'not-eligible')),
  next_date    TEXT,            -- DD/MM/YYYY from Marpet
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_tz, pet_name, vaccine_name)
);

CREATE INDEX IF NOT EXISTS idx_marpet_elig_tz ON marpet_eligibility (owner_tz);
CREATE INDEX IF NOT EXISTS idx_marpet_elig_status ON marpet_eligibility (status);

-- 4. marpet_send_log: cooldown + monthly cap tracking
CREATE TABLE IF NOT EXISTS marpet_send_log (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_tz     TEXT NOT NULL,
  pet_name     TEXT NOT NULL,
  vaccine_name TEXT NOT NULL,
  pet_id       TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marpet_send_log_tz ON marpet_send_log (owner_tz, sent_at);
CREATE INDEX IF NOT EXISTS idx_marpet_send_log_vax ON marpet_send_log (owner_tz, pet_name, vaccine_name, sent_at);

-- 5. Add marpet-vaccine category to pending_messages if category is constrained
-- (If pending_messages.category has a CHECK constraint, add 'marpet-vaccine' to it)
-- ALTER TABLE pending_messages DROP CONSTRAINT IF EXISTS pending_messages_category_check;
-- (Uncomment and adjust if needed)

-- 6. Grant permissions (if using RLS)
ALTER TABLE marpet_owner_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE marpet_eligibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE marpet_send_log ENABLE ROW LEVEL SECURITY;

-- Drop old insecure policies
DROP POLICY IF EXISTS "Allow all for service role" ON marpet_owner_map;
DROP POLICY IF EXISTS "Allow all for service role" ON marpet_eligibility;
DROP POLICY IF EXISTS "Allow all for service role" ON marpet_send_log;

-- Create proper policies (service_role only)
CREATE POLICY "service_role_all" ON marpet_owner_map FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON marpet_eligibility FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON marpet_send_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. Update found_via CHECK constraint (run if table already exists)
-- ALTER TABLE marpet_owner_map DROP CONSTRAINT IF EXISTS marpet_owner_map_found_via_check;
-- ALTER TABLE marpet_owner_map ADD CONSTRAINT marpet_owner_map_found_via_check
--   CHECK (found_via IN ('clinica_id_field', 'clinica_claims', 'client_notes', 'pet_notes', 'marpet_discovery'));
