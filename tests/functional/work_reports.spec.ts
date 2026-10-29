import { rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import i18nManager from '@adonisjs/i18n/services/main'
import Charge from '#models/charge'
import ChargeEvent from '#models/charge_event'
import DocumentTemplate from '#models/document_template'
import IssuedDocument from '#models/issued_document'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import VisitNote from '#models/visit_note'
import DocumentRenderer from '#documents/document_renderer'
import { issuedDocument } from '#documents/issued_document'
import type { PdfConverter } from '#documents/pdf_converter'
import Charges from '#services/charges'
import DocumentTemplates from '#services/document_templates'
import FieldWork from '#services/field_work'
import Scheduling from '#services/scheduling'
import WorkReports from '#services/work_reports'
import { storagePath } from '#services/storage'
import { formatDate } from '#shared/dates'
import { formatMoney } from '#shared/money'
import type { TemplateNode } from '#shared/document_templates'
import { completeCompany } from '#tests/helpers/company'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { markDone } from '#tests/helpers/charges'
import { createJob } from '#tests/helpers/jobs'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'
import { addedTemplates } from '#tests/helpers/document_templates'

const i18n = () => i18nManager.locale('it')
const noConverter: PdfConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}

// Days of the Visits, counted back from today (a work day is never later)
const daysAgo = (days: number) => DateTime.now().minus({ days }).startOf('day')
const iso = (days: number) => daysAgo(days).toISODate()!
const shown = (days: number) => formatDate(iso(days))

async function visitOn(job: Job, technicians: User[], days: number, status: Visit['status']) {
  const startsAt = daysAgo(days).set({ hour: 9 })
  const visit = await Visit.create({
    jobId: job.id,
    startsAt,
    endsAt: startsAt.plus({ hours: 3 }),
    status,
  })
  await visit.related('technicians').attach(technicians.map((technician) => technician.id))
  return visit
}

/**
 * A long Job: on the first Visit, ten days ago, Anna and Bruno worked 2
 * and 1 hours as plumbers and a contractor 1 hour as electrician, used 3
 * valves of the 4 recorded, and Anna wrote a note; on the second, three
 * days ago, Anna worked an hour that Office won't bill. A cancelled Visit,
 * one still planned, and a call-out on the Job itself aren't work of a day.
 */
async function longJob() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna Neri' })
  const bruno = await createUser('technician', { fullName: 'Bruno Blu' })
  const customer = await createCustomer({ name: 'Condominio Verdi' })
  const job = await createJob(customer, { status: 'in_progress', title: 'Rifacimento impianto' })
  const plumber = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const electrician = await LabourRate.create({ name: 'Elettricista', hourlyPrice: '50' })
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })

  const first = await visitOn(job, [bruno, anna], 10, 'in_progress')
  await FieldWork.recordHours(first, {
    technicianId: anna.id,
    labourRateId: plumber.id,
    hours: '2',
  })
  await FieldWork.recordItem(first, { itemId: valve.id, quantity: '3' })
  await FieldWork.recordHours(first, {
    workerName: 'Carlo Ditta',
    labourRateId: electrician.id,
    hours: '1',
  })
  await FieldWork.recordHours(first, {
    technicianId: bruno.id,
    labourRateId: plumber.id,
    hours: '1',
  })
  const unused = await FieldWork.recordItem(first, { itemId: valve.id, quantity: '1' })
  await VisitNote.create({ visitId: first.id, userId: anna.id, body: 'Valvola sostituita' })
  await FieldWork.setStatus(first, 'done', anna, [unused.id])

  const cancelled = await visitOn(job, [anna], 5, 'planned')
  await FieldWork.recordItem(cancelled, { itemId: valve.id, quantity: '2' })
  await Scheduling.cancel(cancelled, office)

  const second = await visitOn(job, [anna], 3, 'in_progress')
  const unbilled = await FieldWork.recordHours(second, {
    technicianId: anna.id,
    labourRateId: plumber.id,
    hours: '1',
  })
  await FieldWork.setStatus(second, 'needs_return', anna)
  await Charges.setBillable(unbilled, false, office)

  const planned = await visitOn(job, [anna], 0, 'planned')
  await FieldWork.recordHours(planned, {
    technicianId: anna.id,
    labourRateId: plumber.id,
    hours: '4',
  })
  await Charges.add(
    job,
    { description: 'Uscita', quantity: '1', unitPrice: '30', unit: null, vatKind: 'labour' },
    office
  )

  const template = await DocumentTemplate.findByOrFail('name', 'Rapportino di lavoro')
  return { office, anna, customer, job, template }
}

