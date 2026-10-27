import { test } from '@japa/runner'
import { createUser } from '#tests/helpers/users'
import { GotenbergPdfConverter, PdfConversionError } from '#documents/pdf_converter'

test.group('Letterhead preview', () => {
  test('the Admin sees the HTML preview', async ({ client }) => {
    const admin = await createUser('admin')

    const response = await client.get('/settings/company/letterhead').loginAs(admin)

    response.assertStatus(200)
    response.assertHeader('content-type', 'text/html; charset=utf-8')
    response.assertTextIncludes('Letterhead preview')
  })

  test('only the Admin can open the preview', async ({ client }) => {
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of ['/settings/company/letterhead', '/settings/company/letterhead.pdf']) {
        const response = await client.get(url).loginAs(user)
        response.assertStatus(403)
      }
    }
  })

  test('smoke: real Gotenberg returns a PDF', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client.get('/settings/company/letterhead.pdf').loginAs(admin)

    response.assertStatus(200)
    response.assertHeader('content-type', 'application/pdf')
    assert.equal(
      Buffer.from(response.body() as Buffer)
        .subarray(0, 5)
        .toString(),
      '%PDF-'
    )
  }).tags(['@gotenberg'])

  test('an error response from Gotenberg raises a PdfConversionError', async ({ assert }) => {
    // The app's own test server answers this unknown route with an error status
    const converter = new GotenbergPdfConverter(`http://${process.env.HOST}:${process.env.PORT}`)

    await assert.rejects(() => converter.convert('<p>hi</p>'), PdfConversionError)
  })

  test('an unreachable Gotenberg raises a PdfConversionError', async ({ assert }) => {
    const converter = new GotenbergPdfConverter('http://127.0.0.1:9')

    await assert.rejects(() => converter.convert('<p>hi</p>'), PdfConversionError)
  })
})
