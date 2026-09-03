import { readFileSync } from 'node:fs';

/**
 * A CSV reader that handles quoted fields, embedded commas and doubled quotes.
 *
 * Build-time only -- nothing in the shipped app parses CSV. Shared by the
 * dataset build and the schedule build so a quoting bug can only ever be fixed
 * once. (The schedule file needs it: stadium names contain commas.)
 */
export function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8');
  const rows: Record<string, string>[] = [];
  let header: string[] | null = null;
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => {
    pushField();
    if (record.length === 1 && record[0] === '') { record = []; return; }
    if (!header) header = record;
    else rows.push(Object.fromEntries(header.map((h, i) => [h, record[i] ?? ''])));
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') pushRecord();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) pushRecord();
  return rows;
}

/**
 * The UTC instant of a wall-clock time in US Eastern.
 *
 * The schedule states kickoffs in the league's own time zone with no offset
 * attached, and the client must not be the thing that decides what "13:00"
 * meant -- a device in Berlin would put a Sunday board on a Monday. The US
 * rule since 2007 is second Sunday in March to first Sunday in November,
 * switching at 02:00 local; every kickoff in the file is between 09:30 and
 * 23:00, so the transition hour is never in play and a date-level offset is
 * exact.
 */
export function easternToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const offset = easternOffsetHours(year, month, day);
  return new Date(Date.UTC(year, month - 1, day, hour + offset, minute));
}

/** 4 during daylight time, 5 during standard time — hours to add to reach UTC. */
function easternOffsetHours(year: number, month: number, day: number): number {
  const dstStart = nthWeekdayOfMonth(year, 3, 0, 2);  // second Sunday in March
  const dstEnd = nthWeekdayOfMonth(year, 11, 0, 1);   // first Sunday in November
  const at = Date.UTC(year, month - 1, day);
  return at >= dstStart && at < dstEnd ? 4 : 5;
}

/** UTC midnight of the `nth` `weekday` (0=Sunday) in `month` (1-12). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return Date.UTC(year, month - 1, 1 + shift + (nth - 1) * 7);
}
