import { describe, expect, it } from 'vitest'
import { formatMonth, formatMyt, formatMytDate, monthsBack, mytInputToIso, toMytInput } from './time'

describe('time formatting (Malaysia time, independent of the machine timezone)', () => {
  it.each([
    ['2026-02-28T16:30:00.000Z', '01 Mar 2026, 00:30'], // the seeded transfer: still February in UTC
    ['2026-01-31T02:00:00Z', '31 Jan 2026, 10:00'],
    ['2026-03-01T00:30:00+08:00', '01 Mar 2026, 00:30'],
    ['2026-12-31T16:00:00Z', '01 Jan 2027, 00:00'],
    ['2026-03-31T15:59:59Z', '31 Mar 2026, 23:59'],
  ])('shows %s as %s', (iso, text) => {
    expect(formatMyt(iso)).toBe(text)
    expect(formatMyt(new Date(iso))).toBe(text)
  })

  it('formats calendar days, months and returns unparseable input unchanged', () => {
    expect(formatMytDate('2026-07-05')).toBe('05 Jul 2026')
    expect(formatMonth('2026-11')).toBe('Nov 2026')
    expect(formatMyt('nonsense')).toBe('nonsense')
    expect(formatMytDate('x')).toBe('x')
  })

  it('turns a datetime-local value into an exact instant in Malaysia time', () => {
    expect(mytInputToIso('2026-03-01T00:30')).toBe('2026-03-01T00:30:00+08:00')
    expect(new Date(mytInputToIso('2026-03-01T00:30')).toISOString()).toBe('2026-02-28T16:30:00.000Z')
    expect(mytInputToIso('2026-03-01T00:30:45')).toBe('2026-03-01T00:30:45+08:00') // a browser that includes seconds
    expect(mytInputToIso('')).toBe('') // left alone, so the server answers with a clear error
  })

  it('shows now in Malaysia time for a datetime-local input', () => {
    expect(toMytInput(new Date('2026-02-28T16:30:45Z'))).toBe('2026-03-01T00:30')
  })

  it('goes back N-1 months for the last-N-months range', () => {
    expect(monthsBack('2026-10', 6)).toBe('2026-05')
    expect(monthsBack('2026-03', 6)).toBe('2025-10')
    expect(monthsBack('2026-01', 1)).toBe('2026-01')
  })
})
