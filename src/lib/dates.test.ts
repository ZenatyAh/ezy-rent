import { describe, expect, it } from 'vitest'
import { dateFromIso, dateToIso, toMalaysiaIso } from './dates'

describe('dates', () => {
  it('round-trips a calendar day through a Prisma DATE value without shifting it', () => {
    for (const day of ['2026-01-31', '2026-03-01', '2028-02-29', '2026-12-31', '0001-01-01', '9999-12-31']) {
      expect(dateToIso(dateFromIso(day))).toBe(day)
    }
  })

  it('represents a calendar day as 00:00 UTC', () => {
    expect(dateFromIso('2026-03-01').toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('writes an instant in Malaysia time with its offset', () => {
    expect(toMalaysiaIso(new Date('2026-02-28T16:30:00.000Z'))).toBe('2026-03-01T00:30:00.000+08:00')
    expect(toMalaysiaIso(new Date('2026-01-31T02:00:00.000Z'))).toBe('2026-01-31T10:00:00.000+08:00')
    expect(toMalaysiaIso(new Date('2026-12-31T16:00:00.000Z'))).toBe('2027-01-01T00:00:00.000+08:00')
  })

  it('describes the same instant it was given', () => {
    const instant = new Date('2026-06-15T09:21:07.123Z')
    expect(new Date(toMalaysiaIso(instant)).getTime()).toBe(instant.getTime())
  })
})
