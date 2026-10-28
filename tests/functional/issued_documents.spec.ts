import { existsSync } from 'node:fs'
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime, Settings } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import i18nManager from '@adonisjs/i18n/services/main'
import Charge from '#models/charge'
import type Customer from '#models/customer'
import type DocumentTemplate from '#models/document_template'
import InstalledEquipment from '#models/installed_equipment'
import IssuedDocument from '#models/issued_document'
import Visit from '#models/visit'
import DocumentRenderer from '#documents/document_renderer'
import { issuedDocument } from '#documents/issued_document'
import { PdfConversionError, type PdfConverter } from '#documents/pdf_converter'
import DocumentTemplates from '#services/document_templates'
import IssuedDocuments from '#services/issued_documents'
import { storagePath } from '#services/storage'
import type { TemplateField, TemplateNode } from '#shared/document_templates'
import { completeCompany } from '#tests/helpers/company'
import { committedData } from '#tests/helpers/committed'
import { createCustomer } from '#tests/helpers/customers'
import { createItem } from '#tests/helpers/items'
import { createJob } from '#tests/helpers/jobs'
import { createSite } from '#tests/helpers/sites'
import { createUser } from '#tests/helpers/users'
import { it, ACCESS_DENIED_KEY } from '#tests/helpers/i18n'

const noConverter: PdfConverter = {
  convert: () => Promise.reject(new Error('renderHtml must not convert')),
}
const i18n = () => i18nManager.locale('it')
// A converter that "renders" the same bytes whatever the HTML
const converterOf = (bytes: string): PdfConverter => ({
  convert: async () => Buffer.from(bytes),
})

const placeholder = (key: string) => ({ type: 'placeholder', attrs: { key } })
const paragraph = (...content: object[]) => ({ type: 'paragraph', content })
const doc = (...content: object[]) => ({ type: 'doc', content })

const fields: TemplateField[] = [
  { key: 'site', label: 'Immobile', type: 'site', required: true },
  { key: 'boiler', label: 'Caldaia', type: 'equipment', required: false },
  { key: 'job', label: 'Commessa', type: 'job', required: false },
  { key: 'part', label: 'Ricambio', type: 'item', required: false },
  { key: 'parts', label: 'Materiali', type: 'items', required: false },
  { key: 'notes', label: 'Note', type: 'text', required: false },
  { key: 'day', label: 'Data prova', type: 'date', required: false },
  {
    key: 'checks',
    label: 'Prove',
    type: 'table',
    required: false,
    columns: [{ key: 'what', label: 'Prova', type: 'text' }],
  },
]

const body = doc(
  ...[
    'field.site',
    'field.site.address',
    'field.boiler',
    'field.boiler.serial_number',
    'field.job',
    'field.part',
    'field.parts',
    'field.notes',
    'field.day',
    'recipient.name',
    'company.name',
  ].map((key) => paragraph({ type: 'text', text: `${key}=` }, placeholder(key))),
  { type: 'fieldTable', attrs: { key: 'checks', label: 'Prove' } }
)

function saveTemplate(name = 'Dichiarazione di conformità') {
  return DocumentTemplates.create({ name, fields, body: body as TemplateNode })
}

/**
 * A Customer with a Site, a boiler at it, a Job at the Site and an Item.
 */
async function world() {
  const customer = await createCustomer({ name: 'Condominio Verdi' })
  const site = await createSite({ label: 'Casa al mare', street: 'Via Roma', city: 'Como' })
  await customer.related('sites').attach([site.id])
  const boiler = await InstalledEquipment.create({
    siteId: site.id,
    equipmentType: 'Caldaia',
    make: 'Vaillant',
    serialNumber: 'SN-1',
  })
  const job = await createJob(customer, { siteId: site.id, title: 'Sostituzione caldaia' })
  const valve = await createItem({ code: 'VS-1', description: 'Valvola a sfera' })
  return { customer, site, boiler, job, valve }
}

function itemCharge(jobId: number, itemId: number) {
  return Charge.create({
    jobId,
    kind: 'item',
    itemId,
    quantity: '1',
    billQuantity: '1',
    unitPrice: '1',
    description: 'x',
  })
}

