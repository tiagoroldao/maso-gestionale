import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import InstalledEquipment from '#models/installed_equipment'
import IssuedDocument from '#models/issued_document'
import DocumentTemplates from '#services/document_templates'
import type { TemplateNode } from '#shared/document_templates'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Issued Documents in the browser', () => {
  test('Office issues a document for a Customer, then a replacement', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Bar Centrale' })
    const site = await createSite({ label: 'Centrale termica', city: 'Como' })
    await customer.related('sites').attach([site.id])
    const boiler = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia',
      make: 'Vaillant',
    })
    await DocumentTemplates.create({
      name: 'Dichiarazione di conformità',
      fields: [
        { key: 'site', label: 'Immobile', type: 'site', required: true },
        { key: 'boiler', label: 'Caldaia', type: 'equipment', required: true },
        { key: 'notes', label: 'Esito', type: 'text', required: true },
      ],
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'placeholder', attrs: { key: 'field.notes' } }],
          },
        ],
      } as TemplateNode,
    })
    const number = `${DateTime.now().year}/0001`

    const page = await visit(`/customers/${customer.id}`)
    await page.getByRole('link', { name: it('ui.issuedDocuments.newForCustomer') }).click()
    await page.getByRole('link', { name: 'Dichiarazione di conformità' }).click()
    // The Customer comes along; the Customer's own Site is offered straight away
    await page.getByText('Bar Centrale').waitFor()
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    await page.getByLabel('Caldaia').selectOption({ label: 'Caldaia — Vaillant' })
    await page.getByLabel('Esito').fill('Positivo')
    await page.getByRole('button', { name: it('ui.issuedDocuments.issue') }).click()

    await page
      .getByRole('heading', {
        name: it('ui.issuedDocuments.showTitle', { name: 'Dichiarazione di conformità', number }),
      })
      .waitFor()
    const original = await IssuedDocument.firstOrFail()
    assert.equal(original.installedEquipmentId, boiler.id)
    assert.equal(original.values['field.notes'], 'Positivo')

    // The replacement starts from the original's values
    await page.getByRole('link', { name: it('ui.issuedDocuments.replace') }).click()
    await page.getByText('Centrale termica').first().waitFor()
    await page
      .getByLabel('Caldaia')
      .locator('option:checked', { hasText: 'Vaillant' })
      .waitFor({ state: 'attached' })
    assert.equal(await page.getByLabel('Esito').inputValue(), 'Positivo')
    await page.getByLabel('Esito').fill('Positivo, corretto')
    await page.getByRole('button', { name: it('ui.issuedDocuments.issue') }).click()

    await page.getByRole('link', { name: number }).waitFor()
    await original.refresh()
    assert.isNotNull(original.replacedById)
    const replacement = await IssuedDocument.findOrFail(original.replacedById)
    assert.equal(replacement.sequence, 2)
    assert.equal(replacement.installedEquipmentId, boiler.id)
    assert.equal(replacement.values['field.notes'], 'Positivo, corretto')
  })
})
