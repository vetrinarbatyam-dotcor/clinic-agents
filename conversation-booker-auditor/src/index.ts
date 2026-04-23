/**
 * conversation-booker-auditor — entry point.
 *
 * Usage: bun run src/index.ts [--dry-run] [--frequency daily|weekly] [--date YYYY-MM-DD]
 *
 * Flow:
 *   1. load config (exit silently if enabled=false, unless --dry-run)
 *   2. create audit_runs row (status=running)
 *   3. collect booker_sessions + reminders for the period
 *   4. analyze each conversation with rule-based scorer
 *   5. keep only findings with score > 0, sort desc, cap at max(top_n, count≥threshold)
 *   6. insert rows into audit_findings
 *   7. complete run with stats + markdown summary (status=pending_review)
 *
 * Phase 3 will slot between steps 5 and 6 to run LLM deep-review on
 * high-score findings and rewrite their narratives.
 */
import "dotenv/config";
import { loadConfig } from "./config";
import { collectAll } from "./collectors";
import { analyze } from "./analyzer/scorer";
import { createRun, completeRun, failRun, type RunStats } from "./storage/runs";
import { insertFindings, type FindingInput } from "./storage/findings";
import { reviewBatch, applyReviews } from "./analyzer/llm_review";
import { notifyRun } from "./notifier";
import { pool } from "../../shared/db";

interface CliArgs {
  dryRun: boolean;
  frequency?: "daily" | "weekly";
  date?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--frequency") args.frequency = argv[++i] as "daily" | "weekly";
    else if (a === "--date") args.date = argv[++i];
  }
  return args;
}

function computePeriod(
  frequency: "daily" | "weekly",
  asOf: string
): { periodStart: string; periodEnd: string } {
  const end = new Date(asOf + "T00:00:00");
  if (frequency === "daily") {
    return { periodStart: asOf, periodEnd: asOf };
  }
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: asOf,
  };
}

