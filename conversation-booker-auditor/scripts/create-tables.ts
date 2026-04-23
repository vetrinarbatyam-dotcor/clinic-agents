/**
 * Create DB tables + default config for conversation-booker-auditor.
 * Run: bun run scripts/create-tables.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../shared/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../src/storage/schema.sql");

const sql = readFileSync(schemaPath, "utf-8");

try {
  await pool.query(sql);
  console.log("✓ audit_runs + audit_findings created");

  const { rows } = await pool.query(
    "SELECT config FROM agent_configs WHERE agent_name = 'conversation_booker_auditor'"
  );
  if (rows.length) {
    console.log("✓ default config row present:");
    console.log(JSON.stringify(rows[0].config, null, 2));
  } else {
    console.error("✗ config row missing after INSERT — check SQL");
    process.exit(1);
  }
  process.exit(0);
} catch (e: any) {
  console.error("✗ schema install failed:", e.message);
  process.exit(1);
}
