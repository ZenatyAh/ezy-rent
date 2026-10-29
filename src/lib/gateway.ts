// Webhook signature and timestamp rules from section 5 of the brief. No I/O.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseOffsetInstant } from '@/lib/dates'

// Every field except x_signature (including fields the gateway may add in future), sorted by key in
// ascending character-code order, each written as key immediately followed by value, joined with "|".
export function signatureSource(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'x_signature')
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join('|')
}

// HMAC-SHA256 of the source with the shared secret, as lowercase hex.
export function computeSignature(fields: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(signatureSource(fields)).digest('hex')
}

// Constant-time comparison. A missing signature, or one that is not 64 lowercase hex characters, is
// simply wrong, so timingSafeEqual only ever sees buffers of the same length.
export function verifySignature(fields: Record<string, string>, key: string): boolean {
  const given = fields.x_signature
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) return false
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(computeSignature(fields, key), 'hex'))
}

// The gateway writes paid_at as "2026-04-01 00:30:12 +0800": a space instead of T, and an offset
// without a colon. That is not ISO 8601, so it is matched explicitly and turned into the instant.
export function parseGatewayTime(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value)
  if (!match) throw new Error('paid_at must look like "2026-04-01 00:30:12 +0800"')
  const [, day, time, sign, offsetHour, offsetMinute] = match
  return parseOffsetInstant(`${day}T${time}${sign}${offsetHour}:${offsetMinute}`)
}
