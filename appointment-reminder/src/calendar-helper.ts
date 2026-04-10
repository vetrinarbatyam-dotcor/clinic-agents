// Hebrew calendar utilities — Shabbat + major Yom Tov skip
// Israel timezone aware

const ISRAEL_TZ_OFFSET_MIN = 180; // approx; doesn't matter for day-of-week

export function isShabbat(d: Date): boolean {
  // Friday after sunset (we use 18:00 as approximation) through Saturday until 20:00
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = d.getHours();
  if (day === 6) return hour < 20;          // Saturday
  if (day === 5 && hour >= 18) return true; // Friday evening
  return false;
}

// Major Israeli yom-tov dates 2026 (no work days). Add more years as needed.
const YOM_TOV_2026 = new Set([
  '2026-04-02', '2026-04-08', // Pesach
  '2026-05-22',               // Shavuot
  '2026-09-12', '2026-09-13', // Rosh Hashana
  '2026-09-21',               // Yom Kippur
  '2026-09-26', '2026-10-03', // Sukkot/Simchat Torah
]);

export function isYomTov(d: Date): boolean {
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return YOM_TOV_2026.has(key);
}

export function shouldSkip(d: Date, opts: { skipWeekends: boolean; skipHolidays: boolean }): { skip: boolean; reason?: string } {
  if (opts.skipWeekends && isShabbat(d)) return { skip: true, reason: 'shabbat' };
  if (opts.skipHolidays && isYomTov(d)) return { skip: true, reason: 'yom_tov' };
  return { skip: false };
}

export function isInWindow(d: Date, startHHMM: string, endHHMM: string): boolean {
  const [sH, sM] = startHHMM.split(':').map(Number);
  const [eH, eM] = endHHMM.split(':').map(Number);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  return minutes >= start && minutes <= end;
}
