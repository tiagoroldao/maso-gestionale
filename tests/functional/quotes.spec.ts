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

test.group('Quotes', () => {
  test('saving the lines prices them and marks the Job as quoted', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    const response = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ notes: 'Validità 30 giorni', lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertHeader('location', `/jobs/${job.id}/quote`)
    const quote = await Quote.query()
      .where('jobId', job.id)
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
    await job.refresh()
    assert.equal(job.status, 'quoted')
  })

  test('each priced line keeps its VAT treatment, summed per rate', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    const reduced = await vatCode('10%')
    const reverse = await vatCode('Inversione contabile – impianti su edifici')

    await client
      .put(`/jobs/${job.id}/quote`)
      .json({
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
      .withCsrfToken()
      .loginAs(office)

    reduced.rate = '11'
    await reduced.save()
    const quote = await Quote.query()
      .where('jobId', job.id)
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
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [line(reduced.id)] })
      .withCsrfToken()
      .loginAs(office)
    const four = await vatCode('4%')
    for (const code of [reduced, four]) {
      code.archivedAt = DateTime.now()
      await code.save()
    }

    const refused = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [line(reduced.id), line(four.id), line()] })
      .header('referer', `/jobs/${job.id}/quote`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    const errors = refused.flashMessage('inputErrorsBag') as Record<string, unknown>
    assert.deepEqual(Object.keys(errors).sort(), ['lines.1.vatCodeId', 'lines.2.vatCodeId'])
  })

  test('saving again replaces the lines', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    for (const lines of [quoteLines(item.id, rate.id), [quoteLines(item.id, rate.id)[2]]]) {
      await client.put(`/jobs/${job.id}/quote`).json({ lines }).withCsrfToken().loginAs(office)
    }

    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.lengthOf(quote.lines, 1)
    assert.equal(quote.taxable, '30.00')
  })

  test('priced lines need a quantity and a price; text lines only words', async ({
    client,
    assert,
  }) => {
    const { office, job, item } = await setup()

    const response = await client
      .put(`/jobs/${job.id}/quote`)
      .json({
        lines: [
          { kind: 'item', itemId: item.id, description: 'X' },
          { kind: 'labour', description: 'Y', quantity: '1', unitPrice: '10' },
          { kind: 'text', description: '' },
        ],
      })
      .header('referer', `/jobs/${job.id}/quote`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), [
      'lines.0.quantity',
      'lines.0.unitPrice',
      'lines.1.labourRateId',
      'lines.2.description',
    ])
    assert.isNull(await Quote.findBy('jobId', job.id))
  })

  test('accepting moves the Job to accepted and freezes the Quote', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)

    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)
    await job.refresh()
    assert.equal(job.status, 'accepted')
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.status, 'accepted')
    assert.isNotNull(quote.decidedAt)

    const edit = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    edit.assertFlashMessage('error', it('flash.quoteNotEditable'))
  })

  test('declining cancels the Job', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)

    await client.post(`/jobs/${job.id}/quote/decline`).withCsrfToken().loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'cancelled')
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.status, 'declined')
  })

  test('a Quote can only be decided once it has priced lines', async ({ client, assert }) => {
    const { office, job } = await setup()

    const response = await client
      .post(`/jobs/${job.id}/quote/accept`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test('saving only text lines puts the Job back to open', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)

    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [{ kind: 'text', description: 'Da definire' }] })
      .withCsrfToken()
      .loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'open')
  })

  test('a cancelled Job keeps its Quote frozen', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)

    for (const request of [
      client.put(`/jobs/${job.id}/quote`).json({ lines: [] }),
      client.post(`/jobs/${job.id}/quote/accept`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
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

    const response = await client
      .put(`/jobs/${job.id}/quote`)
      .json({
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
      .header('referer', `/jobs/${job.id}/quote`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

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
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    item.archivedAt = DateTime.now()
    await item.save()
    rate.archivedAt = DateTime.now()
    await rate.save()

    const response = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ notes: 'Aggiornato', lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.quoteSaved'))
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.notes, 'Aggiornato')
  })

  test('a Quote is started on any open Job, not once work has begun', async ({
    client,
    assert,
  }) => {
    const { office, customer, item, rate } = await setup()
    const open = await createJob(customer)
    const started = await createJob(customer, { status: 'in_progress' })

    const editable = await client.get(`/jobs/${open.id}/quote`).withInertia().loginAs(office)
    editable.assertInertiaPropsContains({ editable: true })
    await client
      .put(`/jobs/${open.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    await open.refresh()
    assert.equal(open.status, 'quoted')

    const refused = await client.get(`/jobs/${started.id}/quote`).withInertia().loginAs(office)
    refused.assertInertiaPropsContains({ editable: false })
    await client
      .put(`/jobs/${started.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    assert.isNull(await Quote.findBy('jobId', started.id))
    await started.refresh()
    assert.equal(started.status, 'in_progress')
  })

  test('the Job page lists its Quote, or offers one while the Job is open', async ({
    client,
    assert,
  }) => {
    const { office, customer, job, item, rate } = await setup()
    const started = await createJob(customer, { status: 'in_progress' })
    const props = async (id: number) => {
      const page = await client.get(`/jobs/${id}`).withInertia().loginAs(office)
      return page.inertiaProps
    }

    assert.containsSubset(await props(job.id), { quote: null, canStartQuote: true })
    assert.containsSubset(await props(started.id), { quote: null, canStartQuote: false })

    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    assert.containsSubset(await props(job.id), {
      quote: { status: 'draft' },
      canStartQuote: false,
    })
    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)
    assert.containsSubset(await props(job.id), {
      quote: { status: 'accepted' },
      canStartQuote: false,
    })
  })

  test('the Quote PDF is rendered on the letterhead', async ({ client }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)

    const response = await client.get(`/jobs/${job.id}/quote.pdf`).loginAs(office)

    response.assertStatus(200)
    response.assertHeader('content-type', 'application/pdf')
  }).tags(['@gotenberg'])

  test('Technicians can not see or write Quotes', async ({ client }) => {
    const { job } = await setup()
    const technician = await createUser('technician')

    for (const url of [`/jobs/${job.id}/quote`, `/jobs/${job.id}/quote.pdf`]) {
      const response = await client.get(url).loginAs(technician)
      response.assertStatus(403)
    }
    const response = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [] })
      .header('referer', '/')
      .withCsrfToken()
      .loginAs(technician)
      .redirects(0)
    response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
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
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ validityDays: 30, lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.issuedOn?.toISODate(), DateTime.now().toISODate())
    assert.equal(quote.validityDays, 30)

    // Issued some days ago, decided today: the date doesn't move
    const issued = DateTime.now().minus({ days: 5 }).startOf('day')
    quote.issuedOn = issued
    await quote.save()
    await client.post(`/jobs/${job.id}/quote/accept`).withCsrfToken().loginAs(office)
    await quote.refresh()
    assert.equal(quote.status, 'accepted')
    assert.equal(quote.issuedOn?.toISODate(), issued.toISODate())
  })

  test('declining leaves the date alone too', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    const issued = DateTime.now().minus({ days: 3 }).startOf('day')
    await Quote.query().where('jobId', job.id).update({ issued_on: issued.toISODate() })

    await client.post(`/jobs/${job.id}/quote/decline`).withCsrfToken().loginAs(office)

    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.status, 'declined')
    assert.equal(quote.issuedOn?.toISODate(), issued.toISODate())
  })

  test('the validity is optional and between 1 and 365 days', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    const refused = await client
      .put(`/jobs/${job.id}/quote`)
      .json({ validityDays: 0, lines: quoteLines(item.id, rate.id) })
      .header('referer', `/jobs/${job.id}/quote`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    assert.properties(refused.flashMessage('inputErrorsBag'), ['validityDays'])
    assert.isNull(await Quote.findBy('jobId', job.id))

    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.isNull(quote.validityDays)
  })

  test('the document shows the issue date, the validity, the VAT summary and legal notes', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await setup()
    const reverse = await vatCode('Inversione contabile – impianti su edifici')
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({
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
      .withCsrfToken()
      .loginAs(office)
    const issued = DateTime.fromISO('2026-03-02')
    await Quote.query().where('jobId', job.id).update({ issued_on: issued.toISODate() })

    await job.load('customer')
    await job.load('quote', (q) => q.preload('lines', (l) => l.orderBy('position')))
    const input = await quoteDocument(job, job.quote, i18nManager.locale('it'))
    const html = await new DocumentRenderer(noConverter).renderHtml(input)

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
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ notes: 'Prima versione', validityDays: 30, lines: quoteLines(item.id, rate.id) })
      .withCsrfToken()
      .loginAs(office)
    const issued = DateTime.now().minus({ days: 4 }).startOf('day')
    await Quote.query().where('jobId', job.id).update({ issued_on: issued.toISODate() })
    return { ...fixture, issued }
  }

  async function statusOf(jobId: number) {
    const quote = await Quote.findByOrFail('jobId', jobId)
    return quote.status
  }

  async function send(client: ApiClient, jobId: number, user: User) {
    return client.post(`/jobs/${jobId}/quote/send`).withCsrfToken().loginAs(user).redirects(0)
  }

  /**
   * What a sent Quote must keep: its lines, notes, validity and date.
   */
  async function contents(jobId: number) {
    const quote = await Quote.query()
      .where('jobId', jobId)
      .preload('lines', (lines) => lines.orderBy('position'))
      .firstOrFail()
    return {
      status: quote.status,
      notes: quote.notes,
      validityDays: quote.validityDays,
      issuedOn: quote.issuedOn?.toISODate(),
      lines: quote.lines.map((line) => [line.description, line.quantity, line.unitPrice]),
    }
  }

  test('Office and the Admin mark a draft as sent; the Job stays quoted', async ({
    client,
    assert,
  }) => {
    const base = await setup()
    for (const role of ['office', 'admin'] as const) {
      const { job, issued } = await draft(client, base)
      const user = await createUser(role)

      const response = await send(client, job.id, user)

      response.assertHeader('location', `/jobs/${job.id}/quote`)
      response.assertFlashMessage('success', it('flash.quoteSent'))
      const quote = await Quote.findByOrFail('jobId', job.id)
      assert.equal(quote.status, 'sent')
      assert.isNotNull(quote.sentAt)
      assert.isNull(quote.decidedAt)
      // Dated by its last save, as the Customer received it
      assert.equal(quote.issuedOn?.toISODate(), issued.toISODate())
      await job.refresh()
      assert.equal(job.status, 'quoted')
    }
  })

  test('a sent Quote refuses every change: lines, notes, validity and date', async ({
    client,
    assert,
  }) => {
    const { office, job, item, rate } = await draft(client)
    await send(client, job.id, office)
    const before = await contents(job.id)

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
        .put(`/jobs/${job.id}/quote`)
        .json(body)
        .withCsrfToken()
        .loginAs(office)
        .redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    // Sending it again changes nothing either
    const again = await send(client, job.id, office)
    again.assertFlashMessage('error', it('flash.quoteNotEditable'))

    assert.deepEqual(await contents(job.id), before)
    await job.refresh()
    assert.equal(job.status, 'quoted')
  })

  test('the page shows a sent Quote frozen, still to be decided', async ({ client, assert }) => {
    const { office, job } = await draft(client)
    const props = async () => {
      const page = await client.get(`/jobs/${job.id}/quote`).withInertia().loginAs(office)
      return page.inertiaProps
    }

    assert.containsSubset(await props(), {
      quote: { status: 'draft', sentAt: null },
      editable: true,
      sendable: true,
      decidable: true,
    })
    await send(client, job.id, office)
    const sent = await props()
    assert.containsSubset(sent, {
      quote: { status: 'sent' },
      editable: false,
      sendable: false,
      decidable: true,
    })
    assert.isNotNull((sent.quote as { sentAt: string | null }).sentAt)

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    assert.containsSubset(page.inertiaProps, { quote: { status: 'sent' }, canStartQuote: false })
  })

  test('only a draft with priced lines on a live Job can be sent', async ({ client, assert }) => {
    const base = await setup()
    const { office, job } = base
    // No Quote yet
    const none = await send(client, job.id, office)
    none.assertFlashMessage('error', it('flash.quoteNotEditable'))

    // Only text: nothing to price, the Job is still open
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [{ kind: 'text', description: 'Da definire' }] })
      .withCsrfToken()
      .loginAs(office)
    const text = await send(client, job.id, office)
    text.assertFlashMessage('error', it('flash.quoteNotEditable'))
    assert.equal(await statusOf(job.id), 'draft')

    // Already decided
    for (const decision of ['accept', 'decline'] as const) {
      const decided = await draft(client, base)
      await client.post(`/jobs/${decided.job.id}/quote/${decision}`).withCsrfToken().loginAs(office)
      const response = await send(client, decided.job.id, office)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
      const quote = await Quote.findByOrFail('jobId', decided.job.id)
      assert.equal(quote.status, decision === 'accept' ? 'accepted' : 'declined')
    }

    // A cancelled Job's draft
    const cancelled = await draft(client, base)
    await client.post(`/jobs/${cancelled.job.id}/cancel`).withCsrfToken().loginAs(office)
    const response = await send(client, cancelled.job.id, office)
    response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    assert.equal(await statusOf(cancelled.job.id), 'draft')
  })

  test('a sent Quote is accepted, moving the Job as before', async ({ client, assert }) => {
    const { office, job } = await draft(client)
    await send(client, job.id, office)
    const { sentAt } = await Quote.findByOrFail('jobId', job.id)

    const response = await client
      .post(`/jobs/${job.id}/quote/accept`)
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.quoteAccepted'))
    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.status, 'accepted')
    assert.isNotNull(quote.decidedAt)
    assert.equal(quote.sentAt?.toMillis(), sentAt?.toMillis())
    await job.refresh()
    assert.equal(job.status, 'accepted')
  })

  test('a sent Quote is declined, cancelling the Job as before', async ({ client, assert }) => {
    const { office, job } = await draft(client)
    await send(client, job.id, office)

    await client.post(`/jobs/${job.id}/quote/decline`).withCsrfToken().loginAs(office)

    const quote = await Quote.findByOrFail('jobId', job.id)
    assert.equal(quote.status, 'declined')
    assert.isNotNull(quote.decidedAt)
    await job.refresh()
    assert.equal(job.status, 'cancelled')
    assert.isNotNull(job.cancelledAt)
  })

  test('a draft decided on the spot counts as sent', async ({ client, assert }) => {
    const base = await setup()
    for (const [decision, status, jobStatus] of [
      ['accept', 'accepted', 'accepted'],
      ['decline', 'declined', 'cancelled'],
    ] as const) {
      const { office, job } = await draft(client, base)

      await client.post(`/jobs/${job.id}/quote/${decision}`).withCsrfToken().loginAs(office)

      const quote = await Quote.findByOrFail('jobId', job.id)
      assert.equal(quote.status, status)
      assert.isNotNull(quote.sentAt)
      assert.equal(quote.sentAt?.toMillis(), quote.decidedAt?.toMillis())
      // What the Customer received is kept, as when sending
      assert.equal(quote.subject, job.title)
      assert.equal(quote.customerSnapshot?.city, base.customer.city)
      assert.isNotNull(quote.companySnapshot)
      await job.refresh()
      assert.equal(job.status, jobStatus)
    }
  })

  test("a sent Quote's document stays as it went out", async ({ client, assert }) => {
    const { office, job, customer } = await draft(client)
    const settings = await CompanySettings.current()
    settings.merge({ name: 'Idraulica Maso', street: 'Via Roma', city: 'Trento' })
    await settings.save()
    const render = async () => {
      const quote = await Quote.query()
        .where('jobId', job.id)
        .preload('lines', (lines) => lines.orderBy('position'))
        .firstOrFail()
      const current = await Job.query().where('id', job.id).preload('customer').firstOrFail()
      const input = await quoteDocument(current, quote, i18nManager.locale('it'))
      return new DocumentRenderer(noConverter).renderHtml(input)
    }
    await send(client, job.id, office)
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
    const { office, job } = await draft(client)
    await send(client, job.id, office)
    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()

    const response = await client
      .post(`/jobs/${job.id}/quote/import`)
      .json({ lineIds: quote.lines.map((line) => line.id), workerName: 'Mario' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)

    response.assertFlashMessage('error', it('flash.quoteImportRefused.notAccepted'))
    assert.lengthOf(await Charge.query().where('jobId', job.id), 0)
  })

  test("a cancelled Job's sent Quote stays as it is", async ({ client, assert }) => {
    const { office, job, item, rate } = await draft(client)
    await send(client, job.id, office)
    await client.post(`/jobs/${job.id}/cancel`).withCsrfToken().loginAs(office)
    const before = await contents(job.id)

    for (const request of [
      client.put(`/jobs/${job.id}/quote`).json({ lines: quoteLines(item.id, rate.id) }),
      client.post(`/jobs/${job.id}/quote/send`),
      client.post(`/jobs/${job.id}/quote/accept`),
      client.post(`/jobs/${job.id}/quote/decline`),
    ]) {
      const response = await request.withCsrfToken().loginAs(office).redirects(0)
      response.assertFlashMessage('error', it('flash.quoteNotEditable'))
    }
    assert.deepEqual(await contents(job.id), { ...before, status: 'sent' })
    await job.refresh()
    assert.equal(job.status, 'cancelled')
  })

  test('Technicians and the Superuser can not send or decide a Quote', async ({
    client,
    assert,
  }) => {
    const { job } = await draft(client)
    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const action of ['send', 'accept', 'decline']) {
        const response = await client
          .post(`/jobs/${job.id}/quote/${action}`)
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.equal(await statusOf(job.id), 'draft')
  })
})
