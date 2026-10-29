import { describe, expect, it } from 'vitest'
import {
  generateSchedule,
  invoiceStatus,
  malaysiaDate,
  parseRinggitToSen,
  type ScheduledInvoice,
} from './billing'

const rent = (
  periodIndex: number,
  periodStart: string,
  periodEnd: string,
  amountSen: number,
): ScheduledInvoice => ({
  kind: 'rent',
  periodIndex,
  periodStart,
  periodEnd,
  dueDate: periodStart,
  amountSen,
})

const lease = (
  startDate: string,
  endDate: string,
  monthlyRentSen = 100_000,
  depositSen = 0,
) => ({ startDate, endDate, monthlyRentSen, depositSen })

describe('generateSchedule: seeded leases', () => {
  it("Aisyah's lease matches the worked example in the brief", () => {
    const schedule = generateSchedule(lease('2026-01-31', '2026-07-15', 150_000, 300_000))
    expect(schedule).toEqual([
      {
        kind: 'deposit',
        periodIndex: null,
        periodStart: null,
        periodEnd: null,
        dueDate: '2026-01-31',
        amountSen: 300_000,
      },
      rent(0, '2026-01-31', '2026-02-27', 150_000),
      rent(1, '2026-02-28', '2026-03-30', 150_000),
      rent(2, '2026-03-31', '2026-04-29', 150_000),
      rent(3, '2026-04-30', '2026-05-30', 150_000),
      rent(4, '2026-05-31', '2026-06-29', 150_000),
      rent(5, '2026-06-30', '2026-07-15', 77_419), // 150000 x 16 / 31 = 77419.35
    ])
    expect(schedule.reduce((sum, i) => sum + i.amountSen, 0)).toBe(1_127_419)
  })

  it("Ben's lease: no deposit, and the last period rounds 50014.5 up to 50015", () => {
    const schedule = generateSchedule(lease('2026-01-01', '2026-04-15', 100_029, 0))
    expect(schedule).toEqual([
      rent(0, '2026-01-01', '2026-01-31', 100_029),
      rent(1, '2026-02-01', '2026-02-28', 100_029),
      rent(2, '2026-03-01', '2026-03-31', 100_029),
      rent(3, '2026-04-01', '2026-04-15', 50_015), // 100029 x 15 / 30 = 50014.5
    ])
  })

  it("Probe's lease: the last period ends exactly on endDate, so it is not prorated", () => {
    const schedule = generateSchedule(lease('2026-02-28', '2027-02-27', 200_000, 400_000))
    expect(schedule).toHaveLength(13)
    expect(schedule[0]).toMatchObject({ kind: 'deposit', dueDate: '2026-02-28', amountSen: 400_000 })
    const periods = schedule.slice(1)
    expect(periods.map((i) => i.periodIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(periods.every((i) => i.amountSen === 200_000)).toBe(true)
    expect(periods[11]).toEqual(rent(11, '2027-01-28', '2027-02-27', 200_000))
  })

  it("Chen's lease: twelve full periods, last one 2027-02-15 to 2027-03-14", () => {
    const schedule = generateSchedule(lease('2026-03-15', '2027-03-14', 220_000, 440_000))
    expect(schedule).toHaveLength(13)
    expect(schedule.slice(1).every((i) => i.amountSen === 220_000)).toBe(true)
    expect(schedule[12]).toEqual(rent(11, '2027-02-15', '2027-03-14', 220_000))
  })
})

describe('generateSchedule: deposit', () => {
  it('puts the deposit first, due on the start date, with null period fields', () => {
    const [first, second] = generateSchedule(lease('2026-05-10', '2026-07-09', 100_000, 250_000))
    expect(first).toEqual({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: '2026-05-10',
      amountSen: 250_000,
    })
    expect(second).toMatchObject({ kind: 'rent', periodIndex: 0 })
  })

  it('creates no deposit invoice when depositSen is 0', () => {
    const schedule = generateSchedule(lease('2026-05-10', '2026-07-09', 100_000, 0))
    expect(schedule.some((i) => i.kind === 'deposit')).toBe(false)
    expect(schedule[0]).toMatchObject({ kind: 'rent', periodIndex: 0 })
  })
})

describe('generateSchedule: anchors', () => {
  const starts = (l: ReturnType<typeof lease>) =>
    generateSchedule(l).map((i) => i.periodStart)
  const ends = (l: ReturnType<typeof lease>) => generateSchedule(l).map((i) => i.periodEnd)

  it('clamps a Jan 31 start to the last day of shorter months, counting from the start date', () => {
    expect(starts(lease('2026-01-31', '2026-06-30'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31', // not 03-28: anchors are never counted from the previous anchor
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ])
  })

  it('uses Feb 29 as the anchor in a leap year', () => {
    const l = lease('2028-01-31', '2028-04-30', 3_100)
    expect(starts(l)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
    expect(ends(l)).toEqual(['2028-02-28', '2028-03-30', '2028-04-29', '2028-04-30'])
  })

  it('clamps a day-30 start in February and returns to day 30 in March', () => {
    expect(starts(lease('2026-01-30', '2026-03-31'))).toEqual([
      '2026-01-30',
      '2026-02-28',
      '2026-03-30',
    ])
  })

  it('clamps a day-29 start in a non-leap February', () => {
    const l = lease('2025-12-29', '2026-03-28')
    expect(starts(l)).toEqual(['2025-12-29', '2026-01-29', '2026-02-28'])
    expect(ends(l)).toEqual(['2026-01-28', '2026-02-27', '2026-03-28'])
  })

  it('crosses a year boundary', () => {
    const l = lease('2026-11-15', '2027-02-14')
    expect(starts(l)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
    expect(ends(l)).toEqual(['2026-12-14', '2027-01-14', '2027-02-14'])
  })

  it('makes every rent invoice due on its period start and numbers periods from 0', () => {
    const rentInvoices = generateSchedule(lease('2026-03-05', '2026-09-04', 90_000, 90_000)).filter(
      (i) => i.kind === 'rent',
    )
    expect(rentInvoices.map((i) => i.periodIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rentInvoices.every((i) => i.dueDate === i.periodStart)).toBe(true)
  })
})

describe('generateSchedule: last period', () => {
  it('charges a full period when endDate is exactly the last day of that period', () => {
    expect(generateSchedule(lease('2026-01-01', '2026-01-31'))).toEqual([
      rent(0, '2026-01-01', '2026-01-31', 100_000),
    ])
  })

  it('prorates when endDate is one day before the end of the period', () => {
    // 100000 x 30 / 31 = 96774.19
    expect(generateSchedule(lease('2026-01-01', '2026-01-30'))).toEqual([
      rent(0, '2026-01-01', '2026-01-30', 96_774),
    ])
  })

  it('starts a new, prorated period when endDate is the anchor of the next one', () => {
    // second period is Feb 1..Feb 28 (28 days): 100000 x 1 / 28 = 3571.43
    expect(generateSchedule(lease('2026-01-01', '2026-02-01'))).toEqual([
      rent(0, '2026-01-01', '2026-01-31', 100_000),
      rent(1, '2026-02-01', '2026-02-01', 3_571),
    ])
  })

  it('handles a one-day lease', () => {
    // Mar 10..Apr 9 is 31 days: 3100 x 1 / 31 = 100
    expect(generateSchedule(lease('2026-03-10', '2026-03-10', 3_100))).toEqual([
      rent(0, '2026-03-10', '2026-03-10', 100),
    ])
  })

  it('rounds exact halves up (not to even)', () => {
    // Feb 1..Feb 14 is 14 of 28 days
    expect(generateSchedule(lease('2026-02-01', '2026-02-14', 1))[0].amountSen).toBe(1) // 0.5
    expect(generateSchedule(lease('2026-02-01', '2026-02-14', 3))[0].amountSen).toBe(2) // 1.5
    expect(generateSchedule(lease('2026-02-01', '2026-02-14', 5))[0].amountSen).toBe(3) // 2.5
  })

  it('follows the formula even when it rounds down to 0 sen', () => {
    // 1 x 1 / 31 = 0.03
    expect(generateSchedule(lease('2026-01-01', '2026-01-01', 1))[0].amountSen).toBe(0)
  })

  it('only ever produces integer sen amounts', () => {
    const schedule = generateSchedule(lease('2026-01-31', '2027-07-15', 123_457, 999_999))
    expect(schedule.every((i) => Number.isSafeInteger(i.amountSen))).toBe(true)
  })

  it('does not overflow or lose precision on very large rents', () => {
    // Jul 31..Aug 15 is 16 of 31 days. 9e15 x 16 exceeds 2^53 as a float product; BigInt keeps it exact.
    const big = 9_000_000_000_000_000
    const schedule = generateSchedule(lease('2026-07-31', '2026-08-15', big))
    expect(schedule[0].amountSen).toBe(4_645_161_290_322_581) // 4645161290322580.645 rounds up
  })
})

describe('generateSchedule: validation', () => {
  const ok = lease('2026-01-01', '2026-03-31')

  it.each([
    '2026-02-30',
    '2026-02-29', // 2026 is not a leap year
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-01-00',
    '2026-1-01',
    '2026-01-1',
    '26-01-01',
    '2026/01/01',
    '20260101',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    '2026-01-01 ',
    '',
    'abc',
  ])('rejects the invalid start date %j', (bad) => {
    expect(() => generateSchedule({ ...ok, startDate: bad })).toThrow(Error)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-1-01', '', 'tomorrow'])(
    'rejects the invalid end date %j',
    (bad) => {
      expect(() => generateSchedule({ ...ok, endDate: bad })).toThrow(Error)
    },
  )

  it('accepts Feb 29 in a leap year', () => {
    expect(() => generateSchedule(lease('2024-02-29', '2024-03-28'))).not.toThrow()
  })

  it('rejects an end date before the start date, accepts the same day', () => {
    expect(() => generateSchedule(lease('2026-03-02', '2026-03-01'))).toThrow(Error)
    expect(() => generateSchedule(lease('2026-03-01', '2026-03-01'))).not.toThrow()
  })

  it.each([0, -1, -100_000, 1.5, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects monthlyRentSen %j',
    (bad) => {
      expect(() => generateSchedule({ ...ok, monthlyRentSen: bad })).toThrow(Error)
    },
  )

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects depositSen %j',
    (bad) => {
      expect(() => generateSchedule({ ...ok, depositSen: bad })).toThrow(Error)
    },
  )

  it('accepts a zero deposit and rejects non-number types', () => {
    expect(() => generateSchedule({ ...ok, depositSen: 0 })).not.toThrow()
    expect(() => generateSchedule({ ...ok, monthlyRentSen: '1000' as unknown as number })).toThrow(Error)
    expect(() => generateSchedule({ ...ok, depositSen: null as unknown as number })).toThrow(Error)
  })
})

describe('malaysiaDate', () => {
  it.each([
    ['2026-03-01T15:59:59.999Z', '2026-03-01'],
    ['2026-03-01T16:00:00.000Z', '2026-03-02'],
    ['2026-03-02T00:00:00+08:00', '2026-03-02'],
    ['2026-12-31T15:59:59.999Z', '2026-12-31'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01'],
    ['2028-02-28T16:00:00.000Z', '2028-02-29'],
    ['2026-01-31T02:00:00.000Z', '2026-01-31'], // 10:00 MYT
    ['2026-02-28T16:30:00.000Z', '2026-03-01'], // 00:30 MYT on the 1st
  ])('%s is %s in Malaysia', (iso, expected) => {
    expect(malaysiaDate(new Date(iso))).toBe(expected)
  })

  it('throws on an invalid Date', () => {
    expect(() => malaysiaDate(new Date('not a date'))).toThrow(Error)
  })
})

describe('invoiceStatus', () => {
  const inv = (paidSen: number, amountSen = 100_000, dueDate = '2026-03-01') => ({
    dueDate,
    amountSen,
    paidSen,
  })

  it('is paid when paidSen reaches amountSen, even long after the due date', () => {
    const now = new Date('2027-01-01T00:00:00Z')
    expect(invoiceStatus(inv(100_000), now)).toBe('paid')
    expect(invoiceStatus(inv(100_001), now)).toBe('paid') // overpaid
    expect(invoiceStatus(inv(0, 0), now)).toBe('paid') // nothing to pay
  })

  it('becomes overdue at 2026-03-02 00:00 Malaysia time and not a moment earlier', () => {
    expect(invoiceStatus(inv(0), new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid')
    expect(invoiceStatus(inv(0), new Date('2026-03-01T16:00:00.000Z'))).toBe('overdue')
    expect(invoiceStatus(inv(0), new Date('2026-03-02T00:00:00+08:00'))).toBe('overdue')
  })

  it('is not overdue on the due date itself, at any time of that Malaysia day', () => {
    expect(invoiceStatus(inv(0), new Date('2026-02-28T16:00:00Z'))).toBe('unpaid') // 00:00 MYT
    expect(invoiceStatus(inv(0), new Date('2026-03-01T23:59:59+08:00'))).toBe('unpaid')
  })

  it('is overdue across a year boundary', () => {
    const due = inv(0, 100_000, '2026-12-31')
    expect(invoiceStatus(due, new Date('2026-12-31T15:59:59.999Z'))).toBe('unpaid')
    expect(invoiceStatus(due, new Date('2026-12-31T16:00:00.000Z'))).toBe('overdue')
  })

  it('is partially_paid when something was paid and the invoice is not yet overdue', () => {
    expect(invoiceStatus(inv(1), new Date('2026-03-01T12:00:00Z'))).toBe('partially_paid')
    expect(invoiceStatus(inv(99_999), new Date('2026-01-01T00:00:00Z'))).toBe('partially_paid')
  })

  it('reports overdue before partially_paid', () => {
    expect(invoiceStatus(inv(50_000), new Date('2026-03-02T00:00:00+08:00'))).toBe('overdue')
  })

  it('is unpaid before the due date with nothing paid', () => {
    expect(invoiceStatus(inv(0), new Date('2026-01-01T00:00:00Z'))).toBe('unpaid')
  })

  it('throws on an invalid now or a malformed due date', () => {
    expect(() => invoiceStatus(inv(0), new Date('nope'))).toThrow(Error)
    expect(() => invoiceStatus(inv(0, 100_000, '2026-3-1'), new Date())).toThrow(Error)
  })
})

describe('parseRinggitToSen', () => {
  it.each([
    ['1,500.50', 150_050],
    ['1.15', 115],
    ['7', 700],
    ['0', 0],
    ['0.00', 0],
    ['0.05', 5],
    ['0.5', 50],
    ['1.5', 150], // one decimal digit is tenths, not hundredths
    ['10.00', 1_000],
    ['1000', 100_000],
    ['1,000', 100_000],
    ['999', 99_900],
    ['1,234,567.89', 123_456_789],
    ['  7  ', 700],
    ['\t1,000.10\n', 100_010],
  ])('parses %j as %i sen', (input, sen) => {
    expect(parseRinggitToSen(input)).toBe(sen)
  })

  it.each([
    '',
    '   ',
    '-5',
    '+5',
    '1.234',
    '1e3',
    'RM 10',
    'RM10',
    '1,23',
    '1,2345',
    '12,34',
    '1234,567',
    ',500',
    '1,,500',
    '1,500,',
    '1.',
    '.5',
    '1.2.3',
    '1 500',
    '1,500 .00',
    'abc',
    '0x10',
    '1_000',
    'NaN',
    'Infinity',
    '١٢', // Arabic-Indic digits are not accepted
    '99999999999999999999', // more sen than a safe integer
  ])('rejects %j', (input) => {
    expect(() => parseRinggitToSen(input)).toThrow(Error)
  })

  it('rejects non-string input', () => {
    expect(() => parseRinggitToSen(5 as unknown as string)).toThrow(Error)
    expect(() => parseRinggitToSen(undefined as unknown as string)).toThrow(Error)
  })
})