function issue(
  { client, office }: { client: any; office: User },
  template: DocumentTemplate,
  customerId: number,
  values: Record<string, unknown>
) {
  return client
    .post('/issued-documents')
    .json({ templateId: template.id, customerId, values })
    .withCsrfToken()
    .loginAs(office)
}

const whole = { from: '', to: '', prices: false, notes: false, jobCharges: false }

test.group('Work report for a Job (#180)', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office issues it for the whole Job: a numbered, frozen day-by-day table', async ({
    client,
    assert,
  }) => {
    const { office, anna, customer, job, template } = await longJob()
    const plumber = await LabourRate.findByOrFail('name', 'Idraulico')

    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: whole,
    })

    response.assertStatus(200)
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.equal(document.number, `${DateTime.now().year}/0001`)
    assert.equal(document.jobId, job.id)
    assert.equal(document.values['field.rapportino'], it('documents.workReport.wholeJob'))
    // Done work of closed Visits only, day by day: hours per Labour Rate
    // (Anna's and Bruno's summed), the Items used, no prices nor notes
    assert.deepEqual(document.tables.rapportino, {
      headers: ['Data', 'Tecnici', 'Descrizione', 'Quantità'],
      rows: [
        [shown(10), 'Anna Neri, Bruno Blu, Carlo Ditta', 'Idraulico', '3 h'],
        ['', '', 'Valvola', '3 pz'],
        ['', '', 'Elettricista', '1 h'],
        [shown(3), 'Anna Neri', 'Idraulico', '1 h'],
      ],
    })

    // Frozen: later work doesn't change it, and the PDF prints the copy
    const later = await visitOn(job, [anna], 1, 'in_progress')
    await FieldWork.recordHours(later, {
      technicianId: anna.id,
      labourRateId: plumber.id,
      hours: '5',
    })
    await FieldWork.setStatus(later, 'done', anna)
    await document.refresh()
    assert.lengthOf(document.tables.rapportino.rows, 4)
    const html = await new DocumentRenderer(noConverter).renderHtml(
      await issuedDocument(document, i18n())
    )
    assert.include(html, '<td>Idraulico</td><td>3 h</td>')
    assert.include(html, 'Rifacimento impianto')
  })

  test('for a period, with prices and notes', async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()

    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { from: iso(4), to: iso(1), prices: true, notes: true, jobCharges: true },
    })

    response.assertStatus(200)
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.equal(
      document.values['field.rapportino'],
      it('documents.workReport.between', { from: shown(4), to: shown(1) })
    )
    assert.deepEqual(document.tables.rapportino, {
      headers: [
        'Data',
        'Tecnici',
        'Descrizione',
        'Quantità',
        'Prezzo',
        it('documents.workReport.amount'),
      ],
      rows: [
        [
          shown(3),
          'Anna Neri',
          'Idraulico',
          '1 h',
          formatMoney('40'),
          it('documents.workReport.notBilled'),
        ],
        ['', '', it('documents.workReport.total'), '', '', formatMoney('0')],
      ],
    })

    const first = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { from: '', to: iso(10), prices: true, notes: true, jobCharges: true },
    })
    const firstDay = await IssuedDocument.findOrFail(first.body().id)
    assert.equal(firstDay.number, `${DateTime.now().year}/0002`)
    assert.deepEqual(firstDay.tables.rapportino.rows, [
      [
        shown(10),
        'Anna Neri, Bruno Blu, Carlo Ditta',
        'Idraulico',
        '3 h',
        formatMoney('40'),
        formatMoney('120'),
      ],
      ['', '', 'Valvola', '3 pz', formatMoney('7.5'), formatMoney('22.5')],
      ['', '', 'Elettricista', '1 h', formatMoney('50'), formatMoney('50')],
      ['', '', 'Note: Valvola sostituita', '', '', ''],
      ['', '', it('documents.workReport.total'), '', '', formatMoney('192.5')],
    ])
  })

  test('with prices, a line shows the quantity billed; without, the one recorded', async ({
    client,
    assert,
  }) => {
    const { office, anna, customer, job, template } = await longJob()
    // Of Anna's and Bruno's 3 hours, Office bills 2: Anna's 2 become 1
    const annas = await Charge.query()
      .where('jobId', job.id)
      .where('userId', anna.id)
      .where('quantity', 2)
      .firstOrFail()
    await Charges.editBilling(
      annas,
      { quantity: '1', unitPrice: annas.unitPrice, description: annas.description },
      office
    )
    const period = { from: iso(10), to: iso(10), notes: false, jobCharges: true }

    const priced = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { ...period, prices: true },
    })
    const plain = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { ...period, prices: false },
    })

    const withPrices = await IssuedDocument.findOrFail(priced.body().id)
    assert.deepEqual(withPrices.tables.rapportino.rows[0].slice(2), [
      'Idraulico',
      '2 h',
      formatMoney('40'),
      formatMoney('80'),
    ])
    const withoutPrices = await IssuedDocument.findOrFail(plain.body().id)
    assert.deepEqual(withoutPrices.tables.rapportino.rows[0].slice(2), ['Idraulico', '3 h'])
  })

  test('refused without a Job, with a period ending before it starts, or bad options', async ({
    client,
    assert,
  }) => {
    const { office, customer, job, template } = await longJob()
    const other = await createJob(await createCustomer({ name: 'Altro' }))

    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [
        { rapportino: whole },
        {
          commessa: it('errors.templateData.required'),
          rapportino: it('errors.templateData.workReportNeedsJob'),
        },
      ],
      [
        { commessa: other.id, rapportino: whole },
        {
          commessa: it('errors.templateData.job'),
          rapportino: it('errors.templateData.workReportNeedsJob'),
        },
      ],
      [
        { commessa: job.id, rapportino: { ...whole, from: iso(1), to: iso(4) } },
        { rapportino: it('errors.templateData.workReportPeriod') },
      ],
      [
        { commessa: job.id, rapportino: { ...whole, prices: 'yes' } },
        { rapportino: it('errors.templateData.invalid') },
      ],
      [
        // New input says whether the other costs follow; only a report issued before #192 may not
        { commessa: job.id, rapportino: { from: '', to: '', prices: false, notes: false } },
        { rapportino: it('errors.templateData.invalid') },
      ],
      [{ commessa: job.id }, { rapportino: it('errors.templateData.required') }],
    ]
    for (const [values, errors] of cases) {
      const response = await issue({ client, office }, template, customer.id, values)
      response.assertStatus(422)
      assert.deepEqual(response.body().errors, errors, JSON.stringify(values))
    }
    assert.lengthOf(await IssuedDocument.all(), 0)
  })

  test('the Job page offers the work report and lists the Job documents', async ({
    client,
    assert,
  }) => {
    const { office, customer, job, template } = await longJob()
    await issue({ client, office }, template, customer.id, { commessa: job.id, rapportino: whole })

    const page = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)

    page.assertStatus(200)
    assert.deepEqual(page.inertiaProps.workReportTemplates, [
      { id: template.id, name: 'Rapportino di lavoro' },
    ])
    const documents = page.inertiaProps.issuedDocuments as { number: string; title: string }[]
    assert.deepEqual(
      documents.map(({ number, title }) => ({ number, title })),
      [{ number: `${DateTime.now().year}/0001`, title: 'Rapportino di lavoro' }]
    )

    // An archived template offers nothing
    template.archivedAt = DateTime.now()
    await template.save()
    const archived = await client.get(`/jobs/${job.id}`).withInertia().loginAs(office)
    assert.deepEqual(archived.inertiaProps.workReportTemplates, [])
  })

  test("issuing from the Job starts with the Job chosen, only the Customer's own", async ({
    client,
    assert,
  }) => {
    const { office, customer, job, template } = await longJob()
    const other = await createJob(await createCustomer({ name: 'Altro' }))
    const open = (jobId: number) =>
      client
        .get('/issued-documents/create')
        .qs({ templateId: template.id, customerId: customer.id, jobId })
        .withInertia()
        .loginAs(office)

    const page = await open(job.id)
    page.assertStatus(200)
    assert.deepEqual(page.inertiaProps.prefill, {
      commessa: { id: job.id, label: `${job.number} – Rifacimento impianto` },
    })
    const elsewhere = await open(other.id)
    assert.deepEqual(elsewhere.inertiaProps.prefill, {})
  })

  test('a replacement starts from the original options', async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()
    const options = { from: iso(4), to: '', prices: true, notes: false, jobCharges: false }
    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: options,
    })

    const page = await client
      .get(`/issued-documents/${response.body().id}/replace`)
      .withInertia()
      .loginAs(office)

    page.assertStatus(200)
    assert.deepEqual(page.inertiaProps.prefill.rapportino, { ...options, to: null })
  })

  test("Technicians don't see work reports, which can print prices, from a Visit", async ({
    client,
    assert,
  }) => {
    const { office, anna, customer, job } = await longJob()
    const site = await createSite({ label: 'Centrale termica' })
    await customer.related('sites').attach([site.id])
    await job.merge({ siteId: site.id }).save()
    // A work report also chosen for the Site, so it is the Site's document
    const template = await DocumentTemplates.create({
      name: 'Rapportino per immobile',
      fields: [
        { key: 'site', label: 'Immobile', type: 'site', required: true },
        { key: 'job', label: 'Commessa', type: 'job', required: true },
        { key: 'report', label: 'Rapportino', type: 'work_report', required: true },
      ],
      body: {
        type: 'doc',
        content: [{ type: 'fieldTable', attrs: { key: 'report', label: 'Rapportino' } }],
      } as TemplateNode,
    })
    const response = await issue({ client, office }, template, customer.id, {
      site: site.id,
      job: job.id,
      report: { ...whole, prices: true },
    })
    response.assertStatus(200)
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.equal(document.siteId, site.id)
    const visit = await visitOn(job, [anna], 0, 'planned')

    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    page.assertStatus(200)
    assert.deepEqual(page.inertiaProps.issuedDocuments, [])
    const pdf = await client
      .get(`/my-visits/${visit.id}/issued-documents/${document.id}`)
      .loginAs(anna)
    pdf.assertStatus(404)
  })

  test('a template needs a Job field for its work report', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/document-templates')
      .json({
        name: 'Rapportino senza commessa',
        fields: [{ key: 'report', label: 'Rapportino', type: 'work_report', required: true }],
        body: {
          type: 'doc',
          content: [{ type: 'fieldTable', attrs: { key: 'report', label: 'Rapportino' } }],
        },
      })
      .header('referer', '/settings/document-templates/new')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertFlashMessage('inputErrorsBag', {
      'fields.0.type': [it('validator.shared.messages.templateFields.workReportNeedsJob')],
    })
    assert.lengthOf(await addedTemplates(), 0)
  })
})

