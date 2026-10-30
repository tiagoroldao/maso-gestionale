import { test } from '@japa/runner'
import Quote from '#models/quote'
import LabourRate from '#models/labour_rate'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { it } from '#tests/helpers/i18n'
import { chooseMoreAction } from '#tests/helpers/screen'
import type { Page } from 'playwright'

/** Answers the confirmation dialog of an action (docs/ui.md "Actions") */
async function confirm(page: Page, label: string) {
  await page.getByRole('alertdialog').getByRole('button', { name: label }).click()
}

test.group('Quotes in the browser', () => {
  test('Office writes a Quote from Items and labour, sends it, then it is accepted', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())
    await createItem({ code: 'CALD-25', description: 'Caldaia 25 kW', resalePrice: '1200' })
    const rate = await LabourRate.create({ name: 'Idraulico', hourlyPrice: '40' })

    // Started from the Job page, saved as the Job's first Quote
    const page = await visit(`/jobs/${job.id}`)
    await chooseMoreAction(page, it('ui.quotes.new'))
    await page.waitForURL(`**/jobs/${job.id}/quotes/create`)
    await page.getByLabel(it('ui.quotes.addItem')).fill('cald')
    await page.getByRole('option', { name: /CALD-25/ }).click()
    await page.getByLabel(it('ui.quotes.addLabour')).selectOption(String(rate.id))
    await page.getByRole('button', { name: it('ui.quotes.addLabourButton') }).click()
    await page.getByLabel(it('ui.quotes.quantityOf', { position: 2 })).fill('2,5')

    // 1200 + 2.5 × 40 = 1300, reverse charged (company maintenance): no VAT on top
    await page
      .getByTestId('quote-totals')
      .getByText('1.300,00 €', { exact: true })
      .first()
      .waitFor()
    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.waitForURL(/\/quotes\/\d+$/)
    // Sending freezes it, so it asks first
    await page.getByRole('button', { name: it('ui.quotes.send') }).click()
    await confirm(page, it('ui.quotes.send'))

    // Sent: frozen, still to be decided
    await page.getByText(it('ui.quotes.statuses.sent'), { exact: true }).waitFor()
    assert.isTrue(await page.getByLabel(it('ui.quotes.quantityOf', { position: 2 })).isDisabled())
    assert.equal(await page.getByRole('button', { name: it('ui.quotes.save') }).count(), 0)
    await page.getByRole('button', { name: it('ui.quotes.accept') }).click()
    await confirm(page, it('ui.quotes.accept'))

    await page.waitForURL(`**/jobs/${job.id}`)
    await page.getByText(`${job.number}-1`).waitFor()
    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(quote.status, 'accepted')
    assert.isNotNull(quote.sentAt)
    assert.equal(quote.totals.taxable, '1300.00')
    // Both new lines took the default VAT rule for the Job
    assert.deepEqual(
      quote.lines.map((line) => line.natura),
      ['N6.7', 'N6.7']
    )
  })

  test('Accept waits until the edits are saved', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer())
    await createItem({ code: 'VAL-1', description: 'Valvola', resalePrice: '10' })

    const page = await visit(`/jobs/${job.id}/quotes/create`)
    await page.getByLabel(it('ui.quotes.addItem')).fill('val')
    await page.getByRole('option', { name: /VAL-1/ }).click()
    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByRole('button', { name: it('ui.quotes.send') }).waitFor()

    // Change the price without saving: sending and deciding are blocked, saying why
    await page.getByLabel(it('ui.quotes.unitPriceOf', { position: 1 })).fill('8')
    assert.isTrue(await page.getByRole('button', { name: it('ui.quotes.send') }).isDisabled())
    await page.getByText(it('ui.quotes.saveBeforeDeciding')).first().waitFor()
    await page.getByRole('button', { name: it('ui.screen.moreActions') }).click()
    assert.isTrue(await page.getByRole('menuitem', { name: it('ui.quotes.accept') }).isDisabled())
    assert.isTrue(await page.getByRole('menuitem', { name: it('ui.quotes.decline') }).isDisabled())
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: it('ui.quotes.save') }).click()
    await page.getByText(it('ui.quotes.unsaved')).waitFor({ state: 'detached' })
    await chooseMoreAction(page, it('ui.quotes.accept'))
    await confirm(page, it('ui.quotes.accept'))
    await page.waitForURL(`**/jobs/${job.id}`)

    const quote = await Quote.query().where('jobId', job.id).preload('lines').firstOrFail()
    assert.equal(quote.status, 'accepted')
    assert.equal(quote.lines[0].unitPrice, '8.0000')
  })
})
