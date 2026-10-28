import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Charge from '#models/charge'
import DocumentTemplate from '#models/document_template'
import InstalledEquipment from '#models/installed_equipment'
import LabourRate from '#models/labour_rate'
import DocumentTemplates from '#services/document_templates'
import type { TemplateField, TemplateNode } from '#shared/document_templates'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const placeholder = (key: string) => ({ type: 'placeholder', attrs: { key } })
const paragraph = (...content: object[]) => ({ type: 'paragraph', content })
const doc = (...content: object[]) => ({ type: 'doc', content })

const entityFields: TemplateField[] = [
  { key: 'site', label: 'Immobile', type: 'site', required: true },
  { key: 'boiler', label: 'Caldaia', type: 'equipment', required: true },
  { key: 'job', label: 'Commessa', type: 'job', required: false },
  { key: 'part', label: 'Ricambio', type: 'item', required: false },
  { key: 'parts', label: 'Materiali', type: 'items', required: false },
  {
    key: 'materials',
    label: 'Materiali usati',
    type: 'table',
    required: false,
    columns: [
      { key: 'code', label: 'Codice', type: 'text', from: 'code' },
      { key: 'what', label: 'Descrizione', type: 'text', from: 'description' },
      { key: 'qty', label: 'Quantità', type: 'number', from: 'quantity' },
      { key: 'checked', label: 'Verificato il', type: 'date' },
    ],
  },
]

// Every placeholder of every entity field, one per paragraph, and the table
const entityBody = doc(
  ...[
    'field.site',
    'field.site.address',
    'field.site.city',
    'field.boiler',
    'field.boiler.make',
    'field.boiler.model',
    'field.boiler.serial_number',
    'field.boiler.installed_on',
    'field.job',
    'field.job.number',
    'field.job.title',
    'field.part',
    'field.part.code',
    'field.part.description',
    'field.parts',
    'recipient.name',
  ].map((key) => paragraph({ type: 'text', text: `${key}=` }, placeholder(key))),
  { type: 'fieldTable', attrs: { key: 'materials', label: 'Materiali usati' } }
)

async function saveTemplate(
  fields: TemplateField[] = entityFields,
  body: object = entityBody
): Promise<DocumentTemplate> {
  return DocumentTemplates.create({ name: 'Rapporto', fields, body: body as TemplateNode })
}

/**
 * A Customer with a Site, a boiler at it, a Job and two Items.
 */
async function world() {
  const customer = await createCustomer({ name: 'Condominio <Verdi>' })
  const site = await createSite({ label: 'Casa <al mare>', street: 'Via Roma', city: 'Como' })
  const boiler = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    make: 'Vaillant <&>',
    model: 'ecoTEC',
    serialNumber: 'SN-1',
    installedOn: DateTime.fromISO('2024-10-01'),
  })
  const job = await createJob(customer, { title: 'Sostituzione <caldaia>' })
  const valve = await createItem({ code: 'VS-1', description: 'Valvola <1/2">' })
  const tee = await createItem({ code: 'RT-2', description: 'Raccordo a T' })
  return { customer, site, boiler, job, valve, tee }
}

function itemCharge(jobId: number, itemId: number, quantity: string) {
  return Charge.create({
    jobId,
    kind: 'item',
    itemId,
    quantity,
    billQuantity: quantity,
    unitPrice: '1',
    description: 'x',
  })
}