/**
 * The long Job's own Charges besides its call-out (Office's, done today,
 * 30): 2 valves from the Quote, confirmed used six days ago; a disposal
 * Office won't bill, today; and, not reported, 2 hours from the Quote still
 * planned and a valve not used after all.
 */
async function jobCharges(job: Job, office: User) {
  const valve = await createItem({ description: 'Valvola', unit: 'pz', resalePrice: '7.5' })
  const plumber = await LabourRate.findByOrFail('name', 'Idraulico')
  const onJob = (attributes: Partial<Charge>) =>
    Charge.create({
      jobId: job.id,
      description: 'Da preventivo',
      billQuantity: attributes.quantity,
      ...attributes,
    })
  const valves = await onJob({ kind: 'item', itemId: valve.id, quantity: '2', unitPrice: '7.5' })
  await ChargeEvent.create({
    chargeId: valves.id,
    kind: 'done',
    createdAt: daysAgo(6).set({ hour: 12 }),
  })
  const disposal = await Charges.add(
    job,
    { description: 'Smaltimento', quantity: '1', unitPrice: '20', unit: null, vatKind: 'labour' },
    office
  )
  await Charges.setBillable(disposal, false, office)
  await onJob({
    kind: 'labour',
    labourRateId: plumber.id,
    workerName: 'Ditta Rossi',
    quantity: '2',
    unitPrice: '40',
  })
  const unused = await markDone(
    await onJob({ kind: 'item', itemId: valve.id, quantity: '1', unitPrice: '7.5' })
  )
  await ChargeEvent.create({ chargeId: unused.id, kind: 'not_done' })
}

