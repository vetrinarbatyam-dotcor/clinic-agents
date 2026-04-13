import { isRestDay } from "../../shared/holidays";
// PetConnect — Message Sender
// Handles sending WhatsApp messages with rate limiting, dedup, and scheduling rules

import 'dotenv/config';
import pg from 'pg';
import { sendWhatsApp } from '../../shared/whatsapp.ts';
import { getIsraelDate, isShabbatOrHoliday } from '../../shared/clinica.ts';
import type { FilteredClient } from './filter-engine.ts';


export interface SendConfig {
  minHour: number;       // default 9
  maxHour: number;       // default 19
  noShabbat: boolean;    // default true
  noHoliday: boolean;    // default true
  delayMs: number;       // default 3000 (3 seconds between messages)
  maxPerWeek: number;    // default 1 per client
  dryRun: boolean;       // default false
}

const DEFAULT_CONFIG: SendConfig = {
  minHour: 9,
  maxHour: 19,
  noShabbat: true,
  noHoliday: true,
  delayMs: 3000,
  maxPerWeek: 1,
  dryRun: false,
};

export interface SendResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
  details: Array<{
    client: string;
    pet: string;
    phone: string;
    status: 'sent' | 'skipped' | 'failed';
    reason?: string;
  }>;
}

// Check if current time is within sending window
function isWithinSendingWindow(config: SendConfig): { ok: boolean; reason?: string } {
  const now = getIsraelDate();
  const hour = now.getHours();

  if (hour < config.minHour || hour >= config.maxHour) {
    return { ok: false, reason: `outside_hours (${hour}:00, allowed ${config.minHour}-${config.maxHour})` };
  }

  if (config.noShabbat && isShabbatOrHoliday(now)) {
    return { ok: false, reason: 'shabbat' };
  }

  if (config.noHoliday && isRestDay(now)) {
    return { ok: false, reason: 'holiday' };
  }

  return { ok: true };
}

// Check if client was already messaged this week (dedup by name+pet)
async function wasMessagedThisWeek(
  pool: pg.Pool,
  clientName: string,
  petName: string,
  maxPerWeek: number
): Promise<boolean> {
  const { rows } = await pool.query(`
    SELECT COUNT(*) as cnt FROM pending_messages
    WHERE client_name = $1 AND pet_name = $2
    AND status IN ('sent', 'approved', 'pending')
    AND created_at >= NOW() - INTERVAL '7 days'
  `, [clientName, petName]);

  return parseInt(rows[0].cnt) >= maxPerWeek;
}

// Send messages to filtered clients
export async function sendMessages(
  pool: pg.Pool,
  clients: FilteredClient[],
  messageTemplate: string,
  agentId: string,
  category: string,
  config: Partial<SendConfig> = {}
): Promise<SendResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const result: SendResult = { total: clients.length, sent: 0, skipped: 0, failed: 0, reasons: {}, details: [] };

  // Check sending window
  const window = isWithinSendingWindow(cfg);
  if (!window.ok && !cfg.dryRun) {
    console.log(`[sender] Cannot send now: ${window.reason}`);
    result.skipped = clients.length;
    result.reasons[window.reason!] = clients.length;
    return result;
  }

  for (const client of clients) {
    const fullName = client.full_name || `${client.first_name} ${client.last_name}`.trim();

    // Dedup check
    const alreadySent = await wasMessagedThisWeek(pool, fullName, client.pet_name, cfg.maxPerWeek);
    if (alreadySent) {
      result.skipped++;
      result.reasons['already_messaged_this_week'] = (result.reasons['already_messaged_this_week'] || 0) + 1;
      result.details.push({ client: fullName, pet: client.pet_name, phone: client.cell_phone, status: 'skipped', reason: 'already_messaged_this_week' });
      continue;
    }

    // Build personalized message
    const message = personalizeMessage(messageTemplate, client);

    // Insert to pending_messages queue
    await pool.query(`
      INSERT INTO pending_messages (id, agent_id, client_name, client_phone, pet_name, category, message_text, status)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
    `, [agentId, fullName, client.cell_phone, client.pet_name, category, message, cfg.dryRun ? 'pending' : 'approved']);

    if (cfg.dryRun) {
      result.sent++;
      result.details.push({ client: fullName, pet: client.pet_name, phone: client.cell_phone, status: 'sent', reason: 'dry_run' });
      continue;
    }

    // Actually send via WhatsApp
    try {
      const wa = await sendWhatsApp(client.cell_phone, message);
      if (wa.sent) {
        await pool.query(`
          UPDATE pending_messages SET status = 'sent', sent_at = NOW()
          WHERE client_phone = $1 AND pet_name = $2 AND status = 'approved'
          AND created_at >= NOW() - INTERVAL '1 minute'
        `, [client.cell_phone, client.pet_name]);

        result.sent++;
        result.details.push({ client: fullName, pet: client.pet_name, phone: client.cell_phone, status: 'sent' });
      } else {
        result.failed++;
        result.reasons['whatsapp_error'] = (result.reasons['whatsapp_error'] || 0) + 1;
        result.details.push({ client: fullName, pet: client.pet_name, phone: client.cell_phone, status: 'failed', reason: wa.error });
      }
    } catch (e: any) {
      result.failed++;
      result.reasons['exception'] = (result.reasons['exception'] || 0) + 1;
      result.details.push({ client: fullName, pet: client.pet_name, phone: client.cell_phone, status: 'failed', reason: e.message });
    }

    // Rate limit delay
    if (cfg.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, cfg.delayMs));
    }
  }

  return result;
}

// Replace placeholders in message template
function personalizeMessage(template: string, client: FilteredClient): string {
  return template
    .replace(/\{שם_בעלים\}/g, client.full_name || `${client.first_name} ${client.last_name}`.trim())
    .replace(/\{שם\}/g, client.first_name || client.full_name?.split(' ')[0] || '')
    .replace(/\{שם_משפחה\}/g, client.last_name || '')
    .replace(/\{שם_חיה\}/g, client.pet_name || '')
    .replace(/\{גזע\}/g, client.breed || '')
    .replace(/\{סוג\}/g, client.species || '')
    .replace(/\{גיל\}/g, client.age_years?.toString() || '')
    .replace(/\{ביטוח\}/g, client.insurance_name || '')
    .replace(/\{משקל\}/g, client.weight?.toString() || '')
    .replace(/\{owner_name\}/g, client.full_name || '')
    .replace(/\{pet_name\}/g, client.pet_name || '')
    .replace(/\{breed\}/g, client.breed || '')
    .replace(/\{species\}/g, client.species || '')
    .replace(/\{age\}/g, client.age_years?.toString() || '')
    .replace(/\{insurance\}/g, client.insurance_name || '');
}

export { personalizeMessage };
