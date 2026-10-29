// Money is bigint sen in the database and in server code. API bodies and billing.ts use integer
// numbers, so values cross that boundary here and nowhere else.

export function senToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount is outside the safe integer range')
  }
  return Number(value)
}