test.group('Document Templates: entity fields and tables', () => {
  test('the Admin declares entity fields and a table, used in the body', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/document-templates')
      .json({ name: 'Rapporto', fields: entityFields, body: entityBody })
      .withCsrfToken()
      .loginAs(admin)
      .redirects(0)

    response.assertFlashMessage('success', it('flash.documentTemplateSaved', { version: 1 }))
    const template = await DocumentTemplate.findByOrFail('name', 'Rapporto')
    const current = await DocumentTemplates.current(template)
    assert.deepEqual(current.fields, entityFields)
  })

  test('one Site, one Job, Equipment only with a Site, and columns for a table', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const field = (key: string, type: string, extra: object = {}) => ({
      key,
      label: key,
      type,
      required: false,
      ...extra,
    })
    const errorsFor = async (fields: object[], body: object = doc(paragraph())) => {
      const response = await client
        .post('/settings/document-templates')
        .json({ name: 'Rapporto', fields, body })
        .header('referer', '/settings/document-templates/new')
        .withCsrfToken()
        .loginAs(admin)
        .redirects(0)
      return response.flashMessage('inputErrorsBag') as Record<string, string[]>
    }
    const column = (key: string) => ({ key, label: key, type: 'text' })

    assert.deepEqual(await errorsFor([field('a', 'site'), field('b', 'site')]), {
      'fields.1.type': [it('validator.shared.messages.templateFields.one.site')],
    })
    assert.deepEqual(await errorsFor([field('a', 'job'), field('b', 'text'), field('c', 'job')]), {
      'fields.2.type': [it('validator.shared.messages.templateFields.one.job')],
    })
    assert.deepEqual(await errorsFor([field('a', 'equipment')]), {
      'fields.0.type': [it('validator.shared.messages.templateFields.equipmentNeedsSite')],
    })
    // Equipment declared before its Site field is fine
    assert.isUndefined(await errorsFor([field('a', 'equipment'), field('b', 'site')]))

    assert.properties(await errorsFor([field('t', 'table')]), ['fields.0.columns'])
    assert.properties(await errorsFor([field('t', 'table', { columns: [] })]), ['fields.0.columns'])
    const eleven = Array.from({ length: 11 }, (_, i) => column(`c${i}`))
    assert.properties(await errorsFor([field('t', 'table', { columns: eleven })]), [
      'fields.0.columns',
    ])
    assert.deepEqual(
      await errorsFor([field('t', 'table', { columns: [column('a'), column('a')] })]),
      { 'fields.0.columns': [it('validator.shared.messages.fields.*.columns.distinct')] }
    )
    assert.properties(
      await errorsFor([
        field('t', 'table', { columns: [{ key: 'A b', label: '', type: 'money', from: 'price' }] }),
      ]),
      [
        'fields.0.columns.0.key',
        'fields.0.columns.0.label',
        'fields.0.columns.0.type',
        'fields.0.columns.0.from',
      ]
    )

    // Tables only for table fields, never inline; properties only those listed
    const table = field('t', 'table', { columns: [column('a')] })
    const bodyRefused = { body: [it('validator.shared.messages.templateBody')] }
    for (const [fields, body] of [
      [[table], doc(paragraph(placeholder('field.t')))],
      [[field('s', 'site')], doc({ type: 'fieldTable', attrs: { key: 's' } })],
      [[table], doc({ type: 'fieldTable', attrs: { key: 'missing' } })],
      [[field('s', 'site')], doc(paragraph(placeholder('field.s.serial_number')))],
      [[field('n', 'text')], doc(paragraph(placeholder('field.n.city')))],
      // Not inside a list
      [
        [table],
        doc({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'fieldTable', attrs: { key: 't' } }] }],
        }),
      ],
    ] as const) {
      assert.deepEqual(await errorsFor([...fields], body), bodyRefused, JSON.stringify(body))
    }
    // Only the one with Equipment before its Site was saved
    assert.lengthOf(await DocumentTemplate.all(), 1)
  })

  test('the preview fills entity fields and tables with sample data', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')

    const response = await client
      .post('/settings/document-templates/preview')
      .json({ name: 'Rapporto', fields: entityFields, body: entityBody })
      .withCsrfToken()
      .loginAs(admin)

    response.assertStatus(200)
    const html = response.body().html as string
    assert.include(html, 'field.boiler.make=Vaillant')
    assert.include(html, 'field.site.city=Milano')
    assert.include(html, '<th>Quantità</th>')
    assert.include(html, '<td>VS-012</td>')
  })

  test('filling prints every entity property, escaped, and the table', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const { customer, site, boiler, job, valve, tee } = await world()
    const template = await saveTemplate()

    const response = await client
      .post(`/settings/document-templates/${template.id}/fill`)
      .json({
        customerId: customer.id,
        values: {
          site: site.id,
          boiler: boiler.id,
          job: job.id,
          part: valve.id,
          parts: [tee.id, valve.id],
          materials: [
            ['VS-1', '<b>Valvola</b>', '2,5', '2026-03-04'],
            ['', '', '', ''],
          ],
        },
      })
      .withCsrfToken()
      .loginAs(admin)

    response.assertStatus(200)
    const html = response.body().html as string
    for (const expected of [
      'field.site=Casa &lt;al mare&gt; — Via Roma 5, 20121 Como (MI)',
      'field.site.address=Via Roma 5, 20121 Como (MI)',
      'field.site.city=Como',
      'field.boiler=Caldaia — Vaillant &lt;&amp;&gt; ecoTEC',
      'field.boiler.make=Vaillant &lt;&amp;&gt;',
      'field.boiler.model=ecoTEC',
      'field.boiler.serial_number=SN-1',
      'field.boiler.installed_on=01/10/2024',
      `field.job=${job.number} – Sostituzione &lt;caldaia&gt;`,
      `field.job.number=${job.number}`,
      'field.job.title=Sostituzione &lt;caldaia&gt;',
      'field.part=Valvola &lt;1/2&quot;&gt;',
      'field.part.code=VS-1',
      'field.part.description=Valvola &lt;1/2&quot;&gt;',
      'field.parts=Raccordo a T, Valvola &lt;1/2&quot;&gt;',
      'recipient.name=Condominio &lt;Verdi&gt;',
      '<th>Codice</th><th>Descrizione</th><th>Quantità</th><th>Verificato il</th>',
      '<tr><td>VS-1</td><td>&lt;b&gt;Valvola&lt;/b&gt;</td><td>2,5</td><td>04/03/2026</td></tr>',
    ]) {
      assert.include(html, expected)
    }
    assert.notInclude(html, '<b>Valvola')
    // The blank row is left out
    assert.notInclude(html, '<tr><td></td>')
  })

  test('filling refuses records outside the scoping rules, by field', async ({
    client,
    assert,
  }) => {
    const admin = await createUser('admin')
    const { customer, site, boiler, valve } = await world()
    const otherSite = await createSite({ street: 'Via Milano' })
    const elsewhere = await InstalledEquipment.create({
      siteId: otherSite.id,
      equipmentType: 'Climatizzatore',
    })
    const removed = await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Scaldabagno',
      removedOn: DateTime.fromISO('2025-01-01'),
    })
    const archived = await createSite({ street: 'Via Vecchia', archivedAt: DateTime.now() })
    const otherJob = await createJob(await createCustomer({ name: 'Altro' }))
    const template = await saveTemplate()

    const errorsFor = async (values: Record<string, unknown>, customerId = customer.id) => {
      const response = await client
        .post(`/settings/document-templates/${template.id}/fill`)
        .json({ customerId, values })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(admin)
      response.assertStatus(422)
      return response.body().errors
    }

    assert.deepEqual(await errorsFor({ site: site.id, boiler: elsewhere.id }), {
      boiler: it('errors.templateData.equipment'),
    })
    assert.deepEqual(await errorsFor({ site: site.id, boiler: removed.id }), {
      boiler: it('errors.templateData.equipment'),
    })
    assert.deepEqual(await errorsFor({ site: site.id, boiler: boiler.id, job: otherJob.id }), {
      job: it('errors.templateData.job'),
    })
    assert.deepEqual(await errorsFor({ site: archived.id, boiler: boiler.id }), {
      site: it('errors.templateData.site'),
      boiler: it('errors.templateData.equipmentNeedsSite'),
    })
    assert.deepEqual(
      await errorsFor({
        site: site.id,
        boiler: boiler.id,
        part: 999_999,
        parts: [valve.id, 999_999],
        materials: [['x', 'y', 'tanti', '2026-01-01']],
      }),
      {
        part: it('errors.templateData.item'),
        parts: it('errors.templateData.item'),
        materials: it('errors.templateData.tableNumber', { row: 1 }),
      }
    )
    // Required fields
    assert.deepEqual(await errorsFor({}), {
      site: it('errors.templateData.required'),
      boiler: it('errors.templateData.required'),
    })
    assert.deepEqual(await errorsFor({}, 999_999), {
      customerId: it('errors.templateData.customer'),
    })
  })

  test('filling checks basic fields by type', async ({ client, assert }) => {
    const admin = await createUser('admin')
    const customer = await createCustomer()
    const template = await saveTemplate(
      [
        { key: 'name', label: 'Nome', type: 'text', required: true },
        { key: 'bar', label: 'Pressione', type: 'number', required: false },
        { key: 'day', label: 'Data', type: 'date', required: false },
        { key: 'ok', label: 'Esito', type: 'boolean', required: false },
        { key: 'kind', label: 'Tipo', type: 'choice', required: false, options: ['A', 'B'] },
      ],
      doc(paragraph(...['name', 'bar', 'day', 'ok', 'kind'].map((k) => placeholder(`field.${k}`))))
    )
    const fill = (values: Record<string, unknown>) =>
      client
        .post(`/settings/document-templates/${template.id}/fill`)
        .json({ customerId: customer.id, values })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(admin)

    const refused = await fill({
      name: ' ',
      bar: '1.234,5',
      day: '2026-02-30',
      ok: 'yes',
      kind: 'C',
    })
    refused.assertStatus(422)
    assert.deepEqual(refused.body().errors, {
      name: it('errors.templateData.required'),
      bar: it('errors.templateData.number'),
      day: it('errors.templateData.date'),
      ok: it('errors.templateData.invalid'),
      kind: it('errors.templateData.choice'),
    })

    const filled = await fill({ name: 'Mario', bar: '1,5', day: '2026-02-03', ok: true, kind: 'B' })
    filled.assertStatus(200)
    assert.include(filled.body().html, `<p>Mario1,503/02/2026${it('documents.template.yes')}B</p>`)
  })

  test('Equipment and Jobs to choose from, and the Items used on a Job', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { customer, site, boiler, job, valve, tee } = await world()
    await InstalledEquipment.create({
      siteId: site.id,
      equipmentType: 'Scaldabagno',
      removedOn: DateTime.fromISO('2025-01-01'),
    })
    const otherJob = await createJob(await createCustomer({ name: 'Altro' }))

    const equipment = await client.get(`/sites/${site.id}/installed-equipment`).loginAs(office)
    assert.deepEqual(equipment.body(), {
      equipment: [{ id: boiler.id, description: boiler.description }],
    })

    const jobs = await client.get(`/customers/${customer.id}/jobs`).loginAs(office)
    assert.deepEqual(jobs.body(), { jobs: [{ id: job.id, number: job.number, title: job.title }] })

    // The same Item on two Visits sums; labour and other Jobs don't count
    await itemCharge(job.id, tee.id, '1.5')
    await itemCharge(job.id, valve.id, '2')
    await itemCharge(job.id, tee.id, '2')
    await itemCharge(otherJob.id, valve.id, '7')
    const rate = await LabourRate.create({ name: 'Idraulico prova', hourlyPrice: '40' })
    await Charge.create({
      jobId: job.id,
      kind: 'labour',
      labourRateId: rate.id,
      workerName: 'Luigi',
      quantity: '3',
      billQuantity: '3',
      unitPrice: '40',
      description: 'Ore',
    })

    const used = await client.get(`/jobs/${job.id}/items-used`).loginAs(office)
    assert.deepEqual(used.body(), {
      items: [
        { id: tee.id, code: 'RT-2', description: 'Raccordo a T', unit: 'pz', quantity: '3,5' },
        { id: valve.id, code: 'VS-1', description: 'Valvola <1/2">', unit: 'pz', quantity: '2' },
      ],
    })
  })

  test('only the Admin tries templates; Technicians see no choices', async ({ client, assert }) => {
    const { customer, site, job } = await world()
    const template = await saveTemplate()
    const fill = { customerId: customer.id, values: {} }

    for (const role of ['office', 'technician', 'superuser'] as const) {
      const user = await createUser(role)
      const page = await client
        .get(`/settings/document-templates/${template.id}/fill`)
        .withInertia()
        .loginAs(user)
      page.assertStatus(403)
      const denied = await client
        .post(`/settings/document-templates/${template.id}/fill`)
        .json(fill)
        .header('referer', '/')
        .withCsrfToken()
        .loginAs(user)
        .redirects(0)
      denied.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
    }

    for (const role of ['technician', 'superuser'] as const) {
      const user = await createUser(role)
      for (const url of [
        `/sites/${site.id}/installed-equipment`,
        `/customers/${customer.id}/jobs`,
        `/jobs/${job.id}/items-used`,
      ]) {
        const response = await client.get(url).withInertia().loginAs(user)
        response.assertStatus(403)
      }
    }

    const admin = await createUser('admin')
    const page = await client
      .get(`/settings/document-templates/${template.id}/fill`)
      .withInertia()
      .loginAs(admin)
    page.assertInertiaPropsContains({ template: { id: template.id, fields: entityFields } })
    assert.lengthOf(await DocumentTemplate.all(), 1)
  })
})