function severityOf(score: number): "critical" | "high" | "medium" | "low" {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function buildSummaryMarkdown(
  periodStart: string,
  periodEnd: string,
  stats: RunStats,
  topFindings: FindingInput[]
): string {
  const header =
    periodStart === periodEnd
      ? `# ביקורת יומית — ${periodStart}`
      : `# ביקורת שבועית — ${periodStart} עד ${periodEnd}`;

  const categoryLines = Object.entries(stats.findingsByCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, n]) => `- **${cat}**: ${n}`)
    .join("\n");

  const topLines = topFindings
    .slice(0, 10)
    .map((f, i) => {
      const name = f.conversation.customerName ?? f.conversation.phone;
      const pet = f.conversation.petName ? ` / ${f.conversation.petName}` : "";
      return `${i + 1}. **[${f.analysis.score}] ${f.analysis.category}** — ${name}${pet}\n   ${f.analysis.whatWentWrong.split("\n")[0]}`;
    })
    .join("\n\n");

  return [
    header,
    "",
    `## סיכום`,
    `- שיחות נסרקו: ${stats.conversationsScanned}`,
    `- ממצאים: ${stats.findingsTotal} (קריטיות: ${stats.findingsBySeverity.critical}, גבוהות: ${stats.findingsBySeverity.high})`,
    "",
    `## פירוט לפי קטגוריה`,
    categoryLines || "- (אין ממצאים)",
    "",
    `## עשר השיחות הבעייתיות ביותר`,
    topLines || "- (אין)",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  console.log(
    `[auditor] config: enabled=${config.enabled} frequency=${config.frequency} run_hour=${config.run_hour}`
  );

  if (!config.enabled && !args.dryRun) {
    console.log("[auditor] disabled in config — exiting. (Use --dry-run to force a simulation.)");
    await pool.end();
    return;
  }

  const frequency = args.frequency ?? config.frequency;
  const asOf = args.date ?? new Date().toISOString().slice(0, 10);
  const { periodStart, periodEnd } = computePeriod(frequency, asOf);
  const runType = args.dryRun ? "manual" : frequency;

  console.log(`[auditor] run_type=${runType} period=${periodStart}..${periodEnd} dry_run=${args.dryRun}`);

  const runId = await createRun(runType, periodStart, periodEnd);
  console.log(`[auditor] created audit_runs.id=${runId}`);

  try {
    const conversations = await collectAll(periodStart, periodEnd);
    console.log(`[auditor] collected ${conversations.length} conversations`);

    const allResults: FindingInput[] = conversations
      .map((c) => ({ conversation: c, analysis: analyze(c) }))
      .filter((f) => f.analysis.score > 0);

    allResults.sort((a, b) => b.analysis.score - a.analysis.score);

    const threshold = config.llm_review_threshold_score;
    const topN = config.top_n_problematic;
    const aboveThreshold = allResults.filter((f) => f.analysis.score >= threshold);
    const toStore =
      aboveThreshold.length >= topN
        ? aboveThreshold
        : allResults.slice(0, Math.max(topN, aboveThreshold.length));

    console.log(
      `[auditor] scored: total=${allResults.length} above_threshold(${threshold})=${aboveThreshold.length} storing=${toStore.length}`
    );

    // Phase 3: LLM deep-review on the findings we're about to store.
    // Reviewer refines narratives in Hebrew and can shift severity ±20.
    // On any failure (quota, parse, timeout) we keep the rule-based narrative
    // and leave llm_reviewed=false — the audit still ships.
    if (toStore.length > 0) {
      console.log(`[auditor] LLM review starting for ${toStore.length} findings (model=${config.llm_model})`);
      const t0 = Date.now();
      const reviews = await reviewBatch(toStore);
      const { applied } = applyReviews(toStore, reviews);
      // Mark llmReviewed on each FindingInput so storage records the flag.
      toStore.forEach((f, i) => { f.llmReviewed = reviews.has(i); });
      // Re-sort because severity adjustments may have reshuffled ranks.
      toStore.sort((a, b) => b.analysis.score - a.analysis.score);
      console.log(`[auditor] LLM review done: applied=${applied}/${toStore.length} in ${Date.now() - t0}ms`);
    }

    const stats: RunStats = {
      conversationsScanned: conversations.length,
      findingsTotal: toStore.length,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      findingsByCategory: {},
    };
    for (const f of toStore) {
      stats.findingsBySeverity[severityOf(f.analysis.score)]++;
      stats.findingsByCategory[f.analysis.category] =
        (stats.findingsByCategory[f.analysis.category] ?? 0) + 1;
    }

    const inserted = await insertFindings(runId, toStore);
    console.log(`[auditor] inserted ${inserted} findings`);

    const summary = buildSummaryMarkdown(periodStart, periodEnd, stats, toStore);
    await completeRun(runId, stats, summary, {
      rules_version: "phase2-v1",
      threshold_used: threshold,
      conversations_clean: conversations.length - allResults.length,
    });
    console.log(`[auditor] run ${runId} complete — status=pending_review`);

    // Notify Gil by WhatsApp if configured. Dry-runs skip the send but still
    // print the message so we can eyeball the format without spamming his phone.
    if (config.send_whatsapp && !args.dryRun) {
      const notifyRes = await notifyRun({
        runId,
        periodStart,
        periodEnd,
        stats,
        topFindings: toStore,
        recipients: config.whatsapp_recipients,
      });
      console.log(`[auditor] notifier: sent=${notifyRes.sent} skipped=${notifyRes.skipped}`);
    } else if (config.send_whatsapp && args.dryRun) {
      console.log("[auditor] notifier: dry-run — WhatsApp send skipped");
    }

    if (args.dryRun) {
      console.log("\n" + "─".repeat(60));
      console.log(summary);
      console.log("─".repeat(60));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[auditor] run ${runId} failed: ${msg}`);
    await failRun(runId, msg.slice(0, 2000));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[auditor] fatal:", err);
  process.exit(1);
});
