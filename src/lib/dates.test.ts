import { describe, expect, it } from 'vitest'
import { dateFromIso, dateToIso, monthRange, parseOffsetInstant, toMalaysiaIso } from './dates'

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

describe('parseOffsetInstant', () => {
  it.each([
    ['2026-03-01T00:30:00+08:00', '2026-02-28T16:30:00.000Z'],
    ['2026-01-31T10:00:00+08:00', '2026-01-31T02:00:00.000Z'],
    ['2026-01-31T02:00:00Z', '2026-01-31T02:00:00.000Z'],
    ['2026-01-31T02:00:00.123Z', '2026-01-31T02:00:00.123Z'],
    ['2026-01-31T02:00Z', '2026-01-31T02:00:00.000Z'],
    ['2026-01-30T22:00:00-04:00', '2026-01-31T02:00:00.000Z'],
    ['2028-02-29T12:00:00+08:00', '2028-02-29T04:00:00.000Z'],
  ])('reads %s as %s', (input, iso) => {
    expect(parseOffsetInstant(input).toISOString()).toBe(iso)
  })

  it.each([
    '2026-03-01T00:30:00', // no offset: would depend on the server timezone
    '2026-03-01 00:30:00+08:00', // space instead of T
    '2026-03-01',
    '2026-02-30T00:00:00Z', // new Date() would roll this to Mar 2
    '2026-02-29T00:00:00Z', // not a leap year
    '2026-13-01T00:00:00Z',
    '2026-03-01T24:00:00Z', // new Date() accepts 24:00
    '2026-03-01T23:60:00Z',
    '2026-03-01T23:59:60Z',
    '2026-03-01T00:30:00+25:00',
    '2026-03-01T00:30:00+08', // incomplete offset
    'yesterday',
    '',
  ])('rejects %j', (input) => {
    expect(() => parseOffsetInstant(input)).toThrow()
  })
})

describe('monthRange', () => {
  it('lists every month inclusive, across a year boundary', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03'])
  })

  it('rejects bad months and a reversed range', () => {
    for (const [from, to] of [['2026-13', '2026-14'], ['2026-1', '2026-02'], ['2026-03', '2026-02'], ['', ''], ['2026-00', '2026-01']]) {
      expect(() => monthRange(from, to)).toThrow()
    }
  })
})
