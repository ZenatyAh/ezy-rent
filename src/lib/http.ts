// Shared plumbing for route handlers. Errors are always { "error": "message" }.
import { ZodError } from 'zod'

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} not found`)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: string): boolean => UUID.test(value)

export function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON')
  }
}

function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error.status, error.message)
  if (error instanceof ZodError) {
    const issue = error.issues[0]
    const field = issue.path.join('.')
    return errorResponse(400, field ? `${field}: ${issue.message}` : issue.message)
  }
  // Log only the kind of error: messages and payloads may contain request data.
  console.error('Unhandled error:', error instanceof Error ? error.name : typeof error)
  return errorResponse(500, 'Internal server error')
}

// Wraps a handler so thrown HttpError / ZodError become the right { error } response.
export function route<Context>(handler: (request: Request, context: Context) => Promise<Response>) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      return await handler(request, context)
    } catch (error) {
      return toResponse(error)
    }
  }
}
