import "dotenv/config";
import { pool } from "../../shared/db";


const PORT = parseInt(process.env.VACCINE_API_PORT || "3001");

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://167.86.69.208:3000",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};


const API_KEY = process.env.API_KEY || '';

function checkAuth(req: Request): Response | null {
  const url = new URL(req.url);
  if (url.pathname === '/health' || url.pathname === '/healthz') return null;
  const auth = req.headers.get('authorization');
  if (!API_KEY || auth !== `Bearer ${API_KEY}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Auth check
    const authErr = checkAuth(req);
    if (authErr) return authErr;

    try {
      // GET /api/reminders — list reminders with optional filters
      if (path === "/api/reminders" && req.method === "GET") {
        const status = url.searchParams.get("status");
        const limit = parseInt(url.searchParams.get("limit") || "500");

        let query = "SELECT * FROM vaccine_reminders";
        const params: any[] = [];

        if (status && status !== "all") {
          query += " WHERE status = $1";
          params.push(status);
        }
        query += " ORDER BY created_at DESC LIMIT $" + (params.length + 1);
        params.push(limit);

        const { rows } = await pool.query(query, params);
        return new Response(JSON.stringify(rows), { headers: corsHeaders });
      }

      // GET /api/stats — aggregate stats
      if (path === "/api/stats" && req.method === "GET") {
        const { rows } = await pool.query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
            COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
            COUNT(*) FILTER (WHERE status = 'approved') as approved
          FROM vaccine_reminders
        `);

        const { rows: byStage } = await pool.query(`
          SELECT stage, COUNT(*) as count FROM vaccine_reminders GROUP BY stage ORDER BY stage
        `);

        const { rows: byVaccine } = await pool.query(`
          SELECT vaccine_name, COUNT(*) as count FROM vaccine_reminders
          GROUP BY vaccine_name ORDER BY count DESC LIMIT 15
        `);

        return new Response(JSON.stringify({
          ...rows[0],
          byStage: Object.fromEntries(byStage.map((r: any) => [r.stage, parseInt(r.count)])),
          byVaccine: Object.fromEntries(byVaccine.map((r: any) => [r.vaccine_name, parseInt(r.count)])),
        }), { headers: corsHeaders });
      }

      // PUT /api/reminders/:id/approve
      if (path.match(/^\/api\/reminders\/[^/]+\/approve$/) && req.method === "PUT") {
        const id = path.split("/")[3];
        await pool.query("UPDATE vaccine_reminders SET status = 'approved' WHERE id = $1", [id]);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      // PUT /api/reminders/:id/reject
      if (path.match(/^\/api\/reminders\/[^/]+\/reject$/) && req.method === "PUT") {
        const id = path.split("/")[3];
        await pool.query("UPDATE vaccine_reminders SET status = 'rejected' WHERE id = $1", [id]);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      // PUT /api/reminders/approve-all
      if (path === "/api/reminders/approve-all" && req.method === "PUT") {
        const { rowCount } = await pool.query("UPDATE vaccine_reminders SET status = 'approved' WHERE status = 'pending'");
        return new Response(JSON.stringify({ ok: true, count: rowCount }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
    } catch (e: any) {
      console.error("[vaccine-api] Error:", e.message);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  },
});

console.log(`[vaccine-api] Running on port ${PORT}`);
