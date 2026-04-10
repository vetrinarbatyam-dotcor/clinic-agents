// Cron entrypoint — runs hourly. Inside, checks send-window and skip rules.
import { scanAndProcess } from './scanner';
import { isInWindow, shouldSkip } from './calendar-helper';
import { loadConfig } from './db';
import { DEFAULT_CONFIG, type ApptReminderConfig } from './config';

const cfgRow = await loadConfig();
const cfg: ApptReminderConfig = { ...DEFAULT_CONFIG, ...(cfgRow || {}) };
if (!cfg.enabled) {
  console.log('[cron] agent disabled — exiting');
  process.exit(0);
}
const now = new Date();
if (!isInWindow(now, cfg.send_window_start, cfg.send_window_end)) {
  console.log(`[cron] outside window ${cfg.send_window_start}-${cfg.send_window_end} — exit`);
  process.exit(0);
}
const skip = shouldSkip(now, { skipWeekends: cfg.skip_weekends, skipHolidays: cfg.skip_holidays });
if (skip.skip) {
  console.log(`[cron] skip reason=${skip.reason}`);
  process.exit(0);
}
const r = await scanAndProcess();
console.log(`[cron] result: ${JSON.stringify(r)}`);
process.exit(0);