async function htmlOf(document: IssuedDocument) {
  return new DocumentRenderer(noConverter).renderHtml(await issuedDocument(document, i18n()))
}

test.group('Issued Documents: issuing', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Office issues a numbered document with a frozen copy of its data', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { customer, site, boiler, job, valve } = await world()
    const template = await saveTemplate()
    const version = await DocumentTemplates.current(template)
    const values = {
      site: site.id,
      boiler: boiler.id,
      job: job.id,
      part: valve.id,
      parts: [valve.id],
      notes: 'Tutto regolare',
      day: '2026-03-02',
      checks: [['Tenuta'], [null]],
    }

    const response = await client
      .post('/issued-documents')
      .json({
        templateId: template.id,
        customerId: customer.id,
        // Keys that aren't the template's fields are not kept
        values: { ...values, junk: { nested: ['x'] }, constructor: 'y' },
      })
      .header('accept', 'application/json')
      .withCsrfToken()
      .loginAs(office)

    response.assertStatus(200)
    const year = DateTime.now().year
    response.assertBodyContains({ number: `${year}/0001` })
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.equal(document.documentTemplateId, template.id)
    assert.equal(document.documentTemplateVersionId, version.id)
    assert.equal(document.year, year)
    assert.equal(document.sequence, 1)
    assert.equal(document.issuedOn.toISODate(), DateTime.now().toISODate())
    assert.equal(document.customerId, customer.id)
    assert.equal(document.siteId, site.id)
    assert.equal(document.installedEquipmentId, boiler.id)
    assert.equal(document.jobId, job.id)
    assert.equal(document.createdBy, office.id)
    assert.isNull(document.replacedById)
    await customer.refresh()
    assert.deepEqual(document.recipient, customer.toRecipient())
    assert.equal(document.company.name, 'Idraulica Maso S.r.l.')
    assert.deepEqual(document.input, values)
    assert.include(document.values, {
      'field.site': site.summary,
      'field.boiler.serial_number': 'SN-1',
      'field.job': `${job.number} – Sostituzione caldaia`,
      'field.part': 'Valvola a sfera',
      'field.notes': 'Tutto regolare',
      'field.day': '02/03/2026',
      'recipient.name': 'Condominio Verdi',
      'company.name': 'Idraulica Maso S.r.l.',
    })
    assert.deepEqual(document.tables, { checks: { headers: ['Prova'], rows: [['Tenuta']] } })

    // The page shows it
    const page = await client.get(`/issued-documents/${document.id}`).withInertia().loginAs(office)
    page.assertInertiaComponent('issued_documents/show')
    page.assertInertiaPropsContains({
      document: {
        id: document.id,
        number: `${year}/0001`,
        title: 'Dichiarazione di conformità',
        site: { id: site.id, summary: site.summary },
        replacedBy: null,
        replaces: null,
        canReplace: true,
      },
    })
  })

  test('numbers count per template and per year', async ({ assert }) => {
    const user = await createUser('office')
    const { customer, site } = await world()
    const first = await saveTemplate('Dichiarazione di conformità')
    const second = await saveTemplate('Libretto di impianto')
    const issue = async (template: DocumentTemplate) => {
      const document = await IssuedDocuments.issue(
        template,
        customer,
        { site: site.id },
        i18n(),
        user
      )
      return document.number
    }

    const year = DateTime.now().year
    const numbers = []
    for (const template of [first, first, second, first]) numbers.push(await issue(template))
    assert.deepEqual(numbers, [`${year}/0001`, `${year}/0002`, `${year}/0001`, `${year}/0003`])

    // A new year starts again from 1, dated in that year
    const nextYear = DateTime.fromObject({ year: year + 1, month: 1, day: 1, hour: 9 })
    Settings.now = () => nextYear.toMillis()
    try {
      assert.equal(await issue(first), `${year + 1}/0001`)
      const january = await IssuedDocument.query()
        .where('year', year + 1)
        .firstOrFail()
      assert.equal(january.issuedOn.toISODate(), `${year + 1}-01-01`)
    } finally {
      Settings.now = () => Date.now()
    }
    assert.equal(await issue(first), `${year}/0004`)
  })

  test('the PDF prints only the frozen copy', async ({ client, assert }) => {
    const office = await createUser('office')
    await completeCompany()
    const { customer, site, boiler, valve } = await world()
    const template = await saveTemplate()
    const document = await IssuedDocuments.issue(
      template,
      customer,
      { site: site.id, boiler: boiler.id, part: valve.id, notes: 'Prima' },
      i18n(),
      office
    )
    const before = await htmlOf(document)
    assert.include(before, 'field.boiler.serial_number=SN-1')
    assert.include(before, 'field.part=Valvola a sfera')
    assert.include(before, 'Condominio Verdi')
    assert.include(before, `Dichiarazione di conformità n. ${document.number}`)

    // Everything it was made from changes afterwards
    await site.merge({ label: 'Casa in montagna', street: 'Via Nuova' }).save()
    await boiler.merge({ serialNumber: 'SN-2', make: 'Baxi' }).save()
    await valve.merge({ description: 'Valvola nuova', archivedAt: DateTime.now() }).save()
    await customer.merge({ name: 'Condominio Rossi', street: 'Via Altra' }).save()
    await completeCompany({ name: 'Altra azienda S.r.l.', street: 'Via Diversa' })
    await DocumentTemplates.save(template, {
      name: 'Nuovo titolo',
      fields: [],
      body: doc(paragraph({ type: 'text', text: 'Altro testo' })) as TemplateNode,
    })

    await document.refresh()
    assert.equal(await htmlOf(document), before)

    // The PDF route renders it (real Gotenberg)
    const pdf = await client.get(`/issued-documents/${document.id}/pdf`).loginAs(office)
    pdf.assertStatus(200)
    pdf.assertHeader('content-type', 'application/pdf')
  })

  test('a Job at another Site is refused on the Job field', async ({ client, assert }) => {
    const office = await createUser('office')
    const { customer, site } = await world()
    const elsewhere = await createSite({ street: 'Via Lontana' })
    const otherJob = await createJob(customer, { siteId: elsewhere.id })
    const noSiteJob = await createJob(customer, { siteId: null })
    const template = await saveTemplate()
    const issue = (job: number) =>
      client
        .post('/issued-documents')
        .json({ templateId: template.id, customerId: customer.id, values: { site: site.id, job } })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(office)

    const refused = await issue(otherJob.id)
    refused.assertStatus(422)
    assert.deepEqual(refused.body().errors, { job: it('errors.templateData.jobSite') })
    assert.lengthOf(await IssuedDocument.all(), 0)

    // A Job with no Site doesn't contradict the Site field
    const accepted = await issue(noSiteJob.id)
    accepted.assertStatus(200)
  })

  test('an archived Item only when used on the chosen Job', async ({ client, assert }) => {
    const office = await createUser('office')
    const { customer, site, job, valve } = await world()
    const other = await createJob(customer, { siteId: site.id })
    await itemCharge(job.id, valve.id)
    await valve.merge({ archivedAt: DateTime.now() }).save()
    const template = await saveTemplate()
    const issue = (values: Record<string, unknown>) =>
      client
        .post('/issued-documents')
        .json({ templateId: template.id, customerId: customer.id, values })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(office)

    for (const values of [
      { site: site.id, part: valve.id },
      { site: site.id, job: other.id, parts: [valve.id] },
    ]) {
      const refused = await issue(values)
      refused.assertStatus(422)
      const key = 'part' in values ? 'part' : 'parts'
      assert.deepEqual(refused.body().errors, { [key]: it('errors.templateData.archivedItem') })
    }
    assert.lengthOf(await IssuedDocument.all(), 0)

    const accepted = await issue({ site: site.id, job: job.id, part: valve.id, parts: [valve.id] })
    accepted.assertStatus(200)
  })

  test('an archived template or Customer can not be issued', async ({ client, assert }) => {
    const office = await createUser('office')
    const { customer, site } = await world()
    const template = await saveTemplate()
    const issue = () =>
      client
        .post('/issued-documents')
        .json({ templateId: template.id, customerId: customer.id, values: { site: site.id } })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(office)

    await template.merge({ archivedAt: DateTime.now() }).save()
    const archived = await issue()
    archived.assertStatus(422)
    assert.deepEqual(archived.body().errors, {
      templateId: it('errors.issuedDocuments.templateArchived'),
    })

    await template.merge({ archivedAt: null }).save()
    await customer.merge({ archivedAt: DateTime.now() }).save()
    const archivedCustomer = await issue()
    archivedCustomer.assertStatus(422)
    assert.deepEqual(archivedCustomer.body().errors, {
      customerId: it('errors.templateData.customer'),
    })
    assert.lengthOf(await IssuedDocument.all(), 0)
  })

  test('the filling page starts from a template and an optional Customer', async ({ client }) => {
    const office = await createUser('office')
    const customer = await createCustomer()
    const template = await saveTemplate()
    const archived = await saveTemplate('Vecchio modello')
    await archived.merge({ archivedAt: DateTime.now() }).save()

    const choose = await client
      .get(`/issued-documents/create?customerId=${customer.id}`)
      .withInertia()
      .loginAs(office)
    choose.assertInertiaComponent('issued_documents/create')
    choose.assertInertiaPropsContains({
      templates: [{ id: template.id, name: 'Dichiarazione di conformità' }],
      template: null,
      customer: { id: customer.id, displayName: customer.displayName, city: customer.city },
    })

    const fill = await client
      .get(`/issued-documents/create?templateId=${template.id}&customerId=${customer.id}`)
      .withInertia()
      .loginAs(office)
    fill.assertInertiaPropsContains({
      template: { id: template.id, name: 'Dichiarazione di conformità', fields },
    })
  })
})

