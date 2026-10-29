// Billing rules from section 3 of the brief. Pure: no I/O, no framework imports.
// Dates are 'YYYY-MM-DD' strings. All date math uses UTC day numbers (days since 1970-01-01)
// and UTC-only Date methods, so nothing here depends on the timezone of the machine.

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string // 'YYYY-MM-DD'
  amountSen: number // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

const MS_PER_DAY = 86_400_000
const MALAYSIA_OFFSET_MS = 8 * 3_600_000 // UTC+8, no daylight saving

interface CalendarDate {
  year: number
  month: number // 1-12
  day: number
  dayNumber: number
}

// Days since 1970-01-01 for a calendar date. setUTCFullYear is used instead of Date.UTC because
// Date.UTC maps the years 0-99 to 1900-1999.
function toDayNumber(year: number, month: number, day: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime() / MS_PER_DAY
}

function formatDay(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10)
}

function parseDate(value: unknown, field: string): CalendarDate {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) throw new Error(`${field} must be a date written as YYYY-MM-DD`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const dayNumber = toDayNumber(year, month, day)
  // A real calendar date survives the round trip; 2026-02-30 would come back as 2026-03-02.
  if (formatDay(dayNumber) !== value) throw new Error(`${field} is not a real calendar date: ${value}`)
  return { year, month, day, dayNumber }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

// Anchor k is the start date plus k calendar months, clamped to the last day of that month.
// It is always counted from the start date, never from the previous anchor.
function anchorDayNumber(start: CalendarDate, k: number): number {
  const monthIndex = start.year * 12 + (start.month - 1) + k
  const year = Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1
  return toDayNumber(year, month, Math.min(start.day, daysInMonth(year, month)))
}

// rentSen x usedDays / fullDays rounded half up to the nearest sen. BigInt keeps the product exact.
// floor((2 x rent x used + full) / (2 x full)) is round-half-up of rent x used / full.
function prorate(rentSen: number, usedDays: number, fullDays: number): number {
  const rent = BigInt(rentSen)
  const used = BigInt(usedDays)
  const full = BigInt(fullDays)
  return Number((2n * rent * used + full) / (2n * full))
}

export function generateSchedule(lease: {
  startDate: string // 'YYYY-MM-DD'
  endDate: string // 'YYYY-MM-DD', inclusive (the tenant's last day)
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, 'startDate')
  const end = parseDate(lease.endDate, 'endDate')
  if (end.dayNumber < start.dayNumber) throw new Error('endDate must not be before startDate')
  if (!Number.isSafeInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer')
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error('depositSen must be a non-negative integer')
  }

  const schedule: ScheduledInvoice[] = []

  if (lease.depositSen > 0) {
    schedule.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: lease.startDate,
      amountSen: lease.depositSen,
    })
  }

  // One rent period per anchor on or before endDate. Anchors keep increasing, so this ends.
  for (let k = 0; ; k++) {
    const periodStart = anchorDayNumber(start, k)
    if (periodStart > end.dayNumber) break

    const nextAnchor = anchorDayNumber(start, k + 1)
    const fullPeriodEnd = nextAnchor - 1
    const isCutShort = fullPeriodEnd > end.dayNumber
    const periodEnd = isCutShort ? end.dayNumber : fullPeriodEnd

    schedule.push({
      kind: 'rent',
      periodIndex: k,
      periodStart: formatDay(periodStart),
      periodEnd: formatDay(periodEnd),
      dueDate: formatDay(periodStart),
      amountSen: isCutShort
        ? prorate(lease.monthlyRentSen, periodEnd - periodStart + 1, nextAnchor - periodStart)
        : lease.monthlyRentSen,
    })
  }

  return schedule
}

// The calendar date in Asia/Kuala_Lumpur at the instant `now`. This is the one place the app
// derives "today" from an instant.
export function malaysiaDate(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date')
  return new Date(now.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 10)
}

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  parseDate(invoice.dueDate, 'dueDate')
  if (invoice.paidSen >= invoice.amountSen) return 'paid'
  // 'YYYY-MM-DD' strings compare correctly as text.
  if (malaysiaDate(now) > invoice.dueDate) return 'overdue'
  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// Digits with optional comma thousands separators (groups of exactly three), then an optional
// decimal part of one or two digits.
const RINGGIT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') throw new Error('Amount must be text')
  const match = RINGGIT_PATTERN.exec(input.trim())
  if (!match) throw new Error(`Not a valid ringgit amount: "${input}"`)
  const ringgit = BigInt(match[1].replace(/,/g, ''))
  // "1.5" means 50 sen, so the decimal part is padded on the right, not the left.
  const sen = BigInt((match[2] ?? '').padEnd(2, '0'))
  const total = ringgit * 100n + sen
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return Number(total)
}
