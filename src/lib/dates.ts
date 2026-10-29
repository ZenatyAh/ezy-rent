// Conversions between 'YYYY-MM-DD' strings, Prisma DATE values and instants. All UTC-only, so the
// machine timezone never matters. A Prisma `date` column is a JS Date at 00:00 UTC.

const MALAYSIA_OFFSET_MS = 8 * 3_600_000

export function dateFromIso(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// An instant written in Malaysia time with its offset, e.g. 2026-03-01T00:30:00.000+08:00.
export function toMalaysiaIso(instant: Date): string {
  return new Date(instant.getTime() + MALAYSIA_OFFSET_MS).toISOString().replace('Z', '+08:00')
}

function isRealDay(year: number, month: number, day: number): boolean {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// An instant written as ISO 8601 with an explicit offset, e.g. 2026-03-01T00:30:00+08:00 or ...Z.
// A string without an offset is rejected: it would be read in the server's timezone. new Date() alone
// is too lenient (it turns 2026-02-30 into Mar 2 and accepts 24:00), so the parts are checked first.
export function parseOffsetInstant(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value)
  if (!match) throw new Error('must be an ISO 8601 date and time with an offset, e.g. 2026-03-01T00:30:00+08:00')
  const [, year, month, day, hour, minute, second = '0', , offsetHour = '0', offsetMinute = '0'] = match
  if (
    !isRealDay(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour) > 23 ||
    Number(offsetMinute) > 59
  ) {
    throw new Error('is not a real date and time')
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('is not a real date and time')
  return date
}

// Every month from `from` to `to` inclusive, as 'YYYY-MM'. Both must be valid 'YYYY-MM' with from <= to.
export function monthRange(from: string, to: string): string[] {
  const parse = (value: string): number => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
    if (!match) throw new Error(`${value} is not a month written as YYYY-MM`)
    return Number(match[1]) * 12 + Number(match[2]) - 1
  }
  const start = parse(from)
  const end = parse(to)
  if (end < start) throw new Error('from must not be after to')
  const months: string[] = []
  for (let index = start; index <= end; index++) {
    months.push(`${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`)
  }
  return months
}
