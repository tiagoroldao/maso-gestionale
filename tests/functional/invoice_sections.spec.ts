import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import i18nManager from '@adonisjs/i18n/services/main'
import Charge from '#models/charge'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import InvoiceSection from '#models/invoice_section'
import type Job from '#models/job'
import LabourRate from '#models/labour_rate'
import type User from '#models/user'
import Visit from '#models/visit'
import Charges from '#services/charges'
import FieldWork from '#services/field_work'
import Invoices from '#services/invoices'
import Submissions from '#services/submissions'
import DocumentRenderer from '#documents/document_renderer'
import { invoiceDocument } from '#documents/invoice_document'
import type { PdfConverter } from '#documents/pdf_converter'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createCategory, createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { completeCompany } from '#tests/helpers/company'
import { stateOf } from '#tests/helpers/charges'
import { latin1 } from '#fiscal/fattura_pa'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const noConverter: PdfConverter = {
  async convert() {
    throw new Error('not used')
  },
}

/**
 * A Job with two closed Visits and a call-out on the Job itself. On
 * 05/10 Anna works 2 hours and Bruno 1, 3 valves (category Raccorderia)
 * and 2 m of pipe (no category) are used, and a boiler (Equipment,
 * category Caldaie) is installed, serial AB123. On 12/10 Anna works 2
 * hours and 2 valves are used.
 */
async function workedJob() {
  await completeCompany()
  const office = await createUser('office')
  const anna = await createUser('technician', { fullName: 'Anna' })
  const bruno = await createUser('technician', { fullName: 'Bruno' })
  const site = await createSite()
  const job = await createJob(await createCustomer(), {
    status: 'in_progress',
    siteId: site.id,
    workCategory: 'sale',
  })
  const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
  const fittings = await createCategory({ name: 'Raccorderia' })
  const boilers = await createCategory({ name: 'Caldaie' })
  const valve = await createItem({
    description: 'Valvola',
    resalePrice: '7.5',
    categoryId: fittings.id,
  })
  const pipe = await createItem({ description: 'Tubo', resalePrice: '3', unit: 'm' })
  const boiler = await createItem({
    description: 'Caldaia',
    resalePrice: '1200',
    maintenanceIntervalMonths: 12,
    categoryId: boilers.id,
  })
  const visit = async (day: string) => {
    const start = DateTime.fromISO(`${day}T09:00`)
    const created = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 3 }),
      status: 'planned',
    })
    await created.related('technicians').attach([anna.id, bruno.id])
    return created
  }
  const hours = (on: Visit, user: User, amount: string) =>
    FieldWork.recordHours(on, { technicianId: user.id, labourRateId: rate.id, hours: amount })

  const first = await visit('2026-10-05')
  await hours(first, anna, '2')
  await hours(first, bruno, '1')
  await FieldWork.recordItem(first, { itemId: valve.id, quantity: '3' })
  await FieldWork.recordItem(first, { itemId: pipe.id, quantity: '2' })
  await FieldWork.recordItem(first, { itemId: boiler.id, quantity: '1', serialNumber: 'AB123' })
  await FieldWork.setStatus(first, 'done', anna)

  const second = await visit('2026-10-12')
  await hours(second, anna, '2')
  await FieldWork.recordItem(second, { itemId: valve.id, quantity: '2' })
  await FieldWork.setStatus(second, 'done', anna)

  await Charges.add(
    job,
    { description: 'Uscita', quantity: '1', unit: null, unitPrice: '30', vatKind: 'labour' },
    office
  )
  return { office, job }
}

/**
 * The Invoice's lines as printed: each run of lines in position order
 * with its section's title (null outside any), and the lines'
 * descriptions and quantities.
 */
async function layoutOf(invoice: Invoice) {
  const sections = await InvoiceSection.query().where('invoiceId', invoice.id)
  const titles = new Map(sections.map((section) => [section.id, section.title]))
  const lines = await InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
  const runs: [string | null, string[]][] = []
  let current: number | null | undefined
  for (const line of lines) {
    if (!runs.length || line.sectionId !== current) {
      runs.push([line.sectionId ? titles.get(line.sectionId)! : null, []])
      current = line.sectionId
    }
    runs[runs.length - 1][1].push(`${line.description} × ${Number(line.quantity)}`)
  }
  return runs
}