test.group('Issued Documents: replacing', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('a replacement is prefilled, takes the next number and marks the original', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    const { customer, site, boiler, job, valve } = await world()
    const template = await saveTemplate()
    const input = {
      site: site.id,
      boiler: boiler.id,
      job: job.id,
      parts: [valve.id],
      notes: 'Prima',
      day: '2026-03-02',
      checks: [['Tenuta']],
    }
    const original = await IssuedDocuments.issue(template, customer, input, i18n(), office)
    const other = await IssuedDocuments.issue(template, customer, { site: site.id }, i18n(), office)

    // The Item is archived since; the replacement may keep it
    await valve.merge({ archivedAt: DateTime.now() }).save()

    const form = await client
      .get(`/issued-documents/${original.id}/replace`)
      .withInertia()
      .loginAs(office)
    form.assertInertiaComponent('issued_documents/create')
    form.assertInertiaPropsContains({
      replaces: { id: original.id, number: original.number },
      customer: { id: customer.id, displayName: customer.displayName, city: customer.city },
      prefill: {
        site: { id: site.id, label: site.summary },
        boiler: { id: boiler.id, label: boiler.description },
        job: { id: job.id, label: `${job.number} – ${job.title}` },
        parts: [{ id: valve.id, label: 'Valvola a sfera' }],
        notes: 'Prima',
        day: '2026-03-02',
        checks: [['Tenuta']],
      },
    })

    const response = await client
      .post(`/issued-documents/${original.id}/replace`)
      .json({ customerId: customer.id, values: { ...input, job: null, notes: 'Corretta' } })
      .header('accept', 'application/json')
      .withCsrfToken()
      .loginAs(office)
    response.assertStatus(200)

    const replacement = await IssuedDocument.findOrFail(response.body().id)
    assert.equal(replacement.documentTemplateId, template.id)
    assert.equal(replacement.sequence, other.sequence + 1)
    assert.equal(replacement.values['field.notes'], 'Corretta')
    await original.refresh()
    assert.equal(original.replacedById, replacement.id)
    // The original keeps its number and copy
    assert.equal(original.sequence, 1)
    assert.equal(original.values['field.notes'], 'Prima')
    assert.include(await htmlOf(replacement), `n. ${original.number}`)

    // The original stays viewable, linked to its replacement
    const page = await client.get(`/issued-documents/${original.id}`).withInertia().loginAs(office)
    page.assertInertiaPropsContains({
      document: {
        id: original.id,
        replacedBy: { id: replacement.id, number: replacement.number },
        canReplace: false,
      },
    })
    const replacementPage = await client
      .get(`/issued-documents/${replacement.id}`)
      .withInertia()
      .loginAs(office)
    replacementPage.assertInertiaPropsContains({
      document: { replaces: { id: original.id, number: original.number } },
    })
  })

  test('an original is replaced only once', async ({ client, assert }) => {
    const office = await createUser('office')
    const { customer, site } = await world()
    const template = await saveTemplate()
    const original = await IssuedDocuments.issue(
      template,
      customer,
      { site: site.id },
      i18n(),
      office
    )
    const replace = () =>
      client
        .post(`/issued-documents/${original.id}/replace`)
        .json({ customerId: customer.id, values: { site: site.id } })
        .header('accept', 'application/json')
        .withCsrfToken()
        .loginAs(office)

    const first = await replace()
    first.assertStatus(200)
    const again = await replace()
    again.assertStatus(422)
    assert.deepEqual(again.body().errors, {
      templateId: it('errors.issuedDocuments.alreadyReplaced'),
    })
    // No number was taken by the refusal
    assert.lengthOf(await IssuedDocument.all(), 2)

    const form = await client
      .get(`/issued-documents/${original.id}/replace`)
      .header('referer', `/issued-documents/${original.id}`)
      .loginAs(office)
      .redirects(0)
    form.assertFlashMessage('error', it('errors.issuedDocuments.alreadyReplaced'))
  })
})

