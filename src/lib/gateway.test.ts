import { describe, expect, it } from 'vitest'
import { computeSignature, parseGatewayTime, signatureSource, verifySignature } from './gateway'
import { formatRinggit } from './format'

// The test vector from section 5 of the brief.
const KEY = 'test_x_signature_key'
const VECTOR = {
  id: 'bill_8f3a2c',
  paid: 'true',
  paid_amount: '210050',
  paid_at: '2026-04-01 00:30:12 +0800',
  transaction_id: 'TX-000123',
  transaction_status: 'completed',
}
const VECTOR_SOURCE =
  'idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted'
const VECTOR_SIGNATURE = '06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641'

describe('signature, the brief\'s test vector', () => {
  it('builds the exact source string', () => {
    expect(signatureSource(VECTOR)).toBe(VECTOR_SOURCE)
  })

  it('computes the exact signature', () => {
    expect(computeSignature(VECTOR, KEY)).toBe(VECTOR_SIGNATURE)
  })

  it('verifies it, and ignores x_signature when building the source', () => {
    const withSignature = { ...VECTOR, x_signature: VECTOR_SIGNATURE }
    expect(signatureSource(withSignature)).toBe(VECTOR_SOURCE)
    expect(verifySignature(withSignature, KEY)).toBe(true)
  })

  it('does not depend on the order the fields arrive in', () => {
    const shuffled = Object.fromEntries(Object.entries({ ...VECTOR, x_signature: VECTOR_SIGNATURE }).reverse())
    expect(verifySignature(shuffled, KEY)).toBe(true)
  })
})

describe('signature: fields the gateway may add later are covered too', () => {
  it('includes an unknown extra field in the source, sorted by key', () => {
    const fields = { ...VECTOR, zz_new_field: 'x', aa_new_field: 'y' }
    expect(signatureSource(fields)).toBe(
      'aa_new_fieldy|idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted|zz_new_fieldx',
    )
  })

  it('rejects the original signature once an extra field is added, and accepts a signature over all fields', () => {
    const extended = { ...VECTOR, extra: '1' }
    expect(verifySignature({ ...extended, x_signature: VECTOR_SIGNATURE }, KEY)).toBe(false)
    expect(verifySignature({ ...extended, x_signature: computeSignature(extended, KEY) }, KEY)).toBe(true)
  })

  it('sorts by character code: upper case before lower case, a prefix before its extension', () => {
    expect(signatureSource({ b: '2', B: '1', a: '0', ab: '3', paid: 'true', paid_amount: '1' })).toBe(
      'B1|a0|ab3|b2|paidtrue|paid_amount1',
    )
  })
})

describe('signature: anything else is wrong', () => {
  const good = { ...VECTOR, x_signature: VECTOR_SIGNATURE }

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', VECTOR_SIGNATURE.slice(0, 63)],
    ['too long', VECTOR_SIGNATURE + '0'],
    ['upper case', VECTOR_SIGNATURE.toUpperCase()],
    ['not hex', 'z'.repeat(64)],
    ['one character different', VECTOR_SIGNATURE.slice(0, 63) + (VECTOR_SIGNATURE.endsWith('1') ? '0' : '1')],
  ])('rejects a signature that is %s', (_label, signature) => {
    const fields: Record<string, string> = { ...VECTOR }
    if (signature !== undefined) fields.x_signature = signature
    expect(verifySignature(fields, KEY)).toBe(false)
  })

  it('rejects a changed field value, a removed field and a different key', () => {
    expect(verifySignature({ ...good, paid_amount: '210051' }, KEY)).toBe(false)
    expect(verifySignature({ ...good, paid: 'false' }, KEY)).toBe(false)
    const withoutField: Record<string, string> = { ...good }
    delete withoutField.transaction_id
    expect(verifySignature(withoutField, KEY)).toBe(false)
    expect(verifySignature(good, 'another_key')).toBe(false)
  })
})

describe('parseGatewayTime', () => {
  it.each([
    ['2026-04-01 00:30:12 +0800', '2026-03-31T16:30:12.000Z'],
    ['2026-04-01 00:30:12 +0000', '2026-04-01T00:30:12.000Z'],
    ['2026-03-01 00:30:00 +0800', '2026-02-28T16:30:00.000Z'], // seed: 00:30 on the 1st is still February in UTC
    ['2026-04-01 00:30:12 -0500', '2026-04-01T05:30:12.000Z'],
    ['2026-04-01 05:30:00 +0530', '2026-04-01T00:00:00.000Z'],
    ['2028-02-29 23:59:59 +0800', '2028-02-29T15:59:59.000Z'],
  ])('reads %s as %s', (input, iso) => {
    expect(parseGatewayTime(input).toISOString()).toBe(iso)
  })

  it.each([
    '2026-04-01T00:30:12+08:00', // ISO 8601 is not what the gateway sends
    '2026-04-01 00:30:12 +08:00', // offset with a colon
    '2026-04-01 00:30:12', // no offset
    '2026-04-01 00:30 +0800',
    '2026-04-01  00:30:12 +0800',
    '2026-02-30 00:30:12 +0800',
    '2026-04-01 24:00:00 +0800',
    '2026-04-01 00:60:00 +0800',
    '2026-04-01 00:30:12 +2500',
    '',
    'now',
  ])('rejects %j', (input) => {
    expect(() => parseGatewayTime(input)).toThrow()
  })
})

describe('formatRinggit', () => {
  it.each([
    [150000, 'RM 1,500.00'],
    [77419, 'RM 774.19'],
    [5, 'RM 0.05'],
    [0, 'RM 0.00'],
    [100, 'RM 1.00'],
    [100029, 'RM 1,000.29'],
    [123456789, 'RM 1,234,567.89'],
    [-250, '-RM 2.50'],
  ])('formats %i sen as %s', (sen, text) => {
    expect(formatRinggit(sen)).toBe(text)
  })

  it('refuses a fractional amount', () => {
    expect(() => formatRinggit(1.5)).toThrow()
  })
})