function draft(client: ApiClient, job: Job, office: User, form: Record<string, string> = {}) {
  return client
    .post(`/jobs/${job.id}/invoices`)
    .form(form)
    .withCsrfToken()
    .loginAs(office)
    .redirects(0)
}

async function draftOf(job: Job) {
  return Invoice.query().where('jobId', job.id).where('status', 'draft').firstOrFail()
}

/**
 * The Invoice as the page sends it back: its sections and lines with
 * their places in them.
 */
async function asSent(invoice: Invoice) {
  const sections = await InvoiceSection.query().where('invoiceId', invoice.id).orderBy('position')
  const lines = await InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
  return {
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      showSubtotal: section.showSubtotal,
    })),
    lines: lines.map((line) => ({
      id: line.id,
      ...(line.itemId && { itemId: line.itemId }),
      description: line.description,
      ...(line.unit && { unit: line.unit }),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatCodeId: line.vatCodeId,
      ...(line.sectionId && {
        section: sections.findIndex((section) => section.id === line.sectionId),
      }),
    })),
  }
}

async function issue(invoice: Invoice, outcome: 'delivered' | 'rejected') {
  await Invoices.finalise(invoice)
  await Submissions.prepare(invoice)
  await Submissions.confirm(invoice, 'Sconto')
  await Submissions.recordOutcome(invoice, { outcome })
}

/**
 * A second Visit on 05/10, in the afternoon: Carla works 1 hour.
 */
async function afternoonVisit(job: Job, at = '2026-10-05T14:00') {
  const carla = await createUser('technician', { fullName: 'Carla' })
  const rate = await LabourRate.findByOrFail('name', 'Idraulico')
  const start = DateTime.fromISO(at)
  const afternoon = await Visit.create({
    jobId: job.id,
    startsAt: start,
    endsAt: start.plus({ hours: 2 }),
    status: 'planned',
  })
  await afternoon.related('technicians').attach([carla.id])
  await FieldWork.recordHours(afternoon, {
    technicianId: carla.id,
    labourRateId: rate.id,
    hours: '1',
  })
  await FieldWork.setStatus(afternoon, 'done', carla)
}

/**
 * The positions of the Invoice's lines, in order.
 */
async function positionsOf(invoice: Invoice) {
  const lines = await InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
  return lines.map((line) => line.position)
}

const combined = (name: string, visits: number, from: string, to: string) =>
  it('documents.invoice.combinedLine', { name, visits, from, to })

