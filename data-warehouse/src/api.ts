// Data Warehouse API server — port 3003
// Endpoints for dashboard: stats, runs history, config, run-now triggers

import 'dotenv/config';
import pg from 'pg';
import { spawn } from 'child_process';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'clinicpal',
  user: process.env.DB_USER || 'clinicpal_user',
  password: process.env.DB_PASSWORD || 'clinicpal2306',
});

const PORT = 3003;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // GET /api/stats — table row counts + freshness
      if (url.pathname === '/api/stats') {
        const [counts, runs] = await Promise.all([
          pool.query(`
            SELECT
              (SELECT COUNT(*) FROM visits) AS visits,
              (SELECT COUNT(*) FROM visit_items) AS visit_items,
              (SELECT COUNT(*) FROM vaccines) AS vaccines,
              (SELECT COUNT(*) FROM prescriptions) AS prescriptions,
              (SELECT COUNT(*) FROM lab_results) AS lab_results,
              (SELECT COUNT(*) FROM appointments) AS appointments,
              (SELECT COUNT(*) FROM therapists) AS therapists,
              (SELECT COUNT(*) FROM clients) AS clients,
              (SELECT COUNT(*) FROM pets) AS pets,
              (SELECT MAX(visit_date) FROM visits) AS latest_visit,
              (SELECT MIN(visit_date) FROM visits) AS earliest_visit,
              (SELECT pg_size_pretty(pg_database_size('clinicpal'))) AS db_size
          `),
          pool.query(`
            SELECT layer, status, started_at, finished_at, duration_sec, rows_added, rows_updated, rows_failed, error_message
            FROM sync_runs ORDER BY started_at DESC LIMIT 20
          `),
        ]);
        return new Response(JSON.stringify({ counts: counts.rows[0], recentRuns: runs.rows }), { headers: CORS });
      }

      // GET /api/config
      if (url.pathname === '/api/config') {
        const { rows } = await pool.query('SELECT * FROM warehouse_config ORDER BY key');
        return new Response(JSON.stringify(rows), { headers: CORS });
      }

      // POST /api/config — update setting
      if (url.pathname === '/api/config' && req.method === 'POST') {
        const { key, value } = await req.json() as { key: string; value: any };
        await pool.query(`
          UPDATE warehouse_config SET value = $1::jsonb, updated_at = NOW() WHERE key = $2
        `, [JSON.stringify(value), key]);
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }

      // POST /api/run — trigger a sync layer
      if (url.pathname === '/api/run' && req.method === 'POST') {
        const { layer } = await req.json() as { layer: string };
        if (!['hourly', 'daily', 'weekly', 'therapists', 'appointments', 'initial'].includes(layer)) {
          return new Response(JSON.stringify({ error: 'invalid layer' }), { status: 400, headers: CORS });
        }

        const args = ['run', '/home/claude-user/clinic-agents/data-warehouse/src/sync-warehouse.ts', layer];
        const proc = spawn('/root/.bun/bin/bun', args, {
          cwd: '/home/claude-user/clinic-agents',
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        proc.unref();

        return new Response(JSON.stringify({ ok: true, pid: proc.pid, layer }), { headers: CORS });
      }

      // GET /api/health — show what's missing/stale
      if (url.pathname === '/api/health') {
        const { rows } = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM pets WHERE not_active = 0 OR not_active IS NULL) -
              (SELECT COUNT(DISTINCT pet_id) FROM visits) AS pets_without_visits,
            (SELECT COUNT(*) FROM appointments WHERE begin_date >= NOW()) AS upcoming_appointments,
            (SELECT MAX(started_at) FROM sync_runs WHERE status = 'success' AND layer = 'hourly') AS last_hourly,
            (SELECT MAX(started_at) FROM sync_runs WHERE status = 'success' AND layer = 'daily') AS last_daily,
            (SELECT MAX(started_at) FROM sync_runs WHERE status = 'success' AND layer = 'weekly') AS last_weekly,
            (SELECT MAX(started_at) FROM sync_runs WHERE status = 'success' AND layer = 'initial') AS last_initial,
            (SELECT value FROM warehouse_config WHERE key = 'initial_sync_done') AS initial_done
        `);
        return new Response(JSON.stringify(rows[0]), { headers: CORS });
      }

      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  },
});

console.log(`[warehouse-api] running on port ${PORT}`);
