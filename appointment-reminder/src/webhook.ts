import { handleIncomingReply } from './response-handler';
import { pool } from './db';
const PORT = Number(process.env.APPT_WEBHOOK_PORT || 3457);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

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
      if (body.typeWebhook === 'incomingMessageReceived') {
        const phone = (body.senderData?.sender || '').replace(/@.*/, '');
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
