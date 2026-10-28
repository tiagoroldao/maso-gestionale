import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import DocumentTemplate from '#models/document_template'
import DocumentTemplateVersion from '#models/document_template_version'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const fields = [
  { key: 'model', label: 'Modello', type: 'text', required: true },
  {
    key: 'outcome',
    label: 'Esito',
    type: 'choice',
    required: false,
    options: ['Positivo', 'Negativo'],
  },
]

function body(...content: object[]) {
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

const certificate = {
  name: 'Dichiarazione di conformità',
  fields,
  body: body(
    { type: 'text', text: 'Impianto: ' },
    { type: 'placeholder', attrs: { key: 'field.model' } },
    { type: 'text', text: ' per ', marks: [{ type: 'bold' }] },
    { type: 'placeholder', attrs: { key: 'recipient.name' } }
  ),
}

test.group('Document Templates', () => {
  test('the Admin creates a template; each save is a new version', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const created = await client
      .post('/settings/document-templates')
      .json(certificate)
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    created.assertFlashMessage('success', it('flash.documentTemplateSaved', { version: 1 }))
    const template = await DocumentTemplate.findByOrFail('name', certificate.name)

    await client
      .put(`/settings/document-templates/${template.id}`)
      .json({ ...certificate, body: body({ type: 'text', text: 'Seconda versione' }) })
      .withCsrfToken()
      .loginAs(admin)

    const versions = await DocumentTemplateVersion.query()
      .where('documentTemplateId', template.id)
      .orderBy('version')
    assert.deepEqual(
      versions.map((v) => v.version),
      [1, 2]
    )
    assert.deepEqual(versions[0].fields, fields as never)
    assert.deepEqual(
      versions.map((v) => v.name),
      [certificate.name, certificate.name]
    )
    assert.equal(versions[1].body.content![0].content![0].text, 'Seconda versione')

    // The editor opens on the latest version
    const page = await client
      .get(`/settings/document-templates/${template.id}/edit`)
      .withInertia()
      .loginAs(admin)
    page.assertInertiaPropsContains({ template: { version: 2 } })
  })

  test('earlier versions can not be changed', async ({ assert }) => {
    const admin = await createUser('admin')
    const template = await DocumentTemplate.create({ name: 'Modello' })
    const version = await DocumentTemplateVersion.create({
      documentTemplateId: template.id,
      version: 1,
      name: 'Modello',
      body: body({ type: 'text', text: 'Originale' }) as never,
      fields: [],
      createdBy: admin.id,
    })

    const refusal = async (change: () => Promise<unknown>) => {
      try {
        await change()
      } catch (error) {
        return (error as Error).message
      }
      return 'allowed'
    }
    // Each in its own savepoint: a refused statement aborts its transaction
    const versions = () => db.from('document_template_versions').where('id', version.id)
    for (const change of [
      () => db.transaction((trx) => versions().useTransaction(trx).update({ version: 9 })),
      () => db.transaction((trx) => versions().useTransaction(trx).delete()),
    ]) {
      assert.include(await refusal(change), 'Document Template versions can not be changed')
    }
    const row = await db.from('document_template_versions').where('id', version.id).firstOrFail()
    assert.equal(row.version, 1)
  })

  test('raw HTML, other nodes and unknown placeholders are refused', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const refused = [
      { ...certificate, body: '<p>HTML</p>' },
      { ...certificate, body: { type: 'doc', content: [{ type: 'codeBlock', content: [] }] } },
      {
        ...certificate,
        body: body({
          type: 'text',
          text: 'x',
          marks: [{ type: 'link', attrs: { href: 'http://x' } }],
        }),
      },
      { ...certificate, body: body({ type: 'placeholder', attrs: { key: 'field.missing' } }) },
    ]
    for (const payload of refused) {
      const response = await client
        .post('/settings/document-templates')
        .json(payload)
        .header('referer', '/settings/document-templates/new')
        .withCsrfToken()
        .loginAs(admin)
        .redirects(0)
      response.assertFlashMessage('inputErrorsBag', {
        body: [it('validator.shared.messages.templateBody')],
      })
    }
    assert.lengthOf(await DocumentTemplate.all(), 0)
  })

  test('fields need a valid, unique key, and choices for a list', async ({ client, assert }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/document-templates')
      .json({
        ...certificate,
        body: body({ type: 'text', text: 'x' }),
        fields: [
          { key: 'Bad Key', label: 'A', type: 'text', required: false },
          { key: 'list', label: 'B', type: 'choice', required: false },
        ],
      })
      .header('referer', '/settings/document-templates/new')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    assert.properties(response.flashMessage('inputErrorsBag'), ['fields.0.key', 'fields.1.options'])

    const duplicate = await client
      .post('/settings/document-templates')
      .json({
        ...certificate,
        body: body({ type: 'text', text: 'x' }),
        fields: [
          { key: 'model', label: 'A', type: 'text', required: false },
          { key: 'model', label: 'B', type: 'text', required: false },
        ],
      })
      .header('referer', '/settings/document-templates/new')
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)
    assert.properties(duplicate.flashMessage('inputErrorsBag'), ['fields'])
    assert.lengthOf(await DocumentTemplate.all(), 0)
  })

  test('the preview fills the Base Layout with sample data, escaped', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/document-templates/preview')
      .json({
        ...certificate,
        body: body(
          { type: 'text', text: '<script>alert(1)</script>' },
          { type: 'placeholder', attrs: { key: 'field.model' } },
          { type: 'placeholder', attrs: { key: 'field.outcome' } }
        ),
      })
      .withCsrfToken()
      .loginAs(admin)

    response.assertStatus(200)
    const html = response.body().html as string
    assert.include(html, '<!DOCTYPE html>')
    assert.include(html, 'Dichiarazione di conformità')
    assert.include(html, 'Testo di esempio')
    assert.include(html, 'Positivo')
    assert.include(html, '&lt;script&gt;')
    assert.notInclude(html, '<script>alert')
  })

  test('only the Admin manages templates', async ({ client, assert }) => {
    const template = await DocumentTemplate.create({ name: 'Modello' })
    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [
        '/settings/document-templates',
        '/settings/document-templates/new',
        `/settings/document-templates/${template.id}/edit`,
      ]) {
        const page = await client.get(url).withInertia().loginAs(user)
        page.assertStatus(403)
      }
      for (const request of [
        client.post('/settings/document-templates').json(certificate),
        client.put(`/settings/document-templates/${template.id}`).json(certificate),
        client.post('/settings/document-templates/preview').json(certificate),
      ]) {
        const denied = await request
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    assert.lengthOf(await DocumentTemplateVersion.all(), 0)
    assert.lengthOf(await DocumentTemplate.all(), 1)
  })
})