test.group('Invoice sections: organising a draft from a Job', () => {
  test('by kind by default, alike Charges combined within each section', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    const response = await draft(client, job, office)
    response.assertFlashMessage('success', it('flash.invoiceCreated'))

    const invoice = await draftOf(job)
    assert.deepEqual(await layoutOf(invoice), [
      ['Manodopera', [`${combined('Idraulico', 2, '05/10', '12/10')} × 5`]],
      ['Materiali', [`${combined('Valvola', 2, '05/10', '12/10')} × 5`, 'Tubo (05/10) × 2']],
      ['Apparecchi', ['Caldaia (05/10) — matr. AB123 × 1']],
      ['Altro', ['Uscita × 1']],
    ])
    const sections = await InvoiceSection.query().where('invoiceId', invoice.id)
    assert.isTrue(sections.every((section) => section.showSubtotal))
  })

  test('by Visit: a section per Visit, then "Commessa"; hours combine within each day only', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office, { organiseBy: 'visit', combine: 'true' })

    assert.deepEqual(await layoutOf(await draftOf(job)), [
      [
        'Intervento del 05/10',
        [
          'Idraulico (05/10) × 3',
          'Valvola (05/10) × 3',
          'Tubo (05/10) × 2',
          'Caldaia (05/10) — matr. AB123 × 1',
        ],
      ],
      ['Intervento del 12/10', ['Idraulico – Anna (12/10) × 2', 'Valvola (12/10) × 2']],
      ['Commessa', ['Uscita × 1']],
    ])
  })

  test('two Visits on one day: a section each, titled with their start times, drafting and organising again', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await afternoonVisit(job)
    const expected = [
      [
        'Intervento del 05/10 (09:00)',
        [
          'Idraulico (05/10) × 3',
          'Valvola (05/10) × 3',
          'Tubo (05/10) × 2',
          'Caldaia (05/10) — matr. AB123 × 1',
        ],
      ],
      ['Intervento del 05/10 (14:00)', ['Idraulico – Carla (05/10) × 1']],
      ['Intervento del 12/10', ['Idraulico – Anna (12/10) × 2', 'Valvola (12/10) × 2']],
      ['Commessa', ['Uscita × 1']],
    ]

    await draft(client, job, office, { organiseBy: 'visit', combine: 'true' })
    const invoice = await draftOf(job)
    assert.deepEqual(await layoutOf(invoice), expected)
    assert.deepEqual(await positionsOf(invoice), [0, 1, 2, 3, 4, 5, 6, 7])
    assert.lengthOf(await InvoiceSection.query().where('invoiceId', invoice.id), 4)

    // Organised again, from no sections
    for (const organiseBy of ['none', 'visit']) {
      await client
        .post(`/invoices/${invoice.id}/organise`)
        .form({ organiseBy, combine: 'true' })
        .withCsrfToken()
        .loginAs(office)
    }
    assert.deepEqual(await layoutOf(invoice), expected)
    assert.deepEqual(await positionsOf(invoice), [0, 1, 2, 3, 4, 5, 6, 7])
    assert.lengthOf(await InvoiceSection.query().where('invoiceId', invoice.id), 4)
  })

  test('two Visits starting at the same minute are told apart by their Technicians', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await afternoonVisit(job, '2026-10-05T09:00')

    await draft(client, job, office, { organiseBy: 'visit', combine: 'true' })
    const layout = await layoutOf(await draftOf(job))
    const titles = layout.map(([title]) => title)
    assert.sameMembers(titles, [
      'Intervento del 05/10 (09:00, Anna, Bruno)',
      'Intervento del 05/10 (09:00, Carla)',
      'Intervento del 12/10',
      'Commessa',
    ])
  })

  test("a never-started Visit planned ahead takes today's date and a time already past", async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    const today = DateTime.now().startOf('day')
    const rate = await LabourRate.findByOrFail('name', 'Idraulico')
    const dario = await createUser('technician', { fullName: 'Dario' })
    // Closed without being started: one planned at midnight today, and one
    // moved to tomorrow after closing (#154 now refuses closing it early)
    for (const ahead of [false, true]) {
      const visit = await Visit.create({
        jobId: job.id,
        startsAt: today,
        endsAt: today.plus({ hours: 1 }),
        status: 'planned',
      })
      await visit.related('technicians').attach([dario.id])
      await FieldWork.recordHours(visit, {
        technicianId: dario.id,
        labourRateId: rate.id,
        hours: '1',
      })
      await FieldWork.setStatus(visit, 'done', dario)
      const startsAt = ahead ? today.plus({ days: 1, hours: 9 }) : today
      await Visit.query()
        .where('id', visit.id)
        .update({
          startedAt: null,
          startsAt: startsAt.toSQL(),
          endsAt: startsAt.plus({ hours: 1 }).toSQL(),
        })
    }

    await draft(client, job, office, { organiseBy: 'visit', combine: 'true' })
    const now = DateTime.now().toFormat('HH:mm')
    const date = today.toFormat('dd/MM')
    const layout = await layoutOf(await draftOf(job))
    const titles = layout.map(([title]) => title!).filter((title) => title.includes(date))
    assert.lengthOf(titles, 2)
    assert.include(titles, `Intervento del ${date} (00:00)`)
    const ahead = titles.find((title) => title !== `Intervento del ${date} (00:00)`)!
    const time = /\((\d\d:\d\d)\)$/.exec(ahead)![1]
    assert.notEqual(time, '09:00')
    assert.isAtMost(time.localeCompare(now), 0)
  })

  test('by Item category: Manodopera, the categories by name, then Altro', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office, { organiseBy: 'category', combine: 'true' })

    assert.deepEqual(await layoutOf(await draftOf(job)), [
      ['Manodopera', [`${combined('Idraulico', 2, '05/10', '12/10')} × 5`]],
      ['Caldaie', ['Caldaia (05/10) — matr. AB123 × 1']],
      ['Raccorderia', [`${combined('Valvola', 2, '05/10', '12/10')} × 5`]],
      ['Altro', ['Tubo (05/10) × 2', 'Uscita × 1']],
    ])
  })

  test('not organised: no sections, as before', async ({ client, assert }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office, { organiseBy: 'none', combine: 'true' })

    const invoice = await draftOf(job)
    assert.lengthOf(await InvoiceSection.query().where('invoiceId', invoice.id), 0)
    assert.deepEqual(await layoutOf(invoice), [
      [
        null,
        [
          `${combined('Idraulico', 2, '05/10', '12/10')} × 5`,
          `${combined('Valvola', 2, '05/10', '12/10')} × 5`,
          'Tubo (05/10) × 2',
          'Caldaia (05/10) — matr. AB123 × 1',
          'Uscita × 1',
        ],
      ],
    ])
  })

  test('an unknown way to organise is refused', async ({ client, assert }) => {
    const { office, job } = await workedJob()
    const response = await draft(client, job, office, { organiseBy: 'technician' })
    assert.deepEqual(response.flashMessage('inputErrorsBag'), {
      organiseBy: [it('validator.shared.messages.enum', { field: 'organizza per' })],
    })
    assert.lengthOf(await Invoice.query().where('jobId', job.id), 0)
  })

  test('organising again replaces the sections; hand lines go into "Altro", Charges stay held', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office, { organiseBy: 'none', combine: 'true' })
    const invoice = await draftOf(job)
    const sent = await asSent(invoice)
    await client
      .put(`/invoices/${invoice.id}`)
      .json({
        lines: [
          {
            description: 'Smaltimento',
            quantity: '1',
            unitPrice: '25',
            vatCodeId: sent.lines[0].vatCodeId,
          },
          ...sent.lines,
        ],
      })
      .withCsrfToken()
      .loginAs(office)
    const held = await Charge.query().where('jobId', job.id)

    const response = await client
      .post(`/invoices/${invoice.id}/organise`)
      .form({ organiseBy: 'kind', combine: 'false' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertHeader('location', `/invoices/${invoice.id}/edit`)
    response.assertFlashMessage('success', it('flash.invoiceOrganised'))

    assert.deepEqual(await layoutOf(invoice), [
      [
        'Manodopera',
        [
          'Idraulico – Anna (05/10) × 2',
          'Idraulico – Bruno (05/10) × 1',
          'Idraulico – Anna (12/10) × 2',
        ],
      ],
      ['Materiali', ['Valvola (05/10) × 3', 'Tubo (05/10) × 2', 'Valvola (12/10) × 2']],
      ['Apparecchi', ['Caldaia (05/10) — matr. AB123 × 1']],
      ['Altro', ['Uscita × 1', 'Smaltimento × 1']],
    ])
    for (const charge of held) assert.equal(await stateOf(charge), 'in_draft')

    // Not organised: the sections go, the hand line stays, last
    await client
      .post(`/invoices/${invoice.id}/organise`)
      .form({ organiseBy: 'none', combine: 'true' })
      .withCsrfToken()
      .loginAs(office)
    const layout = await layoutOf(invoice)
    assert.lengthOf(layout, 1)
    assert.equal(layout[0][0], null)
    assert.equal(layout[0][1].at(-1), 'Smaltimento × 1')
    assert.lengthOf(await InvoiceSection.query().where('invoiceId', invoice.id), 0)
  })
})