test.group('Issued Documents: frozen', () => {
  test('the database refuses changes and deletes, but sets replaced_by once', async ({
    assert,
  }) => {
    const user = await createUser('office')
    const { customer, site } = await world()
    const template = await saveTemplate()
    const issue = () => IssuedDocuments.issue(template, customer, { site: site.id }, i18n(), user)
    const document = await issue()
    const replacement = await issue()
    const other = await issue()
    // Each in its own savepoint: a refused statement aborts its transaction
    const change = (
      write: (rows: ReturnType<TransactionClientContract['from']>) => Promise<unknown>
    ) => db.transaction((trx) => write(trx.from('issued_documents').where('id', document.id)))
    const refused = /Issued Documents can not be changed/

    await assert.rejects(() => change((rows) => rows.update({ values: '{"x":"y"}' })), refused)
    await assert.rejects(() => change((rows) => rows.delete()), refused)
    // Setting replaced_by_id together with another column
    await assert.rejects(
      () => change((rows) => rows.update({ replaced_by_id: replacement.id, sequence: 99 })),
      refused
    )

    await change((rows) => rows.update({ replaced_by_id: replacement.id }))
    // Once only: not changed, not cleared
    await assert.rejects(() => change((rows) => rows.update({ replaced_by_id: other.id })), refused)
    await assert.rejects(() => change((rows) => rows.update({ replaced_by_id: null })), refused)
    await document.refresh()
    assert.equal(document.replacedById, replacement.id)
    assert.equal(document.sequence, 1)

    // The PDF path, likewise once
    await change((rows) => rows.update({ pdf_path: 'issued-documents/a.pdf' }))
    await assert.rejects(
      () => change((rows) => rows.update({ pdf_path: 'issued-documents/b.pdf' })),
      refused
    )
    await assert.rejects(() => change((rows) => rows.update({ pdf_path: null })), refused)
    await document.refresh()
    assert.equal(document.pdfPath, 'issued-documents/a.pdf')
  })

  test('a document is replaced only by a later one, and the table is never truncated', async ({
    assert,
  }) => {
    const user = await createUser('office')
    const { customer, site } = await world()
    const template = await saveTemplate()
    const issue = () => IssuedDocuments.issue(template, customer, { site: site.id }, i18n(), user)
    const earlier = await issue()
    const later = await issue()

    await assert.rejects(
      () =>
        db.transaction((trx) =>
          trx.from('issued_documents').where('id', later.id).update({ replaced_by_id: earlier.id })
        ),
      /issued_documents_replaced_by_check/
    )
    await assert.rejects(
      () => db.transaction((trx) => trx.rawQuery('TRUNCATE issued_documents CASCADE')),
      /Issued Documents can not be changed/
    )
    assert.lengthOf(await IssuedDocument.all(), 2)
  })
})

