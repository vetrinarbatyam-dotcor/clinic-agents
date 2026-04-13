import { handleIncomingReply } from './response-handler';
import { pool } from './db';
const PORT = Number(process.env.APPT_WEBHOOK_PORT || 3457);

const CORS = {
  'Access-Control-Allow-Origin': 'http://167.86.69.208:3000',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};


const API_KEY = process.env.API_KEY || '';

function checkAuth(req: Request): Response | null {
  const url = new URL(req.url);
  if (url.pathname === '/health' || url.pathname === '/healthz') return null;
  // Exempt Green API webhook callbacks (POST /) - they don't carry our API key
  if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/webhook')) return null;
  const auth = req.headers.get('authorization');
  if (!API_KEY || auth !== `Bearer ${API_KEY}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}


function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)@.*]/g, '');
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  else if (p.startsWith('972')) p = '0' + p.slice(3);
  return p;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Auth check
    const authErr = checkAuth(req);
    if (authErr) return authErr;

    if (url.pathname === '/stats' && req.method === 'GET') {
      try {
        const r = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_type='reminder_queued' AND created_at::date = CURRENT_DATE) AS sent,
            COUNT(*) FILTER (WHERE event_type='reply_canceled'  AND created_at::date = CURRENT_DATE) AS rejected,
            COUNT(*) FILTER (WHERE event_type='reminder_queued'
                             AND created_at >= NOW() - INTERVAL '24 hours'
                             AND NOT EXISTS (
                               SELECT 1 FROM appt_reminder_runs r2
                               WHERE r2.phone = appt_reminder_runs.phone
                               AND r2.event_type LIKE 'reply_%'
                               AND r2.created_at > appt_reminder_runs.created_at
                             )) AS pending
          FROM appt_reminder_runs
        `);
        return Response.json(r.rows[0], { headers: CORS });
      } catch (e: any) {
        return Response.json({ error: e.message, pending: 0, sent: 0, rejected: 0 }, { status: 500, headers: CORS });
      }
    }

    if (req.method !== 'POST') return new Response('OK', { status: 200, headers: CORS });
    try {
      const body: any = await req.json();
      // Green API webhook shape
      // Validate Green API webhook structure
      if (!body.typeWebhook || !body.instanceData) {
        return Response.json({ error: 'Invalid webhook payload' }, { status: 400, headers: CORS });
      }
      if (body.typeWebhook === 'incomingMessageReceived') {
        const phone = normalizePhone(body.senderData?.sender || '');
        const text = body.messageData?.textMessageData?.textMessage
                  || body.messageData?.extendedTextMessageData?.text
                  || '';
        if (phone && text) {
          const r = await handleIncomingReply(phone, text);
          return Response.json({ ok: true, ...r }, { headers: CORS });
        }
      }
      return Response.json({ ok: true, ignored: true }, { headers: CORS });
    } catch (e: any) {
      console.error('[webhook]', e);
      return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS });
    }
  },
});
console.log(`[appointment-reminder webhook] listening on :${PORT}`);
