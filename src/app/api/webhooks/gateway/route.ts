import { verifySignature } from '@/lib/gateway'
import { HttpError, route } from '@/lib/http'
import { settleCallback } from '@/lib/services/gateway'

// The payment gateway's callback (application/x-www-form-urlencoded). The only code path that settles a
// bill. Nothing from the body is logged: it holds payment data, and the secret key is never printed.
export const POST = route(async (request) => {
  const key = process.env.GATEWAY_X_SIGNATURE_KEY
  if (!key) {
    console.error('GATEWAY_X_SIGNATURE_KEY is not set')
    throw new HttpError(500, 'The webhook is not configured')
  }

  const params = new URLSearchParams(await request.text())
  const names = [...params.keys()]
  // A repeated field name would make "the value of that field" ambiguous, so it cannot carry a valid signature.
  if (new Set(names).size !== names.length) throw new HttpError(401, 'Invalid signature')
  const fields = Object.fromEntries(params)

  if (!verifySignature(fields, key)) throw new HttpError(401, 'Invalid signature')

  await settleCallback(fields)
  return Response.json({ ok: true })
})
