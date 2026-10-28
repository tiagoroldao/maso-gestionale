import { test } from '@japa/runner'
import Quote from '#models/quote'
import LabourRate from '#models/labour_rate'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'

test.group('Quotes in the browser', () => {
  test('Office writes a Quote from Items and labour, then it is accepted', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { kind: 'quoted' })
    await createItem({ code: 'CALD-25', description: 'Caldaia 25 kW', resalePrice: '1200' })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })

    const page = await visit(`/jobs/${job.id}/quote`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByLabel(it('ui.quotes.addItem')).fill('cald')
    await page.getByRole('option', { name: /CALD-25/ }).click()
    await page.getByLabel(it('ui.quotes.addLabour')).selectOption(String(rate.id))
    await page.getByRole('button', { name: it('ui.quotes.addLabourButton') }).click()
    await page.getByLabel(it('ui.quotes.quantityOf', { position: 2 })).fill('2,5')

    // 1200 + 2.5 × 40 = 1300
    await page.getByRole('cell', { name: '1.300,00 €', exact: true }).waitFor()
    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByRole('button', { name: it('ui.quotes.accept') }).click()

    await page.waitForURL(`**/jobs/${job.id}`)
    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(quote.status, 'accepted')
    assert.equal(quote.taxable, '1300.00')
  })

  test('Accept waits until the edits are saved', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { kind: 'quoted' })
    await createItem({ code: 'VAL-1', description: 'Valvola', resalePrice: '10' })

    const page = await visit(`/jobs/${job.id}/quote`)
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByLabel(it('ui.quotes.addItem')).fill('val')
    await page.getByRole('option', { name: /VAL-1/ }).click()
    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByRole('button', { name: it('ui.quotes.accept') }).waitFor()

    // Change the price without saving: deciding is blocked
    await page.getByLabel(it('ui.quotes.unitPriceOf', { position: 1 })).fill('8')
    assert.isTrue(await page.getByRole('button', { name: it('ui.quotes.accept') }).isDisabled())
    assert.isTrue(await page.getByRole('button', { name: it('ui.quotes.decline') }).isDisabled())

    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByText(it('ui.quotes.unsaved')).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: it('ui.quotes.accept') }).click()
    await page.waitForURL(`**/jobs/${job.id}`)

    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(quote.status, 'accepted')
    assert.equal(quote.lines[0].unitPrice, '8.0000')
  })
})
