// Hebrew calendar utilities — Shabbat + major Yom Tov skip
// Uses @hebcal/core for dynamic holiday calculation (no hardcoded dates)

import { isYomTov as _isYomTov, isShabbat as _isShabbat } from "../../shared/holidays";

export function isShabbat(d: Date): boolean {
  return _isShabbat(d);
}

export function isYomTov(d: Date): boolean {
  return _isYomTov(d);
}

export function shouldSkip(d: Date, opts: { skipWeekends: boolean; skipHolidays: boolean }): { skip: boolean; reason?: string } {
  if (opts.skipWeekends && isShabbat(d)) return { skip: true, reason: "shabbat" };
  if (opts.skipHolidays && isYomTov(d)) return { skip: true, reason: "yom_tov" };
  return { skip: false };
}

export function isInWindow(d: Date, startHHMM: string, endHHMM: string): boolean {
  const [sH, sM] = startHHMM.split(":").map(Number);
  const [eH, eM] = endHHMM.split(":").map(Number);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  return minutes >= start && minutes <= end;
}
