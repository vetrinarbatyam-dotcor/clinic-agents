/**
 * Global opt-out module for clinic-agents.
 *
 * When a client asks to stop receiving messages ("תפסיקו", "הסירו אותי", etc.),
 * ALL agents stop sending to that phone number.
 *
 * Usage:
 *   import { isOptedOut, addOptOut, removeOptOut, detectOptOut } from '../shared/opt-out';
 */

import { pool } from './db';

// ── Keywords that trigger opt-out ──────────────────────────────────────────
const OPT_OUT_KEYWORDS = [
  'תפסיקו',
  'אל תשלחו',
  'הסירו אותי',
  'לא מעוניין',
  'לא מעוניינת',
  'הפסיקו לשלוח',
  'אל תפנו אלי',
  'מבקש להסיר',
  'מבקשת להסיר',
  'תמחקו אותי',
  'stop',
  'unsubscribe',
];

/**
 * Check if a phone number is opted out.
 * Returns true if the client has an active opt-out (not opted back in).
 */
export async function isOptedOut(phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const res = await pool.query(
    `SELECT 1 FROM client_opt_out
     WHERE phone =  AND opted_back_in_at IS NULL
     LIMIT 1`,
    [normalized]
  );
  return res.rowCount > 0;
}

/**
 * Add a phone to the opt-out list.
 */
export async function addOptOut(
  phone: string,
  opts: { clientName?: string; reason?: string; via?: string } = {}
): Promise<void> {
  const normalized = normalizePhone(phone);
  await pool.query(
    `INSERT INTO client_opt_out (phone, client_name, reason, opted_out_via)
     VALUES (, , , )
     ON CONFLICT (phone) DO UPDATE SET
       opted_out_at = NOW(),
       opted_back_in_at = NULL,
       reason = COALESCE(EXCLUDED.reason, client_opt_out.reason),
       client_name = COALESCE(EXCLUDED.client_name, client_opt_out.client_name),
       opted_out_via = EXCLUDED.opted_out_via`,
    [normalized, opts.clientName || null, opts.reason || null, opts.via || 'auto_reply']
  );
}

/**
 * Remove a phone from the opt-out list (opt back in).
 */
export async function removeOptOut(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  await pool.query(
    `UPDATE client_opt_out SET opted_back_in_at = NOW() WHERE phone = `,
    [normalized]
  );
}

/**
 * Detect if a message contains opt-out intent.
 * Returns true if the message matches any opt-out keyword.
 */
export function detectOptOut(message: string): boolean {
  const norm = message.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.some(kw => norm.includes(kw));
}

/**
 * List all currently opted-out clients.
 */
export async function listOptedOut(): Promise<Array<{
  id: number;
  phone: string;
  client_name: string | null;
  reason: string | null;
  opted_out_at: string;
  opted_out_via: string;
}>> {
  const res = await pool.query(
    `SELECT id, phone, client_name, reason, opted_out_at, opted_out_via
     FROM client_opt_out
     WHERE opted_back_in_at IS NULL
     ORDER BY opted_out_at DESC`
  );
  return res.rows;
}

/**
 * Get total count of opted-out clients.
 */
export async function optOutCount(): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*) AS count FROM client_opt_out WHERE opted_back_in_at IS NULL`
  );
  return Number(res.rows[0].count);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return digits;
}
