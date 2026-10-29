import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'

type Fixture = { status: number; body?: unknown; text?: string; contentType?: string }
const fixtures: Record<string, Fixture> = JSON.parse(
  readFileSync(app.makePath('tests/fixtures/openapi/responses.json'), 'utf8')
)

export type RecordedRequest = {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: string | null
}

/** A recorded response by name, or a failure before any answer (a dropped connection) */
type Answer = string | Error
type Responder = Answer | ((request: RecordedRequest) => Answer | Promise<Answer>)

/**
 * Openapi's SDI API in memory, answering with the recorded responses in
 * tests/fixtures/openapi (never the network). Each route answers what it
 * was given; unknown routes answer 404.
 */
export class FakeOpenapi {
  readonly requests: RecordedRequest[] = []
  private readonly routes: { method: string; path: string; responder: Responder }[] = []

  on(method: string, path: string, responder: Responder) {
    this.routes.unshift({ method, path, responder })
    return this
  }

  /** The gateway, talking to this fake */
  gateway(environment: 'sandbox' | 'production' = 'sandbox') {
    return new OpenapiSdiGateway({ token: 'test-token', environment, fetch: this.fetch })
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ])
      ),
      body: typeof init?.body === 'string' ? init.body : null,
    }
    this.requests.push(request)
    const route = this.routes.find(
      (candidate) => candidate.method === request.method && candidate.path === request.path
    )
    const answer = !route
      ? 'notFound'
      : typeof route.responder === 'function'
        ? await route.responder(request)
        : route.responder
    if (answer instanceof Error) throw answer
    if (answer === 'notFound') {
      return Response.json({ success: false, message: 'Not Found', error: 231 }, { status: 404 })
    }
    const fixture = fixtures[answer]
    if (!fixture) throw new Error(`No recorded response ${answer}`)
    if (fixture.text !== undefined) {
      return new Response(fixture.text, {
        status: fixture.status,
        headers: { 'content-type': fixture.contentType ?? 'text/plain' },
      })
    }
    return Response.json(fixture.body, { status: fixture.status })
  }
}

/** A recorded response body by name */
export function recorded(name: string) {
  return fixtures[name]
}
