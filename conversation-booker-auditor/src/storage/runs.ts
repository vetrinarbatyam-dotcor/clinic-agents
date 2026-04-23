/**
 * audit_runs storage: create the row on start, mark completed (or failed)
 * on finish. Stats/insights/summary go on the completion write — keeping
 * the running row small means a crash mid-run is easy to see in the table.
 */
import { pool } from "../../../shared/db";

export interface RunStats {
  conversationsScanned: number;
  findingsTotal: number;
  findingsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  findingsByCategory: Record<string, number>;
}

export async function createRun(
  runType: "daily" | "weekly" | "manual",
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO audit_runs (run_type, period_start, period_end, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [runType, periodStart, periodEnd]
  );
  return rows[0]!.id;
}

export async function completeRun(
  runId: number,
  stats: RunStats,
  summaryMarkdown: string,
  aggregateInsights: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE audit_runs
        SET status = 'pending_review',
            completed_at = NOW(),
            stats = $2::jsonb,
            summary_markdown = $3,
            aggregate_insights = $4::jsonb
      WHERE id = $1`,
    [runId, JSON.stringify(stats), summaryMarkdown, JSON.stringify(aggregateInsights)]
  );
}

export async function failRun(runId: number, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE audit_runs
        SET status = 'failed',
            completed_at = NOW(),
            error_message = $2
      WHERE id = $1`,
    [runId, errorMessage]
  );
}
