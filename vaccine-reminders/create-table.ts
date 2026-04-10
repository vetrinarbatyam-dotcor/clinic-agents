import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);

// Check if table exists by trying to query it
const { error } = await supabase.from("vaccine_reminders").select("id").limit(1);

if (error && error.message.includes("does not exist")) {
  console.log("Table vaccine_reminders does not exist yet.");
  console.log("Please create it in the Supabase dashboard with this SQL:\n");
  console.log(`
CREATE TABLE vaccine_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  pet_id INTEGER NOT NULL,
  pet_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  vaccine_name TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  stage INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  message_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'sent', 'rejected', 'skipped')),
  CONSTRAINT valid_stage CHECK (stage BETWEEN 1 AND 4)
);

-- Indexes for common queries
CREATE INDEX idx_vaccine_reminders_agent ON vaccine_reminders(agent_id);
CREATE INDEX idx_vaccine_reminders_pet ON vaccine_reminders(pet_id, vaccine_name);
CREATE INDEX idx_vaccine_reminders_status ON vaccine_reminders(status);
CREATE INDEX idx_vaccine_reminders_created ON vaccine_reminders(created_at);

-- Enable RLS
ALTER TABLE vaccine_reminders ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon (same as other tables in this project)
CREATE POLICY "Allow all for anon" ON vaccine_reminders FOR ALL USING (true) WITH CHECK (true);
  `);
} else if (error) {
  console.log("Error checking table:", error.message);
} else {
  console.log("Table vaccine_reminders already exists!");
}
