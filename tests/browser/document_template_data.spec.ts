import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import InstalledEquipment from '#models/installed_equipment'
import DocumentTemplates from '#services/document_templates'
import type { TemplateNode } from '#shared/document_templates'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { markDone } from '#tests/helpers/charges'
import { it } from '#tests/helpers/i18n'

test.group('Document Templates filled with real data in the browser', () => {
  test('the Admin adds a table to the body, then tries the template on a Customer', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))
    const customer = await createCustomer({ name: 'Bar Centrale' })
    const site = await createSite({ label: 'Centrale termica', city: 'Como' })
    await customer.related('sites').attach([site.id])
    await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Caldaia',
      make: 'Vaillant',
      installedOn: DateTime.fromISO('2024-10-01'),
    })
    const job = await createJob(customer, { title: 'Sostituzione caldaia' })
    const valve = await createItem({ code: 'VS-1', description: 'Valvola a sfera' })
    for (const quantity of ['1', '2.5']) {
      const charge = await Charge.create({
        jobId: job.id,
        kind: 'item',
        itemId: valve.id,
        quantity,
        billQuantity: quantity,
        unitPrice: '1',
        description: 'Valvola a sfera',
      })
      await markDone(charge)
    }
    const template = await DocumentTemplates.create({
      name: 'Rapporto di intervento',
      fields: [
        { key: 'site', label: 'Immobile', type: 'site', required: true },
        { key: 'boiler', label: 'Caldaia', type: 'equipment', required: true },
        { key: 'job', label: 'Commessa', type: 'job', required: true },
        {
          key: 'materials',
          label: 'Materiali',
          type: 'table',
          required: true,
          columns: [
            { key: 'what', label: 'Articolo', type: 'text', from: 'description' },
            { key: 'qty', label: 'Quantità', type: 'number', from: 'quantity' },
          ],
        },
      ],
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Caldaia ' },
              { type: 'placeholder', attrs: { key: 'field.boiler.make' } },
              { type: 'text', text: ' a ' },
              { type: 'placeholder', attrs: { key: 'field.site.city' } },
            ],
          },
        ],
      } as TemplateNode,
    })

    // The table goes in the body from the editor
    const editor = await visit(`/settings/document-templates/${template.id}/edit`)
    await editor.getByTestId('template-body').getByRole('textbox').click()
    await editor.keyboard.press('End')
    await editor
      .getByLabel(it('ui.documentTemplates.insertTable'))
      .selectOption({ label: 'Materiali' })
    await editor.getByTestId('template-body').locator('[data-field-table="materials"]').waitFor()
    await editor.getByRole('button', { name: it('ui.documentTemplates.save') }).click()
    await editor
      .getByText(it('flash.documentTemplateSaved', { version: 2 }))
      .first()
      .waitFor()
    const current = await DocumentTemplates.current(template)
    assert.deepInclude(current.body.content, {
      type: 'fieldTable',
      attrs: { key: 'materials', label: 'Materiali' },
    })

    await editor.getByRole('link', { name: it('ui.documentTemplates.tryWithData') }).click()
    await editor.waitForURL(/\/fill$/)
    const page = editor

    await page.getByLabel(it('ui.customers.picker.label')).fill('Bar')
    await page.getByRole('option', { name: /Bar Centrale/ }).click()
    // The Customer's own Site is offered straight away
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    await page.getByLabel('Caldaia').selectOption({ label: 'Caldaia — Vaillant' })
    await page
      .getByLabel('Commessa')
      .selectOption({ label: `${job.number} – Sostituzione caldaia` })
    await page.getByRole('button', { name: it('ui.documentTemplates.fill.loadFromJob') }).click()
    await page.getByText(it('ui.documentTemplates.fill.loadedFromJob', { count: 1 })).waitFor()

    await page.getByRole('button', { name: it('ui.documentTemplates.fill.render') }).click()
    const preview = page.frameLocator('[data-testid="template-preview"]')
    await preview.getByText(/Caldaia\s?Vaillant\s?a\s?Como/).waitFor()
    await preview.getByRole('cell', { name: 'Valvola a sfera' }).waitFor()
    await preview.getByRole('cell', { name: '3,5' }).waitFor()
  })
})
