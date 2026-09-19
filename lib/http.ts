import { type NextRequest } from 'next/server'

/** Absolute base URL for this deployment, so quotes can hand agents a real URL. */
export function baseUrl(req: NextRequest): string {
  const configured = process.env.PITCH402_BASE_URL
  if (configured) return configured.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  })
}

export function error(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, ...extra } }, { status })
}