test.group('Issued Documents: stored PDF', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('the PDF is stored the first time and served unchanged afterwards', async ({ assert }) => {
    const user = await createUser('office')
    const { customer, site } = await world()
    const template = await saveTemplate()
    const document = await IssuedDocuments.issue(
      template,
      customer,
      { site: site.id },
      i18n(),
      user
    )
    const down: PdfConverter = {
      convert: () => Promise.reject(new PdfConversionError('Gotenberg is down')),
    }

    // Gotenberg down: the document exists, without a PDF yet
    await assert.rejects(
      () => IssuedDocuments.pdf(document, i18n(), new DocumentRenderer(down)),
      PdfConversionError
    )
    await document.refresh()
    assert.isNull(document.pdfPath)

    const first = await IssuedDocuments.pdf(
      document,
      i18n(),
      new DocumentRenderer(converterOf('A'))
    )
    assert.equal(first.toString(), 'A')
    await document.refresh()
    assert.match(
      document.pdfPath!,
      new RegExp(`^issued-documents/${document.id}/[0-9a-f-]+\\.pdf$`)
    )
    assert.equal(await readFile(storagePath(document.pdfPath!), 'utf8'), 'A')

    // A later rendering would differ (another logo, layout or renderer): not used
    await completeCompany({ logoFile: 'company/other-logo.png' })
    await DocumentTemplates.save(template, {
      name: 'Nuovo titolo',
      fields,
      body: body as TemplateNode,
    })
    const again = await IssuedDocuments.pdf(
      document,
      i18n(),
      new DocumentRenderer(converterOf('B'))
    )
    assert.equal(again.toString(), 'A')
  })

  test('issuing over HTTP stores the PDF, which the PDF routes serve', async ({
    client,
    assert,
  }) => {
    const office = await createUser('office')
    await completeCompany()
    const { customer, site } = await world()
    const template = await saveTemplate()

    const response = await client
      .post('/issued-documents')
      .json({ templateId: template.id, customerId: customer.id, values: { site: site.id } })
      .header('accept', 'application/json')
      .withCsrfToken()
      .loginAs(office)
    response.assertStatus(200)
    const document = await IssuedDocument.findOrFail(response.body().id)
    assert.isNotNull(document.pdfPath)
    assert.isTrue(existsSync(storagePath(document.pdfPath!)))
    // Swapped for known bytes: the route must serve the stored file as it is
    await writeFile(storagePath(document.pdfPath!), '%PDF-stored')

    await completeCompany({ name: 'Altra azienda S.r.l.' })
    const pdf = await client.get(`/issued-documents/${document.id}/pdf`).loginAs(office)
    pdf.assertStatus(200)
    pdf.assertHeader('content-type', 'application/pdf')
    pdf.assertHeader('content-length', String('%PDF-stored'.length))
    await document.refresh()
    assert.isTrue(document.pdfPath!.startsWith(`issued-documents/${document.id}/`))
  })
})

