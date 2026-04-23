/**
 * conversation-booker-auditor — HTTP API (port 3006).
 *
 * Consumers: dashboard page (ConversationAuditor.tsx) + Home widget.
 * Auth: Bearer API_KEY (shared secret across clinic-agents; matches vaccine-reminders).
 *
 * Endpoints (all under /api/):
 *   GET  /api/runs                       — list recent runs
 *   GET  /api/runs/:id                   — one run (includes summary_markdown)
 *   GET  /api/runs/:id/findings          — findings for a run, score desc
 *   GET  /api/findings/:id               — full finding with conversation JSON
 *   POST /api/findings/:id/review        — { decision: ack|ignore|needs_action, notes? }
 *   POST /api/runs/:id/approve           — mark audit_runs.status=approved
 *   POST /api/runs/:id/reject            — mark audit_runs.status=rejected
 *   GET  /api/config                     — return agent_configs row
 *   POST /api/config                     — merge partial config into agent_configs row
 *   POST /api/trigger                    — fire a one-off run (manual, background)
 *   GET  /api/pending_count              — { count } — for Home widget
 *   GET  /healthz                        — { ok: true }
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { pool } from "../../shared/db";
import { loadConfig, saveConfig } from "./config";

const PORT = parseInt(process.env.AUDITOR_API_PORT || "3006", 10);
const API_KEY = process.env.API_KEY || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function requireAuth(req: Request, path: string): Response | null {
  if (path === "/healthz" || path === "/api/pending_count") return null;
  if (!API_KEY) return null;
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${API_KEY}`) return json({ error: "Unauthorized" }, 401);
  return null;
}

async function handleRuns(): Promise<Response> {
  const { rows } = await pool.query(
    `SELECT id, run_type, period_start, period_end, status,
            started_at, completed_at, error_message,
            stats, reviewed_at, reviewer_notes
       FROM audit_runs
      ORDER BY id DESC
      LIMIT 50`
  );
  return json({ runs: rows });
}

async function handleRunById(id: number): Promise<Response> {
  const { rows } = await pool.query(
    `SELECT id, run_type, period_start, period_end, status,
            started_at, completed_at, error_message,
            stats, aggregate_insights, summary_markdown,
            reviewed_by, reviewed_at, reviewer_notes
       FROM audit_runs WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return json({ error: "not found" }, 404);
  return json({ run: rows[0] });
}

async function handleRunFindings(id: number): Promise<Response> {
  const { rows } = await pool.query(
    `SELECT id, source, source_id, phone, customer_name, pet_name,
            category, score, matched_rules,
            what_went_wrong, what_went_well, recommendation,
            llm_reviewed, human_reviewed, human_decision, human_notes,
            created_at
       FROM audit_findings
      WHERE run_id = $1
      ORDER BY score DESC, id ASC`,
    [id]
  );
  return json({ findings: rows });
}

async function handleFindingById(id: number): Promise<Response> {
  const { rows } = await pool.query(
    `SELECT * FROM audit_findings WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return json({ error: "not found" }, 404);
  return json({ finding: rows[0] });
}

async function handleFindingReview(id: number, req: Request): Promise<Response> {
  const body = (await req.json()) as { decision?: string; notes?: string };
  const decision = body.decision;
  if (!decision || !["ack", "ignore", "needs_action"].includes(decision)) {
    return json({ error: "decision must be ack|ignore|needs_action" }, 400);
  }
  const { rowCount } = await pool.query(
    `UPDATE audit_findings
        SET human_reviewed = true,
            human_decision = $2,
            human_notes    = $3
      WHERE id = $1`,
    [id, decision, body.notes ?? null]
  );
  if (rowCount === 0) return json({ error: "not found" }, 404);
  return json({ ok: true });
}

async function handleRunDecision(id: number, status: "approved" | "rejected", req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { reviewer?: string; notes?: string };
  const { rowCount } = await pool.query(
    `UPDATE audit_runs
        SET status = $2, reviewed_at = NOW(),
            reviewed_by = $3, reviewer_notes = $4
      WHERE id = $1
        AND status = 'pending_review'`,
    [id, status, body.reviewer ?? "gil", body.notes ?? null]
  );
  if (rowCount === 0) return json({ error: "not found or not pending_review" }, 404);
  return json({ ok: true });
}

async function handleGetConfig(): Promise<Response> {
  const config = await loadConfig();
  return json({ config });
}

async function handlePostConfig(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const current = await loadConfig();
  const merged = { ...current, ...body };
  await saveConfig(merged);
  return json({ ok: true, config: merged });
}

function handleTrigger(): Response {
  const args = ["run", "src/index.ts", "--dry-run", "--date", new Date().toISOString().slice(0, 10)];
  const child = spawn("bun", args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return json({ ok: true, pid: child.pid });
}

async function handlePendingCount(): Promise<Response> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM audit_findings
      WHERE human_reviewed = false
        AND run_id IN (SELECT id FROM audit_runs WHERE status = 'pending_review')`
  );
  return json({ count: Number(rows[0]?.count ?? 0) });
}

function matchIdRoute(path: string, prefix: string, suffix = ""): number | null {
  const m = path.match(new RegExp(`^${prefix}/(\\d+)${suffix}$`));
  return m ? Number(m[1]) : null;
}

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const authErr = requireAuth(req, path);
    if (authErr) return authErr;

    try {
      if (path === "/healthz") return json({ ok: true, service: "conversation-booker-auditor" });
      if (path === "/api/pending_count" && method === "GET") return handlePendingCount();
      if (path === "/api/runs" && method === "GET") return handleRuns();

      const runFindingsId = matchIdRoute(path, "/api/runs", "/findings");
      if (runFindingsId !== null && method === "GET") return handleRunFindings(runFindingsId);

      const runApproveId = matchIdRoute(path, "/api/runs", "/approve");
      if (runApproveId !== null && method === "POST") return handleRunDecision(runApproveId, "approved", req);

      const runRejectId = matchIdRoute(path, "/api/runs", "/reject");
      if (runRejectId !== null && method === "POST") return handleRunDecision(runRejectId, "rejected", req);

      const runById = matchIdRoute(path, "/api/runs");
      if (runById !== null && method === "GET") return handleRunById(runById);

      const findingReview = matchIdRoute(path, "/api/findings", "/review");
      if (findingReview !== null && method === "POST") return handleFindingReview(findingReview, req);

      const findingById = matchIdRoute(path, "/api/findings");
      if (findingById !== null && method === "GET") return handleFindingById(findingById);

      if (path === "/api/config" && method === "GET") return handleGetConfig();
      if (path === "/api/config" && method === "POST") return handlePostConfig(req);
      if (path === "/api/trigger" && method === "POST") return handleTrigger();

      return json({ error: "not found", path }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auditor-api] ${method} ${path} failed:`, msg);
      return json({ error: msg }, 500);
    }
  },
});

console.log(`[auditor-api] listening on :${PORT}`);
