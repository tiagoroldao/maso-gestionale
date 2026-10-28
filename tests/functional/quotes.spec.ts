import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import Job from '#models/job'
import Quote from '#models/quote'
import type User from '#models/user'
import LabourRate from '#models/labour_rate'
import CompanySettings from '#models/company_settings'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem, vatCode } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { createQuote } from '#tests/helpers/quotes'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'
import i18nManager from '@adonisjs/i18n/services/main'
import DocumentRenderer from '#documents/document_renderer'
import { quoteDocument } from '#documents/quote_document'
import type { PdfConverter } from '#documents/pdf_converter'

const noConverter: PdfConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}

// The standard 22% code, looked up by setup() for quoteLines()
let standardVat = 0

async function setup() {
  const standard = await vatCode()
  standardVat = standard.id
  const office = await createUser('office')
  const customer = await createCustomer()
  const job = await createJob(customer)
  const item = await createItem({ code: 'CALD-25', unit: 'pz', resalePrice: '1200' })
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '38.5' })
  return { office, customer, job, item, rate }
}

function quoteLines(itemId: number, rateId: number) {
  return [
    {
      kind: 'item',
      itemId,
      description: 'Caldaia a condensazione',
      quantity: '1',
      unitPrice: '1199,99',
      vatCodeId: standardVat,
    },
    {
      kind: 'labour',
      labourRateId: rateId,
      description: 'Installazione',
      quantity: '3,5',
      unitPrice: '38,50',
      vatCodeId: standardVat,
    },
    {
      kind: 'call_out',
      description: 'Diritto di chiamata',
      quantity: '1',
      unitPrice: '30',
      vatCodeId: standardVat,
    },
    { kind: 'text', description: 'Smaltimento della vecchia caldaia incluso' },
  ]
}

/**
 * Writes a new Quote on the Job through the app and returns it (the Job's
 * latest), or null when it was refused.
 */
async function write(client: ApiClient, user: User, job: Job, body: Record<string, unknown>) {
  const response = await client
    .post(`/jobs/${job.id}/quotes`)
    .json(body)
    .header('referer', `/jobs/${job.id}/quotes/create`)
    .withCsrfToken()
    .loginAs(user)
    .redirects(0)
  const quote = await Quote.query().where('jobId', job.id).orderBy('sequence', 'desc').first()
  return { response, quote }
}

/**
 * A new Quote on the Job that must be saved.
 */
async function newQuote(client: ApiClient, user: User, job: Job, body: Record<string, unknown>) {
  const { quote } = await write(client, user, job, body)
  return quote!
}

function decide(client: ApiClient, quote: Quote, user: User, decision: 'accept' | 'decline') {
  return client.post(`/quotes/${quote.id}/${decision}`).withCsrfToken().loginAs(user).redirects(0)
}

