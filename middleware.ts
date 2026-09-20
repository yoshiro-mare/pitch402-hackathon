import { NextResponse, type NextRequest } from 'next/server'

/**
 * CORS for the agent-facing surface.
 *
 * "Open agentic access" is only true if an agent can actually reach us from
 * wherever it runs. A server-side agent never hits CORS, but one running in a
 * page — a browser extension, a wallet dapp, a hosted agent UI — is blocked by
 * the browser before our handler is ever called.
 *
 * Everything here is public and unauthenticated, and payment is carried in a
 * signed header rather than a cookie, so a wildcard origin gives nothing away.
 * Credentials are deliberately NOT allowed, which is also what lets `*` be
 * legal here.
 */
const ALLOW_HEADERS = ['content-type', 'x-payment', 'payment-signature', 'accept']

/**
 * A browser can only read a response header we name here. The x402 challenge
 * and the settlement result both travel in headers, so an agent that could not
 * read them would see a bare 402 with no way to pay it.
 */
const EXPOSE_HEADERS = ['payment-required', 'payment-response', 'x-payment-response', 'location']

function cors(res: NextResponse): NextResponse {
  res.headers.set('access-control-allow-origin', '*')
  res.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.headers.set('access-control-allow-headers', ALLOW_HEADERS.join(', '))
  res.headers.set('access-control-expose-headers', EXPOSE_HEADERS.join(', '))
  res.headers.set('access-control-max-age', '86400')
  return res
}

export function middleware(req: NextRequest) {
  // Preflight never reaches a route handler, so answer it here.
  if (req.method === 'OPTIONS') {
    return cors(new NextResponse(null, { status: 204 }))
  }
  return cors(NextResponse.next())
}

export const config = {
  matcher: ['/api/:path*', '/.well-known/:path*', '/llms.txt'],
}
