// PetConnect — API Server for Dashboard
// Runs on port 3002, serves filter/send endpoints

import 'dotenv/config';
import pg from 'pg';
import { filterClients, deduplicateByClient, getFilterSummary, type FilterCriteria } from './filter-engine.ts';
import { sendMessages } from './message-sender.ts';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'clinicpal',
  user: process.env.DB_USER || 'clinicpal_user',
  password: process.env.DB_PASSWORD || 'clinicpal2306',
});

const PORT = parseInt(process.env.PETCONNECT_PORT || '3002');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // GET /api/breeds — list all breeds
      if (url.pathname === '/api/breeds' && req.method === 'GET') {
        const { rows } = await pool.query(`
          SELECT DISTINCT breed FROM pets
          WHERE breed IS NOT NULL AND breed != ''
          ORDER BY breed
        `);
        return new Response(JSON.stringify(rows.map(r => r.breed)), { headers: CORS_HEADERS });
      }

      // GET /api/stats — summary stats
      if (url.pathname === '/api/stats' && req.method === 'GET') {
        const { rows } = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM clients WHERE not_active = 0 OR not_active IS NULL) as total_clients,
            (SELECT COUNT(*) FROM pets WHERE not_active = 0 OR not_active IS NULL) as total_pets,
            (SELECT COUNT(DISTINCT species) FROM pets WHERE species IS NOT NULL AND species != '') as species_count
        `);
        return new Response(JSON.stringify(rows[0]), { headers: CORS_HEADERS });
      }

      // POST /api/filter — filter clients
      if (url.pathname === '/api/filter' && req.method === 'POST') {
        const body = await req.json() as { filters: FilterCriteria };
        const allClients = await filterClients(pool, body.filters);
        const clients = deduplicateByClient(allClients);
        const summary = getFilterSummary(clients);
        return new Response(JSON.stringify({ clients, summary }), { headers: CORS_HEADERS });
      }

      // POST /api/send — send messages
      if (url.pathname === '/api/send' && req.method === 'POST') {
        const body = await req.json() as {
          filters: FilterCriteria;
          message: string;
          category: string;
          dryRun: boolean;
        };

        const allClients = await filterClients(pool, body.filters);
        const clients = deduplicateByClient(allClients);
        const result = await sendMessages(pool, clients, body.message, 'petconnect', body.category, {
          dryRun: body.dryRun,
          delayMs: 3000,
          maxPerWeek: 1,
        });

        return new Response(JSON.stringify(result), { headers: CORS_HEADERS });
      }

      // GET /api/history — recent send history
      if (url.pathname === '/api/history' && req.method === 'GET') {
        const { rows } = await pool.query(`
          SELECT client_name, client_phone, pet_name, category, status, sent_at, created_at
          FROM pending_messages
          WHERE agent_id = 'petconnect'
          ORDER BY created_at DESC
          LIMIT 100
        `);
        return new Response(JSON.stringify(rows), { headers: CORS_HEADERS });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });

    } catch (e: any) {
      console.error('[petconnect-api] Error:', e.message);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
    }
  },
});

console.log(`[petconnect-api] Running on http://0.0.0.0:${PORT}`);