test.group('Quotes', () => {
  test('saving the lines prices them; the Job stays open', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    const { response, quote: created } = await write(client, office, job, {
      notes: 'Validità 30 giorni',
      lines: quoteLines(item.id, rate.id),
    })

    response.assertHeader('location', `/quotes/${created!.id}`)
    const quote = await Quote.query()
      .where('id', created!.id)
      .preload('lines', (l) => l.orderBy('position'))
      .firstOrFail()
    assert.deepEqual(
      quote.lines.map((line) => [
        line.kind,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.lineTotal,
      ]),
      [
        ['item', '1.000', 'pz', '1199.9900', '1199.99'],
        ['labour', '3.500', 'h', '38.5000', '134.75'],
        ['call_out', '1.000', null, '30.0000', '30.00'],
        ['text', null, null, null, null],
      ]
    )
    assert.equal(quote.taxable, '1364.74')
    // 22% on 1364.74 = 300.24
    assert.equal(quote.totals.total, '1664.98')
    assert.equal(quote.notes, 'Validità 30 giorni')
    assert.equal(quote.status, 'draft')
    assert.equal(quote.sequence, 1)
    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test('each priced line keeps its VAT treatment, summed per rate', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const reduced = await vatCode('10%')
    const reverse = await vatCode('Inversione contabile – impianti su edifici')

    const { quote: created } = await write(client, office, job, {
      lines: [
        {
          kind: 'item',
          itemId: item.id,
          description: 'Caldaia',
          quantity: '1',
          unitPrice: '1000',
          vatCodeId: reduced.id,
        },
        {
          kind: 'labour',
          labourRateId: rate.id,
          description: 'Posa',
          quantity: '2',
          unitPrice: '50',
          vatCodeId: reverse.id,
        },
        { kind: 'text', description: 'Nota' },
      ],
    })

    reduced.rate = '11'
    await reduced.save()
    const quote = await Quote.query()
      .where('id', created!.id)
      .preload('lines', (l) => l.orderBy('position'))
      .firstOrFail()
    assert.deepEqual(
      quote.lines.map((line) => [line.vatRate, line.natura, line.legalNote !== null]),
      [
        ['10.00', null, false],
        ['0.00', 'N6.7', true],
        [null, null, false],
      ]
    )
    assert.deepEqual(
      quote.totals.summary.map((row) => [row.vatRate, row.natura, row.taxable, row.vat]),
      [
        ['10.00', null, '1000.00', '100.00'],
        ['0.00', 'N6.7', '100.00', '0.00'],
      ]
    )
    assert.equal(quote.totals.total, '1200.00')
  })

  test('priced lines need a VAT Code; archived codes stay only where already used', async ({
    client,
    assert,
  }) => {
    const { office, job, item } = await setup()
    const reduced = await vatCode('10%')
    const line = (vatCodeId?: number) => ({
      kind: 'item',
      itemId: item.id,
      description: 'Caldaia',
      quantity: '1',
      unitPrice: '1000',
      ...(vatCodeId && { vatCodeId }),
    })
    const { quote } = await write(client, office, job, { lines: [line(reduced.id)] })
    const four = await vatCode('4%')
    for (const code of [reduced, four]) {
      code.archivedAt = DateTime.now()
      await code.save()
    }

    const refused = await client
      .put(`/quotes/${quote!.id}`)
      .json({ lines: [line(reduced.id), line(four.id), line()] })
      .header('referer', `/quotes/${quote!.id}`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    const errors = refused.flashMessage('inputErrorsBag') as Record<string, unknown>
    assert.deepEqual(Object.keys(errors).sort(), ['lines.1.vatCodeId', 'lines.2.vatCodeId'])

    // A new Quote can't take the archived code, even if another Quote has it
    const { response } = await write(client, office, job, { lines: [line(reduced.id)] })
    assert.properties(response.flashMessage('inputErrorsBag'), ['lines.0.vatCodeId'])
  })

  test('saving again replaces the lines', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const { quote: created } = await write(client, office, job, {
      lines: quoteLines(item.id, rate.id),
    })

    const response = await client
      .put(`/quotes/${created!.id}`)
      .json({ lines: [quoteLines(item.id, rate.id)[2]] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/quotes/${created!.id}`)
    const quote = await Quote.query().where('id', created!.id).preload('lines').firstOrFail()
    assert.lengthOf(quote.lines, 1)
    assert.equal(quote.taxable, '30.00')
    assert.lengthOf(await Quote.query().where('jobId', job.id), 1)
  })

  test('priced lines need a quantity and a price; text lines only words', async ({
    client,
    assert,
  }) => {
    const { office, job, item } = await setup()

    const { response, quote } = await write(client, office, job, {
      lines: [
        { kind: 'item', itemId: item.id, description: 'X' },
        { kind: 'labour', description: 'Y', quantity: '1', unitPrice: '10' },
        { kind: 'text', description: '' },
      ],
    })

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'lines.0.quantity',
      'lines.0.unitPrice',
      'lines.1.labourRateId',
      'lines.2.description',
    ])
    assert.isNull(quote)
  })

  test('accepting freezes the Quote and leaves the Job as it was', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })

    const response = await decide(client, quote!, office, 'accept')

    response.assertHeader('location', `/jobs/${job.id}`)
    response.assertFlashMessage('success', it('flash.quoteAccepted'))
    await job.refresh()
    assert.equal(job.status, 'open')
    await quote!.refresh()
    assert.equal(quote!.status, 'accepted')
    assert.isNotNull(quote!.decidedAt)

    const edit = await client
      .put(`/quotes/${quote!.id}`)
      .json({ lines: [] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edit.assertFlashMessage('error', it('flash.quoteNotEditable'))
  })

  test('declining declines only that Quote: the Job and its other Quotes carry on', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    const first = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })
    const second = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })
    await job.refresh()
    job.status = 'in_progress'
    await job.save()

    const response = await decide(client, first, office, 'decline')

    response.assertFlashMessage('success', it('flash.quoteDeclined'))
    await first.refresh()
    assert.equal(first.status, 'declined')
    await job.refresh()
    assert.equal(job.status, 'in_progress')
    assert.isNull(job.cancelledAt)
    // The other Quote is still a draft, and can be accepted
    await second.refresh()
    assert.equal(second.status, 'draft')
    await decide(client, second, office, 'accept')
    await second.refresh()
    assert.equal(second.status, 'accepted')
  })

  test('a Quote can only be decided once it has priced lines', async ({ client, assert }) => {
    const { office, job } = await setup()
    const { quote } = await write(client, office, job, {
      lines: [{ kind: 'text', description: 'Da definire' }],
    })

    for (const decision of ['accept', 'decline'] as const) {
      const response = await decide(client, quote!, office, decision)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    await quote!.refresh()
    assert.equal(quote!.status, 'draft')
    const page = await client.get(`/quotes/${quote!.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ editable: true, sendable: false, decidable: false })
  })

  test('a cancelled Job keeps its Quote frozen and gets no new one', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)

    // The draft is neither changed, sent nor decided either way
    for (const request of [
      client.put(`/quotes/${quote!.id}`).json({ lines: [] }),
      client.post(`/quotes/${quote!.id}/send`),
      client.post(`/quotes/${quote!.id}/accept`),
      client.post(`/quotes/${quote!.id}/decline`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    await quote!.refresh()
    assert.equal(quote!.status, 'draft')
    assert.isNull(quote!.sentAt)
    const page = await client.get(`/quotes/${quote!.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ editable: false, decidable: false })

    const { response } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })
    response.assertFlashMessage('error', it('flash.quoteNotWritable'))
    const create = await client.get(`/jobs/${job.id}/quotes/create`).loginAs(office).redirects(0)
    create.assertHeader('location', `/jobs/${job.id}`)
    create.assertFlashMessage('error', it('flash.quoteNotWritable'))
    assert.lengthOf(await Quote.query().where('jobId', job.id), 1)
    await job.refresh()
    assert.equal(job.status, 'cancelled')
  })

  test('archived Items and rates can not be added, and huge lines are refused', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    item.archivedAt = DateTime.now()
    await item.save()
    rate.archivedAt = DateTime.now()
    await rate.save()

    const { response } = await write(client, office, job, {
      lines: [
        { kind: 'item', itemId: item.id, description: 'X', quantity: '1', unitPrice: '1' },
        {
          kind: 'labour',
          labourRateId: rate.id,
          description: 'Y',
          quantity: '1',
          unitPrice: '1',
        },
        { kind: 'call_out', description: 'Z', quantity: '99999999', unitPrice: '9999999' },
      ],
    })

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'lines.0.itemId',
      'lines.1.labourRateId',
      'lines.2.quantity',
    ])
  })

  test('lines already on a Quote keep an Item or rate archived since', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })
    item.archivedAt = DateTime.now()
    await item.save()
    rate.archivedAt = DateTime.now()
    await rate.save()

    const response = await client
      .put(`/quotes/${quote!.id}`)
      .json({ notes: 'Aggiornato', lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.quoteSaved'))
    await quote!.refresh()
    assert.equal(quote!.notes, 'Aggiornato')
  })

  test('a Job gets several Quotes at any time, numbered from it', async ({ client, assert }) => {
    const { office, customer, item, rate } = await setup()
    const open = await createJob(customer)
    const started = await createJob(customer, { status: 'in_progress' })

    for (const job of [open, started]) {
      const page = await client.get(`/jobs/${job.id}/quotes/create`).withInertia().loginAs(office)
      page.assertInertiaPropsContains({ quote: null, editable: true, job: { id: job.id } })

      const first = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })
      await decide(client, first, office, 'accept')
      // Extra work once the first is accepted: a second Quote
      const second = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })
      assert.deepEqual([first.sequence, second.sequence], [1, 2])

      const edit = await client.get(`/quotes/${second.id}`).withInertia().loginAs(office)
      edit.assertInertiaPropsContains({
        job: { id: job.id, number: job.number },
        quote: { id: second.id, number: `${job.number}-2`, status: 'draft' },
      })
      await job.refresh()
      assert.equal(job.status, job.id === open.id ? 'open' : 'in_progress')
    }
    // Numbers count per Job
    const other = await createJob(customer)
    const quote = await newQuote(client, office, other, { lines: quoteLines(item.id, rate.id) })
    assert.equal(quote.sequence, 1)
  })

  test('the Job page lists its Quotes with numbers and statuses, and offers a new one', async ({
    client,
    assert,
  }) => {
    const { office, customer, job, item, rate } = await setup()
    const cancelled = await createJob(customer, { status: 'cancelled' })
    const props = async (id: number) => {
      const page = await client.get(`/jobs/${id}`).withInertia().loginAs(office)
      return page.inertiaProps
    }

    assert.containsSubset(await props(job.id), { quotes: [], canWriteQuote: true })
    assert.containsSubset(await props(cancelled.id), { quotes: [], canWriteQuote: false })

    const first = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })
    await decide(client, first, office, 'decline')
    const second = await newQuote(client, office, job, { lines: [quoteLines(item.id, rate.id)[2]] })
    assert.containsSubset(await props(job.id), {
      quotes: [
        { id: first.id, number: `${job.number}-1`, status: 'declined', total: '1664.98' },
        { id: second.id, number: `${job.number}-2`, status: 'draft', total: '36.60' },
      ],
      canWriteQuote: true,
    })
  })

  test('the Job list shows Quote statuses and filters Jobs by them', async ({ client, assert }) => {
    const { office, customer } = await setup()
    const waiting = await createJob(customer, { title: 'In attesa' })
    const signed = await createJob(customer, { title: 'Firmato' })
    const none = await createJob(customer, { title: 'Senza preventivo' })
    // Cancelled before the Customer answered: no answer is awaited
    const dropped = await createJob(customer, { title: 'Annullata', status: 'cancelled' })
    await createQuote(waiting, { status: 'sent' })
    await createQuote(dropped, { status: 'sent' })
    await createQuote(signed, { status: 'declined' })
    await createQuote(signed, { status: 'accepted' })

    const list = async (status?: string) => {
      const page = await client
        .get('/jobs')
        .qs(status ? { status } : {})
        .withInertia()
        .loginAs(office)
      return page.inertiaProps.jobs as {
        title: string
        quotes: { number: string; status: string }[]
      }[]
    }
    const titles = (rows: { title: string }[]) => rows.map((row) => row.title)
    const ours = [waiting.title, signed.title, none.title]
    const all = await list()
    const rows = all.filter((row) => ours.includes(row.title))
    assert.deepEqual(
      rows.map((row) => [row.title, row.quotes]),
      [
        [none.title, []],
        [
          signed.title,
          [
            { number: `${signed.number}-1`, status: 'declined' },
            { number: `${signed.number}-2`, status: 'accepted' },
          ],
        ],
        [waiting.title, [{ number: `${waiting.number}-1`, status: 'sent' }]],
      ]
    )
    assert.deepEqual(titles(await list('quote_sent')), [waiting.title])
    assert.deepEqual(titles(await list('quote_accepted')), [signed.title])
    // Quoted and accepted are no longer Job statuses
    for (const status of ['quoted', 'accepted']) {
      const refused = await client
        .get('/jobs')
        .qs({ status })
        .header('referer', '/jobs')
        .loginAs(office)
        .redirects(0)
      assert.properties(refused.flashMessage('inputErrorsBag'), ['status'])
    }
  })

  test('the Quote PDF is rendered on the letterhead', async ({ client }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })

    const response = await client.get(`/quotes/${quote!.id}/pdf`).loginAs(office)

    response.assertStatus(200)
    response.assertHeader('content-type', 'application/pdf')
    response.assertHeader(
      'content-disposition',
      `inline; filename="preventivo-${job.number.replace('/', '-')}-1.pdf"`
    )
  }).tags(['@gotenberg'])

  test('Office and the Admin write Quotes; Technicians and the Superuser can not', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    const quote = await newQuote(client, office, job, { lines: quoteLines(item.id, rate.id) })

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [
        `/jobs/${job.id}/quotes/create`,
        `/quotes/${quote.id}`,
        `/quotes/${quote.id}/pdf`,
      ]) {
        const response = await client.get(url).loginAs(user)
        response.assertStatus(403)
      }
      for (const request of [
        client.post(`/jobs/${job.id}/quotes`).json({ lines: quoteLines(item.id, rate.id) }),
        client.put(`/quotes/${quote.id}`).json({ lines: [] }),
        client.post(`/quotes/${quote.id}/send`),
        client.post(`/quotes/${quote.id}/accept`),
        client.post(`/quotes/${quote.id}/decline`),
        client.post(`/quotes/${quote.id}/import`).json({ lineIds: [1] }),
      ]) {
        const response = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await Quote.query().where('jobId', job.id), 1)
    await quote.refresh()
    await quote.load('lines')
    assert.equal(quote.status, 'draft')
    assert.lengthOf(quote.lines, 4)

    const admin = await createUser('admin')
    const page = await client.get(`/jobs/${job.id}/quotes/create`).withInertia().loginAs(admin)
    page.assertStatus(200)
    const { quote: byAdmin } = await write(client, admin, job, {
      lines: quoteLines(item.id, rate.id),
    })
    assert.equal(byAdmin!.sequence, 2)
  })
})

test.group('Rates', () => {
  test('the Admin manages Labour Rates and the Call-out Fee', async ({ client, assert }) => {
    const admin = await createUser('admin')

    await client
      .post('/settings/rates')
      .form({ name: 'Idraulico specializzato', hourlyPrice: '42,50' })
      .withCsrfToken()
      .loginAs(admin)
    const rate = await LabourRate.findByOrFail('name', 'Idraulico specializzato')
    assert.equal(rate.hourlyPrice, '42.5000')

    await client.post(`/settings/rates/${rate.id}/archive`).withCsrfToken().loginAs(admin)
    await rate.refresh()
    assert.isNotNull(rate.archivedAt)

    await client
      .put('/settings/call-out-fee')
      .form({ callOutFee: '35' })
      .withCsrfToken()
      .loginAs(admin)
    const settings = await CompanySettings.current()
    assert.equal(settings.callOutFee, '35.0000')
  })

  test('an archived rate name can be used again', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const old = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '30' })
    await client.post(`/settings/rates/${old.id}/archive`).withCsrfToken().loginAs(admin)

    await client
      .post('/settings/rates')
      .form({ name: 'Idraulico', hourlyPrice: '35' })
      .withCsrfToken()
      .loginAs(admin)

    const active = await LabourRate.query().where('name', 'Idraulico').whereNull('archived_at')
    assert.lengthOf(active, 1)
    assert.equal(active[0].hourlyPrice, '35.0000')
  })

  test('Office can not manage rates', async ({ client }) => {
    const office = await createUser('office')
    const response = await client.get('/settings/rates').withInertia().loginAs(office)
    response.assertStatus(403)
  })
})

test.group('Quote dates and validity', () => {
  test('saving dates the draft; deciding leaves the date alone', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, {
      validityDays: 30,
      lines: quoteLines(item.id, rate.id),
    })
    assert.equal(quote!.issuedOn?.toISODate(), DateTime.now().toISODate())
    assert.equal(quote!.validityDays, 30)

    // Issued some days ago, decided today: the date doesn't move
    const issued = DateTime.now().minus({ days: 5 }).startOf('day')
    quote!.issuedOn = issued
    await quote!.save()
    await decide(client, quote!, office, 'accept')
    await quote!.refresh()
    assert.equal(quote!.status, 'accepted')
    assert.equal(quote!.issuedOn?.toISODate(), issued.toISODate())
  })

  test('declining leaves the date alone too', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })
    const issued = DateTime.now().minus({ days: 3 }).startOf('day')
    await Quote.query().where('id', quote!.id).update({ issued_on: issued.toISODate() })

    await decide(client, quote!, office, 'decline')

    await quote!.refresh()
    assert.equal(quote!.status, 'declined')
    assert.equal(quote!.issuedOn?.toISODate(), issued.toISODate())
  })

  test('the validity is optional and between 1 and 365 days', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    const refused = await write(client, office, job, {
      validityDays: 0,
      lines: quoteLines(item.id, rate.id),
    })
    assert.properties(refused.response.flashMessage('inputErrorsBag'), ['validityDays'])
    assert.isNull(refused.quote)

    const { quote } = await write(client, office, job, { lines: quoteLines(item.id, rate.id) })
    assert.isNull(quote!.validityDays)
  })

  test('the document shows the number, issue date, validity, VAT summary and legal notes', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    const reverse = await vatCode('Inversione contabile – impianti su edifici')
    await write(client, office, job, { lines: [quoteLines(item.id, rate.id)[2]] })
    const { quote: second } = await write(client, office, job, {
      validityDays: 30,
      lines: [
        ...quoteLines(item.id, rate.id).slice(0, 1),
        {
          kind: 'labour',
          labourRateId: rate.id,
          description: 'Posa',
          quantity: '1',
          unitPrice: '100',
          vatCodeId: reverse.id,
        },
      ],
    })
    const issued = DateTime.fromISO('2026-03-02')
    await Quote.query().where('id', second!.id).update({ issued_on: issued.toISODate() })

    const quote = await Quote.query()
      .where('id', second!.id)
      .preload('job', (j) => j.preload('customer'))
      .preload('lines', (l) => l.orderBy('position'))
      .firstOrFail()
    const input = await quoteDocument(quote, i18nManager.locale('it'))
    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    // The Job's second Quote, about the Job
    assert.equal(input.title, it('documents.quote.title', { number: `${job.number}-2` }))
    assert.include(html, it('documents.quote.subject', { title: job.title }))
    assert.include(html, it('documents.quote.issuedOn', { date: '02/03/2026' }))
    assert.include(html, '01/04/2026')
    assert.include(html, 'N6.7')
    assert.include(html, 'inversione contabile')
    assert.include(html, it('documents.quote.total'))
  })
})

test.group('Sending Quotes', () => {
  /**
   * A draft with priced lines, notes and a validity, dated some days ago.
   */
  async function draft(client: ApiClient, base?: Awaited<ReturnType<typeof setup>>) {
    // Another Job on the same fixture, when a test needs several
    const fixture = base ? { ...base, job: await createJob(base.customer) } : await setup()
    const { office, job, item, rate } = fixture
    const { quote } = await write(client, office, job, {
      notes: 'Prima versione',
      validityDays: 30,
      lines: quoteLines(item.id, rate.id),
    })
    const issued = DateTime.now().minus({ days: 4 }).startOf('day')
    await Quote.query().where('id', quote!.id).update({ issued_on: issued.toISODate() })
    return { ...fixture, quote: quote!, issued }
  }

  async function statusOf(quote: Quote) {
    await quote.refresh()
    return quote.status
  }

  async function send(client: ApiClient, quote: Quote, user: User) {
    return client.post(`/quotes/${quote.id}/send`).withCsrfToken().loginAs(user).redirects(0)
  }

  /**
   * What a sent Quote must keep: its lines, notes, validity and date.
   */
  async function contents(quote: Quote) {
    const current = await Quote.query()
      .where('id', quote.id)
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()
    return {
      status: current.status,
      notes: current.notes,
      validityDays: current.validityDays,
      issuedOn: current.issuedOn?.toISODate(),
      lines: current.lines.map((line) => [line.description, line.quantity, line.unitPrice]),
    }
  }

  test('Office and the Admin mark a draft as sent; the Job stays as it was', async ({
    client,
    assert,
  }) => {
    const base = await setup()
    for (const role of ['office', 'admin'] as const) {
      const { job, quote, issued } = await draft(client, base)
      const user = await createUser(role)

      const response = await send(client, quote, user)

      response.assertHeader('location', `/quotes/${quote.id}`)
      response.assertFlashMessage('success', it('flash.quoteSent'))
      await quote.refresh()
      assert.equal(quote.status, 'sent')
      assert.isNotNull(quote.sentAt)
      assert.isNull(quote.decidedAt)
      // Dated by its last save, as the Customer received it
      assert.equal(quote.issuedOn?.toISODate(), issued.toISODate())
      await job.refresh()
      assert.equal(job.status, 'open')
    }
  })

  test('a sent Quote refuses every change: lines, notes, validity and date', async ({
    client,
    assert,
  }) => {
    const { office, quote, item, rate } = await draft(client)
    await send(client, quote, office)
    const before = await contents(quote)

    for (const body of [
      // The same lines with a new note, validity or price, or none at all
      { notes: 'Seconda versione', validityDays: 30, lines: quoteLines(item.id, rate.id) },
      { notes: 'Prima versione', validityDays: 60, lines: quoteLines(item.id, rate.id) },
      {
        notes: 'Prima versione',
        validityDays: 30,
        lines: quoteLines(item.id, rate.id).map((line) =>
          line.kind === 'item' ? { ...line, unitPrice: '999' } : line
        ),
      },
      { lines: [] },
    ]) {
      const response = await client
        .put(`/quotes/${quote.id}`)
        .json(body)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    // Sending it again changes nothing either
    const again = await send(client, quote, office)
    again.assertFlashMessage('error', it('flash.quoteNotEditable'))

    assert.deepEqual(await contents(quote), before)
  })

  test('a change after sending means a new Quote', async ({ client, assert }) => {
    const { office, job, quote, item, rate } = await draft(client)
    await send(client, quote, office)

    const { quote: revised } = await write(client, office, job, {
      notes: 'Seconda versione',
      lines: quoteLines(item.id, rate.id),
    })

    assert.equal(revised!.sequence, 2)
    assert.equal(revised!.status, 'draft')
    assert.equal(await statusOf(quote), 'sent')
  })

  test('the page shows a sent Quote frozen, still to be decided', async ({ client, assert }) => {
    const { office, job, quote } = await draft(client)
    const props = async () => {
      const page = await client.get(`/quotes/${quote.id}`).withInertia().loginAs(office)
      return page.inertiaProps
    }

    assert.containsSubset(await props(), {
      quote: { status: 'draft', sentAt: null },
      editable: true,
      sendable: true,
      decidable: true,
    })
    await send(client, quote, office)
    const sent = await props()
    assert.containsSubset(sent, {
      quote: { status: 'sent' },
      editable: false,
      sendable: false,
      decidable: true,
    })
    assert.isNotNull((sent.quote as { sentAt: string | null }).sentAt)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    assert.containsSubset(page.inertiaProps, {
      quotes: [{ id: quote.id, status: 'sent' }],
      canWriteQuote: true,
    })
  })

  test('only a draft with priced lines on a live Job can be sent', async ({ client, assert }) => {
    const base = await setup()
    const { office, job } = base

    // Only text: nothing to price
    const { quote: text } = await write(client, office, job, {
      lines: [{ kind: 'text', description: 'Da definire' }],
    })
    const refused = await send(client, text!, office)
    refused.assertFlashMessage('error', it('flash.quoteNotEditable'))
    assert.equal(await statusOf(text!), 'draft')

    // Already decided
    for (const decision of ['accept', 'decline'] as const) {
      const decided = await draft(client, base)
      await decide(client, decided.quote, office, decision)
      const response = await send(client, decided.quote, office)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
      assert.equal(await statusOf(decided.quote), decision === 'accept' ? 'accepted' : 'declined')
    }

    // A cancelled Job's draft
    const cancelled = await draft(client, base)
    await client.post(`/jobs/${cancelled.job.id}/cancel`).withCsrfToken().loginAs(office)
    const response = await send(client, cancelled.quote, office)
    response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    assert.equal(await statusOf(cancelled.quote), 'draft')
  })

  test('a sent Quote is accepted, leaving the Job alone', async ({ client, assert }) => {
    const { office, job, quote } = await draft(client)
    await send(client, quote, office)
    await quote.refresh()
    const sentAt = quote.sentAt

    const response = await decide(client, quote, office, 'accept')

    response.assertFlashMessage('success', it('flash.quoteAccepted'))
    await quote.refresh()
    assert.equal(quote.status, 'accepted')
    assert.isNotNull(quote.decidedAt)
    assert.equal(quote.sentAt?.toMillis(), sentAt?.toMillis())
    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test('a sent Quote is declined, leaving the Job alone', async ({ client, assert }) => {
    const { office, job, quote } = await draft(client)
    await send(client, quote, office)

    await decide(client, quote, office, 'decline')

    await quote.refresh()
    assert.equal(quote.status, 'declined')
    assert.isNotNull(quote.decidedAt)
    await job.refresh()
    assert.equal(job.status, 'open')
    assert.isNull(job.cancelledAt)
  })

  test('a draft decided on the spot, either way, counts as sent', async ({ client, assert }) => {
    const base = await setup()
    for (const [decision, status] of [
      ['accept', 'accepted'],
      ['decline', 'declined'],
    ] as const) {
      const { office, job, quote } = await draft(client, base)

      await decide(client, quote, office, decision)

      await quote.refresh()
      assert.equal(quote.status, status)
      assert.isNotNull(quote.sentAt)
      assert.equal(quote.sentAt?.toMillis(), quote.decidedAt?.toMillis())
      // What the Customer received is kept, as when sending
      assert.equal(quote.subject, job.title)
      assert.equal(quote.customerSnapshot?.city, base.customer.city)
      assert.isNotNull(quote.companySnapshot)
      await job.refresh()
      assert.equal(job.status, 'open')
    }
  })

  test("a sent Quote's document stays as it went out", async ({ client, assert }) => {
    const { office, job, quote, customer } = await draft(client)
    const settings = await CompanySettings.current()
    settings.merge({ name: 'Idraulica Maso', street: 'Via Roma', city: 'Trento' })
    await settings.save()
    const render = async () => {
      const current = await Quote.query()
        .where('id', quote.id)
        .preload('job', (j) => j.preload('customer'))
        .preload('lines', (lines) => lines.orderBy('position'))
        .firstOrFail()
      const input = await quoteDocument(current, i18nManager.locale('it'))
      return new DocumentRenderer(noConverter).renderHtml(input)
    }
    await send(client, quote, office)
    const sent = await render()
    assert.include(sent, 'Idraulica Maso')
    assert.include(sent, customer.city)

    // Everything the document printed changes afterwards
    const other = await createCustomer({ name: 'Altro Cliente', city: 'Bolzano' })
    customer.merge({ street: 'Via Nuova', city: 'Rovereto' })
    await customer.save()
    await Job.query().where('id', job.id).update({ customer_id: other.id, title: 'Altro lavoro' })
    settings.merge({ name: 'Altra ditta', street: 'Via Verdi', city: 'Merano' })
    await settings.save()

    assert.equal(await render(), sent)
  })

  test("a sent Quote's lines can't be imported until it is accepted", async ({
    client,
    assert,
  }) => {
    const { office, job, quote } = await draft(client)
    await send(client, quote, office)
    await quote.load('lines')

    const response = await client
      .post(`/quotes/${quote.id}/import`)
      .json({ lineIds: quote.lines.map((line) => line.id), workerName: 'Mario' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.quoteImportRefused.notAccepted'))
    assert.lengthOf(await Charge.query().where('jobId', job.id), 0)
  })

  test("a cancelled Job's sent Quote stays as it is", async ({ client, assert }) => {
    const { office, job, quote, item, rate } = await draft(client)
    await send(client, quote, office)
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)
    const before = await contents(quote)

    for (const request of [
      client.put(`/quotes/${quote.id}`).json({ lines: quoteLines(item.id, rate.id) }),
      client.post(`/quotes/${quote.id}/send`),
      client.post(`/quotes/${quote.id}/accept`),
      client.post(`/quotes/${quote.id}/decline`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    assert.deepEqual(await contents(quote), { ...before, status: 'sent' })
    await job.refresh()
    assert.equal(job.status, 'cancelled')
  })
})
