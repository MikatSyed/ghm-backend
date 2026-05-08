import { addDays, format, startOfDay, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export const DHAKA_TZ = 'Asia/Dhaka';

export function nowInDhaka(): Date {
  return toZonedTime(new Date(), DHAKA_TZ);
}

export function dhakaDayBoundsUtc(d: Date = new Date()): { startUtc: Date; endUtc: Date } {
  const zoned = toZonedTime(d, DHAKA_TZ);
  const dayStartZoned = startOfDay(zoned);
  const dayEndZoned = addDays(dayStartZoned, 1);
  return {
    startUtc: fromZonedTime(dayStartZoned, DHAKA_TZ),
    endUtc: fromZonedTime(dayEndZoned, DHAKA_TZ),
  };
}

export function dhakaRangeUtc(timeframe: 'daily' | 'weekly' | 'monthly' | 'yearly'): {
  startUtc: Date;
  endUtc: Date;
} {
  const zoned = toZonedTime(new Date(), DHAKA_TZ);
  let start: Date;
  switch (timeframe) {
    case 'daily':
      start = startOfDay(zoned);
      break;
    case 'weekly':
      start = startOfWeek(zoned, { weekStartsOn: 6 }); // Sat-start common in BD
      break;
    case 'monthly':
      start = startOfMonth(zoned);
      break;
    case 'yearly':
      start = startOfYear(zoned);
      break;
  }
  return {
    startUtc: fromZonedTime(start, DHAKA_TZ),
    endUtc: fromZonedTime(new Date(), DHAKA_TZ),
  };
}

export function dhakaDateString(d: Date = new Date()): string {
  return format(toZonedTime(d, DHAKA_TZ), 'yyyy-MM-dd');
}

/** Today's Dhaka calendar date as UTC-midnight Date (for @db.Date columns). */
export function dhakaTodayDateOnly(): Date {
  return new Date(`${dhakaDateString()}T00:00:00.000Z`);
}

/** YYYY-MM-DD (Dhaka calendar) → UTC-midnight Date suitable for Prisma @db.Date columns. */
export function parseDhakaDateOnly(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Invalid date string: ${input}`);
  }
  return new Date(`${input}T00:00:00.000Z`);
}

export function monthBoundsUtc(yyyyMm: string): {
  startUtc: Date;
  endUtc: Date;
  startDateOnly: Date;
  endDateOnly: Date;
} {
  const [y, m] = yyyyMm.split('-').map(Number);
  const startUtc = fromZonedTime(`${yyyyMm}-01T00:00:00`, DHAKA_TZ);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endUtc = fromZonedTime(`${nextMonth}-01T00:00:00`, DHAKA_TZ);
  return {
    startUtc,
    endUtc,
    startDateOnly: new Date(`${yyyyMm}-01T00:00:00.000Z`),
    endDateOnly: new Date(`${nextMonth}-01T00:00:00.000Z`),
  };
}
