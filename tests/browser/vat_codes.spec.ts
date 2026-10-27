import { test } from '@japa/runner'
import VatCode from '#models/vat_code'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('VAT Codes in the browser', () => {
  test('the Admin adds a reverse-charge code with its legal note', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/vat-codes')
    await page
      .getByLabel(it('ui.vatCodes.name'), { exact: true })
      .fill('Inversione contabile – rottami')
    await page.getByLabel(it('ui.vatCodes.rate'), { exact: true }).fill('0')
    await page.getByLabel(it('ui.vatCodes.natura'), { exact: true }).selectOption('N6.1')
    await page.getByLabel(it('ui.vatCodes.legalNote'), { exact: true }).fill('Art. 74 DPR 633/1972')
    await page.getByRole('button', { name: it('ui.vatCodes.add') }).click()

    await page
      .getByLabel(it('ui.vatCodes.nameOf', { name: 'Inversione contabile – rottami' }))
      .waitFor()
    const code = await VatCode.findByOrFail('name', 'Inversione contabile – rottami')
    assert.equal(code.natura, 'N6.1')
    assert.equal(code.legalNote, 'Art. 74 DPR 633/1972')
  })
})