test.group('Invoice sections: editing', () => {
  test('Office renames, reorders and removes sections and moves lines; lines are numbered in section order', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const { sections, lines } = await asSent(invoice)
    const [labour, materials, equipment, other] = sections
    const [hours, valves, pipe, boiler, callOut] = lines

    const response = await client
      .put(`/invoices/${invoice.id}`)
      .json({
        // Materials removed; Altro renamed, first and without subtotal; a new one
        sections: [
          { ...other, title: 'Uscite', showSubtotal: false },
          equipment,
          { title: 'Lavori', showSubtotal: true },
          labour,
        ],
        // Sent in any order; the pipe outside any section, the valves in "Lavori"
        lines: [
          { ...hours, section: 3 },
          { ...valves, section: 2 },
          { ...pipe, section: undefined },
          { ...boiler, section: 1 },
          { ...callOut, section: 0 },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.invoiceSaved'))

    assert.deepEqual(await layoutOf(invoice), [
      [null, ['Tubo (05/10) × 2']],
      ['Uscite', ['Uscita × 1']],
      ['Apparecchi', ['Caldaia (05/10) — matr. AB123 × 1']],
      ['Lavori', [`${combined('Valvola', 2, '05/10', '12/10')} × 5`]],
      ['Manodopera', [`${combined('Idraulico', 2, '05/10', '12/10')} × 5`]],
    ])
    const stored = await InvoiceSection.query().where('invoiceId', invoice.id).orderBy('position')
    assert.deepEqual(
      stored.map((section) => [section.title, section.showSubtotal]),
      [
        ['Uscite', false],
        ['Apparecchi', true],
        ['Lavori', true],
        ['Manodopera', true],
      ]
    )
    // Kept sections keep their identity; the removed one is gone
    assert.deepEqual(
      [stored[0].id, stored[1].id, stored[3].id],
      [other.id, equipment.id, labour.id]
    )
    assert.isNull(await InvoiceSection.find(materials.id))
  })

  test('a section needs a title', async ({ client, assert }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const { sections, lines } = await asSent(invoice)

    const response = await client
      .put(`/invoices/${invoice.id}`)
      .json({ sections: [{ ...sections[0], title: '  ' }, ...sections.slice(1)], lines })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    const errors = response.flashMessage('inputErrorsBag') as Record<string, unknown>
    assert.deepEqual(Object.keys(errors), ['sections.0.title'])
    const stored = await InvoiceSection.findOrFail(sections[0].id)
    assert.equal(stored.title, 'Manodopera')
  })

  test('frozen once finalised: saving and organising are refused, sections unchanged', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const sent = await asSent(invoice)
    await Invoices.finalise(invoice)
    const before = await layoutOf(invoice)

    const saved = await client
      .put(`/invoices/${invoice.id}`)
      .json({ ...sent, sections: [{ ...sent.sections[0], title: 'Altro titolo' }] })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    saved.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    const organised = await client
      .post(`/invoices/${invoice.id}/organise`)
      .form({ organiseBy: 'visit', combine: 'true' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    organised.assertFlashMessage('error', it('flash.invoiceNotEditable'))

    assert.deepEqual(await layoutOf(invoice), before)
    const titles = await InvoiceSection.query().where('invoiceId', invoice.id).orderBy('position')
    assert.equal(titles[0].title, 'Manodopera')
  })

  test('only Office and the Admin organise; others are refused, the draft unchanged', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const before = await layoutOf(invoice)

    for (const role of ['technician', 'superuser'] as const) {
      const response = await client
        .post(`/invoices/${invoice.id}/organise`)
        .form({ organiseBy: 'visit', combine: 'true' })
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(await createUser(role))
        .redirects(0)
      response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }
    assert.deepEqual(await layoutOf(invoice), before)

    await client
      .post(`/invoices/${invoice.id}/organise`)
      .form({ organiseBy: 'none', combine: 'true' })
      .withCsrfToken()
      .loginAs(await createUser('admin'))
    assert.lengthOf(await InvoiceSection.query().where('invoiceId', invoice.id), 0)
  })

  test('a rejected Invoice is corrected, sections included', async ({ client, assert }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const sent = await asSent(invoice)
    await issue(invoice, 'rejected')

    const response = await client
      .put(`/invoices/${invoice.id}`)
      .json({
        sections: [{ ...sent.sections[0], title: 'Ore di lavoro' }, ...sent.sections.slice(1)],
        lines: sent.lines,
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.invoiceSaved'))
    const layout = await layoutOf(invoice)
    assert.equal(layout[0][0], 'Ore di lavoro')

    // Only a draft is organised again
    const organised = await client
      .post(`/invoices/${invoice.id}/organise`)
      .form({ organiseBy: 'none', combine: 'true' })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    organised.assertFlashMessage('error', it('flash.invoiceNotEditable'))
    assert.deepEqual(await layoutOf(invoice), layout)
  })

  test("a Credit Note starts with the credited Invoice's sections, which Office can change", async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    await issue(invoice, 'delivered')

    const note = await Invoices.createCreditNote(invoice)
    const layout = await layoutOf(invoice)
    const noteLayout = await layoutOf(note)
    assert.deepEqual(
      noteLayout.map(([title, lines]) => [title, lines.length]),
      layout.map(([title, lines]) => [title, lines.length])
    )
    const noteSections = await InvoiceSection.query().where('invoiceId', note.id)
    const invoiceSections = await InvoiceSection.query().where('invoiceId', invoice.id)
    assert.notIncludeMembers(
      noteSections.map((section) => section.id),
      invoiceSections.map((section) => section.id)
    )

    // Office keeps one section, for the labour it credits
    const sent = await asSent(note)
    const notes = await InvoiceLine.query().where('invoiceId', note.id).orderBy('position')
    const response = await client
      .put(`/invoices/${note.id}`)
      .json({
        sections: [{ title: 'Storno manodopera', showSubtotal: false }],
        lines: [
          {
            ...sent.lines[0],
            creditsLineId: notes[0].creditsLineId,
            quantity: '1',
            unitPrice: '40',
            section: 0,
          },
        ],
      })
      .withCsrfToken()
      .loginAs(office)
      .redirects(0)
    response.assertFlashMessage('success', it('flash.invoiceSaved'))
    assert.deepEqual(await layoutOf(note), [
      ['Storno manodopera', [`${combined('Idraulico', 2, '05/10', '12/10')} × 1`]],
    ])
    // The Invoice's own are untouched
    assert.deepEqual(await layoutOf(invoice), layout)
  })
})

test.group('Invoice sections on the PDF and the XML', () => {
  test('the PDF prints headings and the subtotals shown; the XML stays flat, in the same order', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const sent = await asSent(invoice)
    // Altro without its subtotal
    await client
      .put(`/invoices/${invoice.id}`)
      .json({
        ...sent,
        sections: sent.sections.map((section) =>
          section.title === 'Altro' ? { ...section, showSubtotal: false } : section
        ),
      })
      .withCsrfToken()
      .loginAs(office)
    await Invoices.finalise(invoice)
    await invoice.refresh()
    await invoice.load('lines', (lines) => lines.orderBy('position'))

    const input = await invoiceDocument(invoice, i18nManager.locale('it'))
    const html = await new DocumentRenderer(noConverter).renderHtml(input)
    const euro = (amount: number) =>
      new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        useGrouping: 'always',
        minimumFractionDigits: 2,
      }).format(amount)
    const headings = ['Manodopera', 'Materiali', 'Apparecchi', 'Altro']
    const at = headings.map((title) => html.indexOf(`<td colspan="6">${title}</td>`))
    assert.isTrue(at.every((index, i) => index > 0 && (i === 0 || index > at[i - 1])))
    // Labour 5 h × 40; valves 5 × 7.5 and pipe 2 × 3; the boiler
    for (const [title, amount] of [
      ['Manodopera', 200],
      ['Materiali', 43.5],
      ['Apparecchi', 1200],
    ] as const) {
      assert.match(
        html,
        new RegExp(
          `${it('documents.invoice.sectionSubtotal', { title })}</td>\\s*<td class="num">${euro(amount)}</td>`
        )
      )
    }
    assert.notInclude(html, it('documents.invoice.sectionSubtotal', { title: 'Altro' }))

    await client.post(`/invoices/${invoice.id}/submissions`).withCsrfToken().loginAs(office)
    const download = await client.get(`/invoices/${invoice.id}/xml`).loginAs(office)
    const xml = download.text()
    const descriptions = [...xml.matchAll(/<Descrizione>([^<]*)<\/Descrizione>/g)].map(
      (match) => match[1]
    )
    assert.deepEqual(
      descriptions,
      invoice.lines.map((line) => latin1(line.description))
    )
    for (const title of headings) assert.notInclude(xml, `>${title}<`)
  })
})