test.group('Issued Documents: history', () => {
  test('Customer, Site and Installed Equipment pages list them', async ({ client, assert }) => {
    const office = await createUser('office')
    const { customer, site, boiler } = await world()
    const otherSite = await createSite({ street: 'Via Lontana' })
    const template = await saveTemplate()
    const issue = (values: Record<string, unknown>, who: Customer = customer) =>
      IssuedDocuments.issue(template, who, values, i18n(), office)
    const withBoiler = await issue({ site: site.id, boiler: boiler.id })
    const atSite = await issue({ site: site.id })
    const elsewhere = await issue({ site: otherSite.id })
    const otherCustomer = await createCustomer({ name: 'Altro cliente' })
    const theirs = await issue({ site: site.id }, otherCustomer)
    // Replaced ones stay, marked
    await db
      .from('issued_documents')
      .where('id', withBoiler.id)
      .update({ replaced_by_id: atSite.id })

    const ids = (props: unknown) =>
      (props as { id: number; replaced: boolean }[]).map((row) => [row.id, row.replaced])

    const customerPage = await client.get(`/customers/${customer.id}`).withInertia().loginAs(office)
    assert.deepEqual(ids(customerPage.inertiaProps.issuedDocuments), [
      [elsewhere.id, false],
      [atSite.id, false],
      [withBoiler.id, true],
    ])
    const sitePage = await client.get(`/sites/${site.id}`).withInertia().loginAs(office)
    assert.deepEqual(ids(sitePage.inertiaProps.issuedDocuments), [
      [theirs.id, false],
      [atSite.id, false],
      [withBoiler.id, true],
    ])
    const equipmentPage = await client
      .get(`/equipment/${boiler.id}/edit`)
      .withInertia()
      .loginAs(office)
    assert.deepEqual(ids(equipmentPage.inertiaProps.issuedDocuments), [[withBoiler.id, true]])
    assert.containsSubset(customerPage.inertiaProps.issuedDocuments, [
      {
        id: withBoiler.id,
        number: withBoiler.number,
        title: 'Dichiarazione di conformità',
        issuedOn: DateTime.now().toISODate(),
        customer: 'Condominio Verdi',
      },
    ])
  })
})

