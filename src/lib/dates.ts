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
