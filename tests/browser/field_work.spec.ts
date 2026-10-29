import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import Visit from '#models/visit'
import LabourRate from '#models/labour_rate'
import StockLedger from '#stock/stock_ledger'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Field work in the browser', () => {
  test('on a phone, a Technician records hours and materials and completes the Visit', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const anna = await createUser('technician', { fullName: 'Anna Tecnico' })
    await browserContext.loginAs(anna)
    const site = await createSite()
    const job = await createJob(await createCustomer({ name: 'Condominio Verdi' }), {
      status: 'in_progress',
      siteId: site.id,
    })
    // Started: a Visit closes only once it has (#154)
    const start = DateTime.now().minus({ minutes: 30 })
    const planned = await Visit.create({
      jobId: job.id,
      startsAt: start,
      endsAt: start.plus({ hours: 2 }),
      status: 'planned',
    })
    await planned.related('technicians').attach([anna.id])
    await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })
    const item = await createItem({ code: 'RAC-12', description: 'Raccordo a T', unit: 'pz' })
    await StockLedger.receive(item, { quantity: '10', occurredOn: DateTime.now() })

    const page = await visit(`/my-visits/${planned.id}`)
    await page.setViewportSize({ width: 390, height: 844 })
    page.on('dialog', (dialog) => dialog.accept())

    await page.getByLabel(it('ui.field.hours'), { exact: true }).fill('1,5')
    await page.getByRole('button', { name: it('ui.field.addHours') }).click()
    await page.getByText('1,5 h', { exact: true }).waitFor()

    await page.getByLabel(it('ui.field.addItem')).fill('rac')
    await page.getByRole('option', { name: /RAC-12/ }).click()
    await page.getByLabel(/Quantità/).fill('3')
    await page.getByRole('button', { name: it('ui.field.addItem') }).click()
    await page.getByText('3 pz', { exact: true }).waitFor()

    // Closing reviews them, all ticked: the hours weren't worked after all
    await page.getByTestId('close-review').getByLabel(/1,5 h/).uncheck()
    await page.getByRole('button', { name: it('ui.visits.statuses.done') }).click()
    await page.getByText(it('ui.field.doneNotice')).waitFor()

    await planned.refresh()
    assert.equal(planned.status, 'done')
    assert.equal(await StockLedger.levelOf(item), '7.000')
    const charges = await Charge.query()
      .where('visitId', planned.id)
      .preload('events', (events) => events.orderBy('id'))
      .orderBy('id')
    assert.deepEqual(
      charges.map((charge) => [charge.kind, charge.workState]),
      [
        ['labour', 'not_done'],
        ['item', 'done'],
      ]
    )
  })
})