test.group('Issued Documents: access', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  /**
   * A Visit at the world's Site, assigned to `technicianIds`, with an Item
   * Document for the boiler's Item.
   */
  async function visitWorld(technicianIds: number[]) {
    const office = await createUser('office')
    const data = await world()
    const manual = await data.valve.related('documents').create({
      title: 'Manuale',
      filePath: 'items/manual.pdf',
      originalName: 'manual.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    })
    await mkdir(storagePath('items'), { recursive: true })
    await writeFile(storagePath('items/manual.pdf'), '%PDF')
    await data.boiler.merge({ itemId: data.valve.id }).save()
    const startsAt = DateTime.now().plus({ hours: 1 })
    const visit = await Visit.create({
      jobId: data.job.id,
      startsAt,
      endsAt: startsAt.plus({ hours: 2 }),
      status: 'planned',
    })
    await visit.related('technicians').attach(technicianIds)
    const template = await saveTemplate()
    const document = await IssuedDocuments.issue(
      template,
      data.customer,
      { site: data.site.id },
      i18n(),
      office
    )
    return { ...data, office, manual, visit, template, document }
  }

  test('Technicians open the Site documents from a Visit they are assigned to', async ({
    client,
    assert,
  }) => {
    const anna = await createUser('technician')
    const { visit, document, manual, template, customer, office } = await visitWorld([anna.id])
    const otherSite = await createSite({ street: 'Via Lontana' })
    const elsewhere = await IssuedDocuments.issue(
      template,
      customer,
      { site: otherSite.id },
      i18n(),
      office
    )
    const replacement = await IssuedDocuments.issue(
      template,
      customer,
      { site: document.siteId },
      i18n(),
      office,
      document
    )

    const page = await client.get(`/my-visits/${visit.id}`).withInertia().loginAs(anna)
    page.assertInertiaComponent('field/show')
    // The one in force, not the one it replaced; no prices anywhere
    assert.deepEqual(page.inertiaProps.issuedDocuments, [
      {
        id: replacement.id,
        title: 'Dichiarazione di conformità',
        number: replacement.number,
        issuedOn: DateTime.now().toISODate(),
      },
    ])

    const pdf = await client
      .get(`/my-visits/${visit.id}/issued-documents/${replacement.id}`)
      .loginAs(anna)
    pdf.assertStatus(200)
    pdf.assertHeader('content-type', 'application/pdf')
    const opened = await client
      .get(`/my-visits/${visit.id}/item-documents/${manual.id}`)
      .loginAs(anna)
    opened.assertStatus(200)

    // Not another Site's, nor a replaced one
    for (const id of [elsewhere.id, document.id]) {
      const refused = await client
        .get(`/my-visits/${visit.id}/issued-documents/${id}`)
        .loginAs(anna)
      refused.assertStatus(404)
    }
  })

  test('Admin and Office open them from any Visit too', async ({ client }) => {
    const { visit, document, manual } = await visitWorld([])
    for (const role of ['admin', 'office'] as const) {
      const user = await createUser(role)
      const pdf = await client
        .get(`/my-visits/${visit.id}/issued-documents/${document.id}`)
        .loginAs(user)
      pdf.assertStatus(200)
      pdf.assertHeader('content-type', 'application/pdf')
      const opened = await client
        .get(`/my-visits/${visit.id}/item-documents/${manual.id}`)
        .loginAs(user)
      opened.assertStatus(200)
    }
  })

  test('Technicians are refused from a Visit they are not on, and everywhere else', async ({
    client,
  }) => {
    const anna = await createUser('technician')
    const bruno = await createUser('technician')
    const { visit, document, manual, valve } = await visitWorld([anna.id])
    const unrelated = await valve.related('documents').create({
      title: 'Altro',
      filePath: 'items/manual.pdf',
      originalName: 'altro.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
    })

    for (const url of [
      `/my-visits/${visit.id}/issued-documents/${document.id}`,
      `/my-visits/${visit.id}/item-documents/${manual.id}`,
    ]) {
      const refused = await client.get(url).loginAs(bruno)
      refused.assertStatus(403)
    }
    // A document of an Item not installed at the Site
    const otherItem = await createItem({ code: 'ALT' })
    await unrelated.merge({ itemId: otherItem.id }).save()
    const notHere = await client
      .get(`/my-visits/${visit.id}/item-documents/${unrelated.id}`)
      .loginAs(anna)
    notHere.assertStatus(404)
  })

  test('only Admin and Office issue, open and replace', async ({ client, assert }) => {
    const technician = await createUser('technician')
    const superuser = await createUser('superuser')
    const admin = await createUser('admin')
    const { document, customer, site, template, visit } = await visitWorld([technician.id])
    const input = { templateId: template.id, customerId: customer.id, values: { site: site.id } }

    for (const user of [technician, superuser]) {
      for (const url of [
        '/issued-documents/create',
        `/issued-documents/${document.id}`,
        `/issued-documents/${document.id}/pdf`,
        `/issued-documents/${document.id}/replace`,
      ]) {
        const response = await client.get(url).loginAs(user)
        response.assertStatus(403)
      }
      for (const url of ['/issued-documents', `/issued-documents/${document.id}/replace`]) {
        const response = await client
          .post(url)
          .json(input)
          .header('referer', '/')
          .withCsrfToken()
          .loginAs(user)
          .redirects(0)
        response.assertFlashMessage('error', it(ACCESS_DENIED_KEY))
      }
    }
    // The Superuser has no business access, Visits included
    const fromVisit = await client
      .get(`/my-visits/${visit.id}/issued-documents/${document.id}`)
      .loginAs(superuser)
    fromVisit.assertStatus(403)
    assert.lengthOf(await IssuedDocument.all(), 1)
    await document.refresh()
    assert.isNull(document.replacedById)

    // The Admin can, as Office (tested above)
    const issued = await client
      .post('/issued-documents')
      .json(input)
      .header('accept', 'application/json')
      .withCsrfToken()
      .loginAs(admin)
    issued.assertStatus(200)
  })
})

test.group('Issued Documents: concurrency', () => {
  test('numbers never collide across connections', async ({ assert, cleanup }) => {
    const cleanupRows = await committedData()
    cleanup(cleanupRows)
    const user = await createUser('office')
    const customer = await createCustomer()
    const site = await createSite()
    const first = await saveTemplate('Primo modello concorrente')
    const second = await saveTemplate('Secondo modello concorrente')

    // Separate pooled connections: real locks, unlike the global transaction
    const issued = await Promise.all(
      [first, second, first, second, first, second].map((template) =>
        IssuedDocuments.issue(template, customer, { site: site.id }, i18n(), user)
      )
    )

    const sequences = (template: DocumentTemplate) =>
      issued
        .filter((document) => document.documentTemplateId === template.id)
        .map((document) => document.sequence)
        .sort((a, b) => a - b)
    assert.deepEqual(sequences(first), [1, 2, 3])
    assert.deepEqual(sequences(second), [1, 2, 3])
  }).tags(['@committed'])
})
