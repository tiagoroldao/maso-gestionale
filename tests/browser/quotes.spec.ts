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
    await page.getByLabel(it('ui.quotes.addItem')).fill('cald')
    await page.getByRole('option', { name: /CALD-25/ }).click()
    await page.getByLabel(it('ui.quotes.addLabour')).selectOption(String(rate.id))
    await page.getByRole('button', { name: it('ui.quotes.addLabourButton') }).click()
    await page.getByLabel(it('ui.quotes.quantityOf', { position: 2 })).fill('2,5')

    // 1200 + 2.5 × 40 = 1300
    await page.getByText('1.300,00 €').waitFor()
    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByRole('button', { name: it('ui.quotes.accept') }).click()

    await page.waitForURL(`**/jobs/${job.id}`)
    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(quote.status, 'accepted')
    assert.equal(quote.total, '1300.00')
  })
})
