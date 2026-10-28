import { test } from '@japa/runner'
import DocumentTemplate from '#models/document_template'
import DocumentTemplates from '#services/document_templates'
import { createUser } from '#tests/helpers/users'
import { it } from '#tests/helpers/i18n'

test.group('Document Templates in the browser', () => {
  test('the Admin writes a template with a field and a data chip, then previews it', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('admin'))

    const page = await visit('/settings/document-templates/new')
    await page.getByLabel(it('ui.documentTemplates.name')).fill('Verbale di collaudo')
    await page.getByRole('button', { name: it('ui.documentTemplates.addField') }).click()
    await page.getByLabel(it('ui.documentTemplates.fieldKeyOf', { position: 1 })).fill('pressure')
    await page
      .getByLabel(it('ui.documentTemplates.fieldLabelOf', { position: 1 }))
      .fill('Pressione di prova')

    const body = page.getByTestId('template-body').locator('[contenteditable]')
    await body.click()
    await page.keyboard.type('Pressione: ')
    await page
      .getByLabel(it('ui.documentTemplates.insertPlaceholder'))
      .selectOption({ label: 'Pressione di prova' })
    await page.getByTestId('template-body').locator('[data-placeholder="field.pressure"]').waitFor()

    await page.getByRole('button', { name: it('ui.documentTemplates.refreshPreview') }).click()
    const preview = page.frameLocator('[data-testid="template-preview"]')
    // The field's sample value fills the chip
    await preview.getByText(/Pressione:\s?Testo di esempio/).waitFor()

    await page.getByRole('button', { name: it('ui.documentTemplates.save') }).click()
    await page.waitForURL(/\/settings\/document-templates\/\d+\/edit$/)
    const template = await DocumentTemplate.findByOrFail('name', 'Verbale di collaudo')
    const current = await DocumentTemplates.current(template)
    assert.equal(current.version, 1)
    assert.deepEqual(current.fields, [
      { key: 'pressure', label: 'Pressione di prova', type: 'text', required: false },
    ])
    const paragraph = current.body.content![0]
    assert.deepInclude(paragraph.content![1], {
      type: 'placeholder',
      attrs: { key: 'field.pressure', label: 'Pressione di prova' },
    })
  })
})
