import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Invoice from '#models/invoice'
import InvoiceLine from '#models/invoice_line'
import InvoiceSection from '#models/invoice_section'
import LabourRate from '#models/labour_rate'
import Visit from '#models/visit'
import FieldWork from '#services/field_work'
import Quotes from '#services/quotes'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createJob } from '#tests/helpers/jobs'
import { createItem, vatCode } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { it } from '#tests/helpers/i18n'

test.group('Invoices from Jobs in the browser', () => {
  test('from an accepted Quote, through its imported lines, to an Invoice and its XML', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await completeCompany()
    const standard = await vatCode()
    const job = await createJob(await createCustomer())
    const quote = await Quotes.create(job, {
      lines: [
        {
          kind: 'call_out',
          description: 'Sopralluogo',
          quantity: '1',
          unitPrice: '50',
          vatCodeId: standard.id,
        },
      ],
    })
    await Quotes.accept(quote)

    // The Quote isn't billed: its line becomes a Charge on the Job first
    const page = await visit(`/quotes/${quote.id}`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: it('ui.quotes.import', { count: 1 }) }).click()
    await page.waitForURL(new RegExp(`/jobs/${job.id}$`))
    // Planned until Office confirms it happened (ADR 0016)
    await page.getByRole('button', { name: it('ui.charges.confirmUsed') }).click()
    await page.getByText(it('flash.chargeWork.done')).waitFor()
    // The header's primary action opens the draft's options
    await page.getByRole('button', { name: it('ui.invoices.fromCharges') }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: it('ui.invoices.fromCharges') })
      .click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)
    await page.getByRole('button', { name: it('ui.invoices.finalise') }).click()
    await page.getByRole('button', { name: it('ui.invoices.prepareSubmission') }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: /\.xml/ }).click()
    const file = await download

    assert.match(file.suggestedFilename(), /^IT\d+_M[0-9A-Z]{4}\.xml$/)
    const invoice = await Invoice.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(invoice.status, 'finalised')
    assert.equal(invoice.totals.taxable, '50.00')
  })

  test('a combined draft, with its consumables folded into one line', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna' })
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const valve = await createItem({ description: 'Valvola', resalePrice: '7.5' })
    const pipe = await createItem({ description: 'Tubo', resalePrice: '3' })
    for (const day of ['2026-10-05', '2026-10-12']) {
      const start = DateTime.fromISO(`${day}T09:00`)
      const onDay = await Visit.create({
        jobId: job.id,
        startsAt: start,
        endsAt: start.plus({ hours: 2 }),
        status: 'planned',
      })
      await onDay.related('technicians').attach([anna.id])
      await FieldWork.recordHours(onDay, {
        technicianId: anna.id,
        labourRateId: rate.id,
        hours: '2',
      })
      await FieldWork.recordItem(onDay, { itemId: valve.id, quantity: '2' })
      await FieldWork.recordItem(onDay, { itemId: pipe.id, quantity: '1' })
      await FieldWork.setStatus(onDay, 'done', anna)
    }

    // Combining is ticked by default
    const page = await visit(`/jobs/${job.id}`)
    await page.getByRole('button', { name: it('ui.invoices.fromCharges') }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: it('ui.invoices.fromCharges') })
      .click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)
    await page.getByRole('button', { name: it('ui.invoices.foldConsumables') }).click()
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await page.getByText(it('flash.invoiceSaved')).waitFor()

    const invoice = await Invoice.query().where('jobId', job.id).firstOrFail()
    const lines = await InvoiceLine.query()
      .where('invoiceId', invoice.id)
      .preload('charges')
      .orderBy('position')
    assert.deepEqual(
      lines.map((line) => [line.description, line.quantity, line.lineTotal, line.charges.length]),
      [
        [
          it('documents.invoice.combinedLine', {
            name: 'Idraulico',
            visits: 2,
            from: '05/10',
            to: '12/10',
          }),
          '4.000',
          '160.00',
          2,
        ],
        [it('documents.invoice.consumablesLine'), '1.000', '36.00', 4],
      ]
    )
  })

  test('sections: organised by Visit, a line moved and dragged, a section added, then by kind', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const anna = await createUser('technician', { fullName: 'Anna' })
    const job = await createJob(await createCustomer(), { status: 'in_progress' })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const valve = await createItem({ description: 'Valvola', resalePrice: '7.5' })
    for (const day of ['2026-10-05', '2026-10-12']) {
      const start = DateTime.fromISO(`${day}T09:00`)
      const onDay = await Visit.create({
        jobId: job.id,
        startsAt: start,
        endsAt: start.plus({ hours: 2 }),
        status: 'planned',
      })
      await onDay.related('technicians').attach([anna.id])
      await FieldWork.recordHours(onDay, {
        technicianId: anna.id,
        labourRateId: rate.id,
        hours: '2',
      })
      await FieldWork.recordItem(onDay, { itemId: valve.id, quantity: '2' })
      await FieldWork.setStatus(onDay, 'done', anna)
    }
    const layout = async () => {
      const invoice = await Invoice.query().where('jobId', job.id).firstOrFail()
      const sections = await InvoiceSection.query()
        .where('invoiceId', invoice.id)
        .orderBy('position')
      const lines = await InvoiceLine.query().where('invoiceId', invoice.id).orderBy('position')
      return [
        ...lines.filter((line) => line.sectionId === null).map((line) => [null, line.description]),
        ...sections.flatMap((section) =>
          lines
            .filter((line) => line.sectionId === section.id)
            .map((line) => [section.title, line.description])
        ),
      ]
    }

    const page = await visit(`/jobs/${job.id}`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: it('ui.invoices.fromCharges') }).click()
    await page.getByLabel(it('ui.invoices.organiseBy')).selectOption('visit')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: it('ui.invoices.fromCharges') })
      .click()
    await page.waitForURL(/\/invoices\/\d+\/edit$/)

    // A new section; the last line moves down into it with the arrow
    await page.getByRole('button', { name: it('ui.invoices.addSection') }).click()
    await page.getByLabel(it('ui.invoices.sectionTitleOf', { position: 3 })).fill('Materiale extra')
    await page
      .getByRole('button', { name: it('ui.invoices.moveDown') })
      .last()
      .click()
    // The first line is dragged outside the sections
    await page
      .locator('td.table__actions [draggable="true"]')
      .first()
      .dragTo(page.getByTestId('outside-sections'))
    await page.getByRole('button', { name: it('ui.invoices.save') }).click()
    await page.getByText(it('flash.invoiceSaved')).waitFor()
    assert.deepEqual(await layout(), [
      [null, 'Idraulico – Anna (05/10)'],
      ['Intervento del 05/10', 'Valvola (05/10)'],
      ['Intervento del 12/10', 'Idraulico – Anna (12/10)'],
      ['Materiale extra', 'Valvola (12/10)'],
    ])

    // Organised again by kind, after confirming
    await page.getByLabel(it('ui.invoices.organiseBy')).selectOption('kind')
    await page.getByRole('button', { name: it('ui.invoices.organise') }).click()
    await page.getByText(it('flash.invoiceOrganised')).waitFor()
    assert.deepEqual(await layout(), [
      [
        'Manodopera',
        it('documents.invoice.combinedLine', {
          name: 'Idraulico',
          visits: 2,
          from: '05/10',
          to: '12/10',
        }),
      ],
      [
        'Materiali',
        it('documents.invoice.combinedLine', {
          name: 'Valvola',
          visits: 2,
          from: '05/10',
          to: '12/10',
        }),
      ],
    ])
  })
})
