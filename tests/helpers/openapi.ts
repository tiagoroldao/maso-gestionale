import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import { OpenapiSdiGateway } from '#services/openapi_sdi_gateway'

type Fixture = {
  status: number
  body?: unknown
  text?: string
  /** A binary answer, such as a signed file */
  bytes?: Buffer
  contentType?: string
}
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
 * How `GET /api_configurations` may list callbacks, per the spec: a
 * singular `callback` per item, `callbacks` as an array (the schema), or
 * `callbacks` as one object per item (the schema's example)
 */
export type ReadShape = 'callback' | 'callbacksArray' | 'callbacksObject'

/** A callback configuration, as `POST /api_configurations` writes it */
type Configuration = { fiscal_id: string; callbacks: Record<string, unknown>[] }

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
   * per fiscal id, each POST replacing that fiscal id's. The POSTs are in
   * `requests`. By default the read ignores the `fiscal_id` filter and
   * carries `fiscal_id` on each item; `honoursFilter` lists only the
   * fiscal id asked, and `withFiscalId: false` leaves it out, as the spec's
   * ApiConfiguration-read does. With `registered`, a fiscal id it refuses
   * answers 404 with error 420, as the sandbox does for one without a
   * Business Registry Configuration (ADR 0019).
   */
  keepsApiConfigurations(
    initial: Configuration | null = null,
    shape: ReadShape = 'callback',
    options: {
      honoursFilter?: boolean
      withFiscalId?: boolean
      registered?: (fiscalId: string) => boolean
    } = {}
  ) {
    const { honoursFilter = false, withFiscalId = true, registered } = options
    const stored = new Map<string, Configuration>()
    if (initial) stored.set(initial.fiscal_id, initial)
    // Read back in one of the shapes the spec shows, with Openapi's own
    // read-only fields (ids, provider_uuid)
    this.on('GET', '/api_configurations', (request) => {
      const filter = request.query.get('fiscal_id')
      if (filter && registered && !registered(filter)) return recorded('fiscalIdNotRegistered')
      const none = recorded('apiConfigurationsNone')
      const listed = [...stored.values()].filter(
        (configuration) => !(honoursFilter && filter && filter !== configuration.fiscal_id)
      )
      if (listed.length) {
        none.body.data = listed.flatMap((configuration) => {
          const read = configuration.callbacks.map((callback, index) => ({
            ...callback,
            id: `00000000000000000000010${index}`,
            provider_uuid: `00000000-0000-4000-8000-00000000010${index}`,
          }))
          const item = (index: number) => ({
            id: `00000000000000000000000${index}`,
            ...(withFiscalId ? { fiscal_id: configuration.fiscal_id } : {}),
          })
          return shape === 'callbacksArray'
            ? [{ ...item(0), callbacks: read }]
            : read.map((callback, index) => ({
                ...item(index),
                [shape === 'callback' ? 'callback' : 'callbacks']: callback,
              }))
        })
      }
      return none
    })
    this.on('POST', '/api_configurations', (request) => {
      const configuration: Configuration = JSON.parse(request.body!)
      stored.set(configuration.fiscal_id, configuration)
      const configured = recorded('apiConfigured')
      configured.body.data[0].callbacks = configuration.callbacks
      return configured
    })
    return this
  }

  /**
   * Answers the fiscal id's Business Registry Configuration, with
   * `apply_legal_storage` as given (read each time, so a test can change
   * it), in the shape the sandbox answered (ADR 0019)
   */
  registers(fiscalId: string, applyLegalStorage: boolean | (() => boolean)) {
    return this.on('GET', `/business_registry_configurations/${fiscalId}`, () => ({
      status: 200,
      body: {
        data: {
          fiscal_id: fiscalId,
          apply_legal_storage:
            typeof applyLegalStorage === 'function' ? applyLegalStorage() : applyLegalStorage,
        },
        success: true,
      },
    }))
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
    if (fixture.bytes !== undefined) {
      return new Response(new Uint8Array(fixture.bytes), {
        status: fixture.status,
        headers: { 'content-type': fixture.contentType ?? 'application/octet-stream' },
      })
    }
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
