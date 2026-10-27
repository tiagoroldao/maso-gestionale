import { rm } from 'node:fs/promises'
import { copyFile, mkdir } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import CompanySettings from '#models/company_settings'
import DocumentRenderer, { type DocumentInput } from '#documents/document_renderer'
import { storagePath } from '#services/storage'

const input: DocumentInput = {
  title: 'Dichiarazione di conformità',
  recipient: {
    name: 'Mario <b>Rossi</b>',
    addressLines: ['Via Garibaldi, 5', '20121 Milano (MI)'],
    taxCode: 'RSSMRA85T10A562S',
  },
  bodyHtml: '<p class="body-marker">Body content</p>',
}

/**
 * The converter is never called by renderHtml; this one fails loudly if it is.
 */
const noConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}

async function saveCompany(overrides: Partial<CompanySettings> = {}) {
  return CompanySettings.create({
    id: 1,
    name: 'Idraulica Maso S.r.l.',
    vatNumber: '12345678903',
    taxCode: '12345678903',
    taxRegime: 'RF01',
    street: 'Via Roma',
    streetNumber: '12',
    postalCode: '20121',
    city: 'Milano',
    province: 'MI',
    phone: '+39 02 1234567',
    ...overrides,
  })
}

test.group('DocumentRenderer HTML', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('prints the company letterhead', async ({ assert }) => {
    await saveCompany()

    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    assert.include(html, 'Idraulica Maso S.r.l.')
    assert.include(html, 'Via Roma, 12')
    assert.include(html, '20121 Milano (MI)')
    assert.include(html, 'P.IVA 12345678903')
    assert.include(html, 'Tel. +39 02 1234567')
    assert.notInclude(
      html,
      'C.F. 12345678903',
      'a tax code equal to the VAT number is not repeated'
    )
  })

  test('prints the recipient block, escaping its text', async ({ assert }) => {
    await saveCompany()

    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    assert.include(html, 'Mario &lt;b&gt;Rossi&lt;/b&gt;')
    assert.include(html, 'Via Garibaldi, 5')
    assert.include(html, 'C.F. RSSMRA85T10A562S')
  })

  test('omits the recipient block when there is no recipient', async ({ assert }) => {
    await saveCompany()

    const html = await new DocumentRenderer(noConverter).renderHtml({ ...input, recipient: null })

    assert.notInclude(html, 'data-test="recipient"')
  })

  test('inserts the title and the trusted body', async ({ assert }) => {
    await saveCompany()

    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    assert.include(html, '<title>Dichiarazione di conformità</title>')
    assert.include(html, '<p class="body-marker">Body content</p>')
  })

  test('embeds the logo as a data URI', async ({ assert }) => {
    await mkdir(storagePath('company'), { recursive: true })
    await copyFile(app.makePath('tests/fixtures/logo.png'), storagePath('company/logo-1.png'))
    await saveCompany({ logoFile: 'company/logo-1.png' })

    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    assert.include(html, 'src="data:image/png;base64,')
  })

  test('renders before the company settings are filled in', async ({ assert }) => {
    const html = await new DocumentRenderer(noConverter).renderHtml(input)

    assert.include(html, '<p class="body-marker">Body content</p>')
  })

  test('passes the rendered HTML to the converter for PDFs', async ({ assert }) => {
    await saveCompany()
    let received = ''
    const converter = {
      convert: async (html: string) => {
        received = html
        return Buffer.from('%PDF-fake')
      },
    }

    const pdf = await new DocumentRenderer(converter).renderPdf(input)

    assert.equal(pdf.toString(), '%PDF-fake')
    assert.include(received, 'Idraulica Maso S.r.l.')
  })
})
