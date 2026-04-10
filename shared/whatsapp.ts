/**
 * WhatsApp client for clinic-agents.
 *
 * As of 2026-04-09, this no longer talks to Green API directly.
 * Instead, it routes through the central WhatsApp Gateway at clinic-pal-hub
 * (FastAPI: shared/whatsapp_sender.py), which provides:
 *   - anti-block warm-up caps per number
 *   - smart routing between the two clinic numbers (035513649 vs 0552916466)
 *   - sticky-by-customer for sensitive categories (debt/confirmation)
 *   - send-hours, delays, burst pauses
 *   - centralized send_log in SQLite
 *
 * Backwards compatible: all callers using sendWhatsApp(phone, message) keep working.
 * For proper routing, agents SHOULD pass category + customer when known:
 *   sendWhatsApp(phone, msg, { category: "debt", customer: clientId, agent: "debt-agent" })
 */

const GATEWAY_URL = process.env.WA_GATEWAY_URL || "http://127.0.0.1:8000/api/whatsapp/send";

export type WhatsAppCategory =
  | "reminder"
  | "debt"
  | "followup"
  | "booking"
  | "confirmation"
  | "vaccine"
  | "marpet";

export interface SendOpts {
  category?: WhatsAppCategory;
  customer?: string;
  agent?: string;
  forceFrom?: string; // override sender (e.g. "035513649" or "0552916466")
}

// Auto-detect category by inspecting the calling agent path / argv[1].
// Best-effort fallback when agents donʼt pass an explicit category.
function autoCategory(): WhatsAppCategory {
  const argv = process.argv.join(" ");
  if (argv.includes("debt")) return "debt";
  if (argv.includes("vaccine")) return "vaccine";
  if (argv.includes("marpet")) return "marpet";
  if (argv.includes("appointment") || argv.includes("booking")) return "booking";
  if (argv.includes("followup")) return "followup";
  if (argv.includes("petconnect") || argv.includes("remind")) return "reminder";
  return "reminder";
}

export async function sendWhatsApp(
  phone: string,
  message: string,
  opts: SendOpts = {}
): Promise<{ sent: boolean; id?: string; error?: string; from?: string; skipped?: boolean; reason?: string }> {
  const category = opts.category || autoCategory();
  const body = {
    to: phone,
    message,
    category,
    customer: opts.customer || "",
    agent: opts.agent || autoCategory(),
    force_from: opts.forceFrom || "",
  };

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.skipped) {
      return { sent: false, skipped: true, reason: data.reason };
    }
    if (data.ok) {
      const result = data.result || {};
      return { sent: true, id: result.idMessage, from: data.from };
    }
    return { sent: false, error: data.result?.error || JSON.stringify(data) };
  } catch (e: any) {
    return { sent: false, error: "gateway unreachable: " + e.message };
  }
}
