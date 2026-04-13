import { HebrewCalendar } from "@hebcal/core";

// Cache holidays per year
const cache = new Map<number, Set<string>>();

/**
 * Get all Israeli Yom Tov dates for a given Gregorian year as YYYY-MM-DD strings.
 * Includes: Rosh Hashana, Yom Kippur, Sukkot (1st + Shmini Atzeret), Pesach (1st + 7th), Shavuot
 * Uses @hebcal/core for accurate Hebrew calendar calculation.
 */
export function getHolidaysForYear(year: number): Set<string> {
  if (cache.has(year)) return cache.get(year)!;

  const events = HebrewCalendar.calendar({
    year,
    isHebrewYear: false,
    il: true,
    candlelighting: false,
    sedrot: false,
    omer: false,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });

  const holidays = new Set<string>();

  for (const ev of events) {
    const mask = ev.getFlags();
    // CHAG flag (0x01) = yom tov / no-work day
    if (mask & 0x01) {
      // Use toISOString() to get the UTC date string, which corresponds
      // to the correct Hebrew calendar date (greg() returns midnight Israel time as UTC)
      const isoDate = ev.getDate().greg().toISOString().split("T")[0];
      holidays.add(isoDate);
    }
  }

  cache.set(year, holidays);
  return holidays;
}

/**
 * Check if a date falls on an Israeli Yom Tov (major holiday, no work).
 */
export function isYomTov(date: Date = new Date()): boolean {
  // Use Israel timezone to get the correct local date
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // returns YYYY-MM-DD
  const year = parseInt(parts.substring(0, 4));
  // Check current and next year (Tishrei holidays may span Gregorian year boundary)
  return getHolidaysForYear(year).has(parts) || getHolidaysForYear(year + 1).has(parts);
}

/**
 * Check if now is Shabbat in Israel (Friday ~16:00 to Saturday ~20:00).
 */
export function isShabbat(date: Date = new Date()): boolean {
  const il = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const day = il.getDay();
  const hour = il.getHours();
  return (day === 5 && hour >= 16) || (day === 6 && hour < 20);
}

/**
 * Check if now is Shabbat or Yom Tov — should not send messages.
 */
export function isRestDay(date: Date = new Date()): boolean {
  return isShabbat(date) || isYomTov(date);
}