test.group('Invoice sections: the edit page', () => {
  test('the page gets the sections, each line in its own, and whether it can be organised', async ({
    client,
    assert,
  }) => {
    const { office, job } = await workedJob()
    await draft(client, job, office)
    const invoice = await draftOf(job)
    const sections = await InvoiceSection.query().where('invoiceId', invoice.id).orderBy('position')

    const response = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    response.assertStatus(200)
    const props = response.inertiaProps as {
      organisable: boolean
      invoice: {
        sections: { id: number; title: string; showSubtotal: boolean }[]
        lines: { sectionId: number | null }[]
      }
    }
    assert.isTrue(props.organisable)
    assert.deepEqual(
      props.invoice.sections,
      sections.map((section) => ({ id: section.id, title: section.title, showSubtotal: true }))
    )
    assert.deepEqual(
      props.invoice.lines.map((line) => line.sectionId),
      [sections[0].id, sections[1].id, sections[1].id, sections[2].id, sections[3].id]
    )

    // Not once finalised, nor for a draft without a Job
    await Invoices.finalise(invoice)
    const finalised = await client.get(`/invoices/${invoice.id}/edit`).withInertia().loginAs(office)
    assert.isFalse((finalised.inertiaProps as { organisable: boolean }).organisable)
    const direct = await Invoices.create(await createCustomer())
    const page = await client.get(`/invoices/${direct.id}/edit`).withInertia().loginAs(office)
    assert.isFalse((page.inertiaProps as { organisable: boolean }).organisable)
  })
})
