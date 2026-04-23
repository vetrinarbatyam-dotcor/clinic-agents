/**
 * WhatsApp notifier — sends a concise audit summary to Gil (and anyone else
 * listed in config.whatsapp_recipients) whenever a run completes with findings.
 *
 * The message is a 5-line digest plus the top 3 worst cases plus a link back
 * to the dashboard. We keep it short on purpose: Gil gets a lot of bot traffic,
 * and the full detail is one tap away at /auditor.
 */
import { sendWhatsApp } from "../../shared/whatsapp";
import type { FindingInput } from "./storage/findings";
import type { RunStats } from "./storage/runs";

interface NotifyArgs {
  runId: number;
  periodStart: string;
  periodEnd: string;
  stats: RunStats;
  topFindings: FindingInput[];
  recipients: string[];
  dashboardUrl?: string;
}

function buildMessage(args: NotifyArgs): string {
  const { runId, periodStart, periodEnd, stats, topFindings, dashboardUrl } = args;
  const periodLabel =
    periodStart === periodEnd
      ? periodStart
      : `${periodStart} ← ${periodEnd}`;

  const header = `🔍 *ביקורת שיחות* — ${periodLabel}`;
  const summary = [
    `📊 נסרקו ${stats.conversationsScanned} שיחות`,
    `⚠️ ${stats.findingsTotal} ממצאים (${stats.findingsBySeverity.critical} קריטי, ${stats.findingsBySeverity.high} גבוה)`,
  ].join("\n");

  const topLines = topFindings
    .slice(0, 3)
    .map((f, i) => {
      const name = f.conversation.customerName ?? f.conversation.petName ?? f.conversation.phone;
      const brief = f.analysis.whatWentWrong.split("\n")[0]!.slice(0, 100);
      return `${i + 1}. [${f.analysis.score}] ${name} — ${brief}`;
    })
    .join("\n");

  const link = dashboardUrl ?? "http://167.86.69.208:3000/auditor";

  return [
    header,
    "",
    summary,
    "",
    topFindings.length > 0 ? "*3 הבעייתיים ביותר:*" : "(אין ממצאים לסקירה)",
    topLines,
    "",
    `לאישור/דחייה: ${link}`,
    `(ריצה #${runId})`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export async function notifyRun(args: NotifyArgs): Promise<{ sent: number; skipped: number }> {
  if (args.recipients.length === 0) return { sent: 0, skipped: 0 };
  if (args.stats.findingsTotal === 0) {
    console.log("[notifier] no findings — skipping WhatsApp summary");
    return { sent: 0, skipped: args.recipients.length };
  }

  const message = buildMessage(args);
  let sent = 0;
  let skipped = 0;

  for (const phone of args.recipients) {
    try {
      const res = await sendWhatsApp(phone, message, {
        category: "followup",
        agent: "conversation-booker-auditor",
      });
      if (res.sent) {
        console.log(`[notifier] sent to ${phone} (from=${res.from ?? "?"})`);
        sent++;
      } else {
        console.log(`[notifier] skipped ${phone}: ${res.reason ?? res.error ?? "unknown"}`);
        skipped++;
      }
    } catch (err) {
      console.error(`[notifier] send to ${phone} failed:`, (err as Error).message);
      skipped++;
    }
  }

  return { sent, skipped };
}