test.group("Work report: the Job's other costs (#192)", (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  const days = [
    [shown(10), 'Anna Neri, Bruno Blu, Carlo Ditta', 'Idraulico', '3 h'],
    ['', '', 'Valvola', '3 pz'],
    ['', '', 'Elettricista', '1 h'],
    [shown(3), 'Anna Neri', 'Idraulico', '1 h'],
  ]

  test('with prices: its done Charges on no Visit after the days, in the total', async ({
    client,
    assert,
  }) => {
    const { office, customer, job, template } = await longJob()
    await jobCharges(job, office)

    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { ...whole, prices: true, jobCharges: true },
    })

    response.assertStatus(200)
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.deepEqual(document.tables.rapportino.rows.slice(4), [
      ['', '', it('documents.workReport.jobCharges'), '', '', ''],
      ['', '', 'Uscita', '1', formatMoney('30'), formatMoney('30')],
      ['', '', 'Valvola', '2 pz', formatMoney('7.5'), formatMoney('15')],
      ['', '', 'Smaltimento', '1', formatMoney('20'), it('documents.workReport.notBilled')],
      // The days' 192.5 and the Job's 45
      ['', '', it('documents.workReport.total'), '', '', formatMoney('237.5')],
    ])
  })

  test('without prices: the quantities recorded, no total', async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()
    await jobCharges(job, office)

    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { ...whole, jobCharges: true },
    })

    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.deepEqual(document.tables.rapportino.rows, [
      ...days,
      ['', '', it('documents.workReport.jobCharges'), ''],
      ['', '', 'Uscita', '1'],
      ['', '', 'Valvola', '2 pz'],
      ['', '', 'Smaltimento', '1'],
    ])
  })

  test('left out: only the days, and the total reads as theirs', async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()
    await jobCharges(job, office)

    const response = await issue({ client, office }, template, customer.id, {
      commessa: job.id,
      rapportino: { ...whole, prices: true, jobCharges: false },
    })

    const document = await IssuedDocument.findOrFail(response.body().id)
    const rows = document.tables.rapportino.rows
    assert.deepEqual(
      rows.slice(0, -1).map((row: string[]) => row.slice(0, 4)),
      days
    )
    assert.deepEqual(rows.at(-1), [
      '',
      '',
      it('documents.workReport.visitsTotal'),
      '',
      '',
      formatMoney('192.5'),
    ])
  })

  test('a period takes the Job Charges that became done in it', async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()
    await jobCharges(job, office)
    const report = async (from: string, to: string) => {
      const response = await issue({ client, office }, template, customer.id, {
        commessa: job.id,
        rapportino: { ...whole, from, to, jobCharges: true },
      })
      const document = await IssuedDocument.findOrFail(response.body().id)
      return document.tables.rapportino.rows
    }

    // The valves, confirmed used six days ago, with the day three days ago
    assert.deepEqual(await report(iso(7), iso(1)), [
      [shown(3), 'Anna Neri', 'Idraulico', '1 h'],
      ['', '', it('documents.workReport.jobCharges'), ''],
      ['', '', 'Valvola', '2 pz'],
    ])
    // Today's call-out and disposal, on no day
    assert.deepEqual(await report(iso(0), ''), [
      ['', '', it('documents.workReport.jobCharges'), ''],
      ['', '', 'Uscita', '1'],
      ['', '', 'Smaltimento', '1'],
    ])
  })

  test('a Job Charge is dated by its latest "done", on the day it was in Rome', async ({
    assert,
  }) => {
    const job = await createJob(await createCustomer())
    const onJob = (description: string) =>
      Charge.create({
        jobId: job.id,
        kind: 'other',
        vatKind: 'labour',
        description,
        quantity: '1',
        billQuantity: '1',
        unitPrice: '10',
      })
    const at = (moment: string) => DateTime.fromISO(moment, { zone: 'utc' })
    // Done on the 2nd, not done on the 3rd, done again on the 5th
    const redone = await onJob('Rifatto')
    for (const [kind, when] of [
      ['done', '2026-10-02T10:00'],
      ['not_done', '2026-10-03T10:00'],
      ['done', '2026-10-05T10:00'],
    ] as const) {
      await ChargeEvent.create({ chargeId: redone.id, kind, createdAt: at(when) })
    }
    // 23:30 UTC on the 6th is 00:30 on the 7th in Rome
    const lateNight = await onJob('Notturno')
    await ChargeEvent.create({
      chargeId: lateNight.id,
      kind: 'done',
      createdAt: at('2026-10-06T23:30'),
    })
    const reported = async (from: string, to: string) => {
      const charges = await WorkReports.jobCharges(job, { from, to })
      return charges.map((charge) => charge.description)
    }

    assert.deepEqual(await reported('2026-10-01', '2026-10-04'), [])
    assert.deepEqual(await reported('2026-10-05', '2026-10-05'), ['Rifatto'])
    assert.deepEqual(await reported('2026-10-06', '2026-10-06'), [])
    assert.deepEqual(await reported('2026-10-07', '2026-10-07'), ['Notturno'])
  })

  test("a replacement keeps the original's choice", async ({ client, assert }) => {
    const { office, customer, job, template } = await longJob()
    const replacing = async (rapportino: Record<string, unknown>) => {
      const response = await issue({ client, office }, template, customer.id, {
        commessa: job.id,
        rapportino,
      })
      const page = await client
        .get(`/issued-documents/${response.body().id}/replace`)
        .withInertia()
        .loginAs(office)
      return page.inertiaProps.prefill.rapportino
    }

    const options = { from: null, to: null, prices: true, notes: false }
    assert.deepEqual(await replacing({ ...options, jobCharges: true }), {
      ...options,
      jobCharges: true,
    })
    assert.deepEqual(await replacing({ ...options, jobCharges: false }), {
      ...options,
      jobCharges: false,
    })
  })
})
