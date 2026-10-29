// The one place dates and times are turned into text for the screen. Everything is shown in Malaysia
// time (UTC+8, no daylight saving) whatever the timezone of the server or the viewer's device. It is plain
// arithmetic on UTC values, with no Intl and no locale, so the server and the browser produce the very
// same string and React reports no hydration mismatch.

const MALAYSIA_OFFSET_MS = 8 * 3_600_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// '2026-03-01' -> '01 Mar 2026'
export function formatMytDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  return `${match[3]} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`
}

// Any ISO 8601 instant -> '01 Mar 2026, 00:30' in Malaysia time.
export function formatMyt(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) return String(instant)
  const shifted = new Date(date.getTime() + MALAYSIA_OFFSET_MS).toISOString() // YYYY-MM-DDTHH:mm:ss.sssZ, in Malaysia time
  return `${formatMytDate(shifted.slice(0, 10))}, ${shifted.slice(11, 16)}`
}

// '2026-03' -> 'Mar 2026'
export function formatMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  return match ? `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}` : month
}

// The value for <input type="datetime-local"> showing `now` in Malaysia time: 'YYYY-MM-DDTHH:mm'.
export function toMytInput(now: Date): string {
  return new Date(now.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 16)
}

// What a user typed into a datetime-local input is Malaysia time, whatever their device's timezone, so the
// browser's own parsing is never used: the offset is appended and the server reads an exact instant.
export function mytInputToIso(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : value
}

// The 'YYYY-MM' of the month `count - 1` months before `month` (count = 6 -> five months back).
export function monthsBack(month: string, count: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return month
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 - (count - 1)
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}
