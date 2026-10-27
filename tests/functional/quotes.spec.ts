import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Quote from '#models/quote'
import LabourRate from '#models/labour_rate'
import CompanySettings from '#models/company_settings'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

async function setup() {
  const office = await createUser('office')
  const customer = await createCustomer()
  const job = await createJob(customer, { kind: 'quoted' })
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
    },
    {
      kind: 'labour',
      labourRateId: rateId,
      description: 'Installazione',
      quantity: '3,5',
      unitPrice: '38,50',
    },
    { kind: 'call_out', description: 'Diritto di chiamata', quantity: '1', unitPrice: '30' },
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
    assert.equal(quote.total, '1364.74')
    assert.equal(quote.notes, 'Validità 30 giorni')
    await job.refresh()
    assert.equal(job.status, 'quoted')
  })

  test('saving again replaces the lines', async ({ client, assert }) => {
    const { office, job, item, rate } = await setup()

    for (const lines of [quoteLines(item.id, rate.id), [quoteLines(item.id, rate.id)[2]]]) {
      await client.put(`/jobs/${job.id}/quote`).json({ lines }).withCsrfToken().loginAs(office)
    }

    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.lengthOf(quote.lines, 1)
    assert.equal(quote.total, '30.00')
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

  test('the kind of a Job with a Quote can not change', async ({ client, assert }) => {
    const { office, customer, job } = await setup()
    await client
      .put(`/jobs/${job.id}/quote`)
      .json({ lines: [{ kind: 'text', description: 'Bozza' }] })
      .withCsrfToken()
      .loginAs(office)

    await client
      .put(`/jobs/${job.id}`)
      .form({ customerId: String(customer.id), kind: 'time_and_materials', title: job.title })
      .withCsrfToken()
      .loginAs(office)

    await job.refresh()
    assert.equal(job.status, 'open')
    assert.equal(job.kind, 'quoted')
  })

  test('Time & Materials Jobs have no Quote', async ({ client, assert }) => {
    const { office, customer } = await setup()
    const job = await createJob(customer, { kind: 'time_and_materials' })

    const page = await client.get(`/jobs/${job.id}/quote`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({ editable: false })

    await client.put(`/jobs/${job.id}/quote`).json({ lines: [] }).withCsrfToken().loginAs(office)
    assert.isNull(await Quote.findBy('jobId', job.id))
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
