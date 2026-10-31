import { test } from '@japa/runner'
import i18nManager from '@adonisjs/i18n/services/main'
import IssuedDocument from '#models/issued_document'
import DocumentTemplates from '#services/document_templates'
import IssuedDocuments from '#services/issued_documents'
import type { TemplateNode } from '#shared/document_templates'
import { SCREEN_SIZES } from '#shared/screen_sizes'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { it } from '#tests/helpers/i18n'

const NAME = 'Dichiarazione di conformità'

/** A Customer with a Site, and a template asking for the Site, a table and a note */
async function world() {
  const customer = await createCustomer({ name: 'Bar Centrale' })
  const site = await createSite({ label: 'Centrale termica', city: 'Como' })
  await customer.related('sites').attach([site.id])
  const template = await DocumentTemplates.create({
    name: NAME,
    fields: [
      { key: 'site', label: 'Immobile', type: 'site', required: true },
      {
        key: 'checks',
        label: 'Verifiche',
        type: 'table',
        required: false,
        columns: [{ key: 'what', label: 'Prova', type: 'text' }],
      },
      { key: 'notes', label: 'Esito', type: 'text', required: true },
    ],
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conforme.' }] }],
    } as TemplateNode,
  })
  return { customer, site, template }
}

/**
 * The Issued Document screens as Entity screens (#278): docs/ui.md's
 * rules where they depend on the screen size, the frozen document's
 * actions, and their accessibility.
 */
test.group('Issued Document screens in the browser', () => {
  test('on a phone: issuing sits under the Customer, its button in the bottom bar', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const { customer, template } = await world()

    // Choosing the template comes first, with nothing to issue yet
    const page = await visit(`/issued-documents/create?customerId=${customer.id}`)
    await page.setViewportSize(SCREEN_SIZES.phone)
    await page
      .getByRole('link', { name: it('ui.screen.back', { label: 'Bar Centrale' }) })
      .waitFor()
    assert.equal(await page.getByTestId('primary-action').count(), 0)
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'templates')
    await page.getByRole('link', { name: NAME }).click()

    // Then its fields, "Emetti documento" in the bar at the bottom
    await page.waitForURL(new RegExp(`templateId=${template.id}`))
    const issue = page.getByTestId('primary-action').getByRole('button')
    assert.equal(
      await issue.textContent().then((text) => text?.trim()),
      it('ui.issuedDocuments.issue')
    )
    assert.equal(await issue.getAttribute('form'), 'issued-document')
    await page.getByRole('option', { name: /Centrale termica/ }).click()
    await page.getByRole('button', { name: it('ui.documentTemplates.fill.addRow') }).click()
    // On the phone each cell shows its column's name above it
    await page
      .getByLabel(it('ui.documentTemplates.fill.cellOf', { column: 'Prova', row: 1 }))
      .fill('Tenuta')
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'fields')

    // The required note is missing: the field says so, nothing is issued
    await issue.click()
    await page.getByText(it('ui.issuedDocuments.failed')).waitFor()
    assert.lengthOf(await IssuedDocument.query().where('customerId', customer.id), 0)
  })

  test('on a desktop: a document’s PDF opens in a new tab; a replaced one is tagged', async ({
    browserContext,
    visit,
    assert,
  }) => {
    const office = await createUser('office')
    await browserContext.loginAs(office)
    const { customer, site, template } = await world()
    const i18n = i18nManager.locale('it')
    const original = await IssuedDocuments.issue(
      template,
      customer,
      { site: site.id, notes: 'Positivo' },
      i18n,
      office
    )
    const number = original.number

    const page = await visit(`/issued-documents/${original.id}`)
    await page.setViewportSize(SCREEN_SIZES.desktop)
    const title = it('ui.issuedDocuments.showTitle', { name: NAME, number })
    await page.getByRole('heading', { name: title }).waitFor()
    await page
      .getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      .getByRole('link', { name: 'Bar Centrale' })
      .waitFor()
    // Frozen: nothing to save, so no primary
    assert.equal(await page.getByTestId('primary-action').count(), 0)
    const header = page.locator('main header')
    const pdf = header.getByRole('link', { name: it('ui.issuedDocuments.pdf'), exact: true })
    assert.equal(await pdf.getAttribute('href'), `/issued-documents/${original.id}/pdf`)
    assert.equal(await pdf.getAttribute('target'), '_blank')
    const facts = page.getByLabel(it('ui.screen.keyFacts'), { exact: true })
    assert.equal(
      await facts.getByRole('link', { name: site.summary }).getAttribute('href'),
      `/sites/${site.id}`
    )
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'issued')

    // The replacement's form sits under the document it replaces
    await header.getByRole('link', { name: it('ui.issuedDocuments.replace') }).click()
    await page
      .getByRole('heading', { name: it('ui.issuedDocuments.replaceTitle', { number }) })
      .waitFor()
    await page
      .getByRole('navigation', { name: it('ui.screen.breadcrumb') })
      .getByRole('link', { name: title })
      .waitFor()
    assert.equal(await page.getByLabel('Esito').inputValue(), 'Positivo')
    await page.getByLabel('Esito').fill('Positivo, corretto')
    await header.getByRole('button', { name: it('ui.issuedDocuments.issue') }).click()

    // The replacement links back; the original is tagged and can't be replaced again
    await page.getByRole('link', { name: number, exact: true }).click()
    await page.getByRole('heading', { name: title }).waitFor()
    await header.getByText(it('ui.issuedDocuments.replaced'), { exact: true }).waitFor()
    assert.equal(
      await header.getByRole('link', { name: it('ui.issuedDocuments.replace') }).count(),
      0
    )
    assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'replaced')
  })

  test('a document is issued once: not by Enter in a search, not by a second submit', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Bar Centrale' })
    await createItem({ code: 'VS-1', description: 'Valvola a sfera' })
    const template = await DocumentTemplates.create({
      name: 'Verbale',
      fields: [
        { key: 'notes', label: 'Esito', type: 'text', required: true },
        { key: 'parts', label: 'Ricambi', type: 'items', required: false },
      ],
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verbale.' }] }],
      } as TemplateNode,
    })
    const issued = () => IssuedDocument.query().where('customerId', customer.id)

    const page = await visit(
      `/issued-documents/create?templateId=${template.id}&customerId=${customer.id}`
    )
    await page.setViewportSize(SCREEN_SIZES.desktop)
    await page.getByLabel('Esito').fill('Positivo')

    // Enter in the Items search looks for Items; it issues nothing
    const search = page.getByLabel('Ricambi')
    await search.fill('Valvola')
    await search.press('Enter')
    await page.getByRole('option', { name: /Valvola a sfera/ }).waitFor()
    await page.waitForTimeout(500)
    assert.lengthOf(await issued(), 0)
    assert.match(page.url(), /\/issued-documents\/create/)

    // The document's page loads slowly: a second click and an Enter meanwhile issue nothing more
    let release = () => {}
    const loading = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/issued-documents\/\d+$/, async (route) => {
      await loading
      await route.continue()
    })
    const issue = page.getByRole('button', { name: it('ui.issuedDocuments.issue') })
    const answered = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.status() === 200
    )
    await issue.click()
    await answered
    await issue.click({ force: true })
    await page.getByLabel('Esito').press('Enter')
    await page.waitForTimeout(500)
    release()
    await page.getByRole('heading', { name: /Verbale/ }).waitFor()
    assert.lengthOf(await issued(), 1)
  })
})
