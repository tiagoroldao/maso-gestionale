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

/**
 * A recorded response by name, a response built from one, or a failure
 * before any answer (a dropped connection)
 */
type Answer = string | Fixture | Error
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

  /**
   * Answers `api_configurations` as Openapi keeps them: one configuration
   * per fiscal id, each POST replacing it. The POSTs are in `requests`.
   */
  keepsApiConfigurations(initial: { fiscal_id: string; callbacks: unknown[] } | null = null) {
    let stored = initial
    this.on('GET', '/api_configurations', () => {
      const none = recorded('apiConfigurationsNone')
      if (stored) none.body.data = [{ id: '000000000000000000000000', ...stored }]
      return none
    })
    this.on('POST', '/api_configurations', (request) => {
      stored = JSON.parse(request.body!)
      const configured = recorded('apiConfigured')
      configured.body.data[0].callbacks = stored!.callbacks
      return configured
    })
    return this
  }

  /** The POSTs that replaced the callback configuration */
  get configurations() {
    return this.requests
      .filter((request) => request.method === 'POST' && request.path === '/api_configurations')
      .map((request) => JSON.parse(request.body!))
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
    const fixture = typeof answer === 'string' ? fixtures[answer] : answer
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

/** A recorded response by name, as a copy to adapt */
export function recorded(name: string): Fixture & { body: any } {
  return structuredClone(fixtures[name]) as Fixture & { body: any }
}

/**
 * The recorded list of sent files, holding one Invoice with this number
 * (in its payload, where Openapi keeps it).
 */
export function sentListWith(number: string) {
  const list = recorded('sentList')
  for (const found of list.body.data) {
    const payload = JSON.parse(found.payload)
    payload.fattura_elettronica_body[0].dati_generali.dati_generali_documento.numero = number
    found.payload = JSON.stringify(payload)
  }
  return list
}
