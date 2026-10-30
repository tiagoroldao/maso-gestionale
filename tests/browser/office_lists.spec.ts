import { readFile, rm } from 'node:fs/promises'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { Assert } from '@japa/assert'
import type { Page } from 'playwright'
import Invoice from '#models/invoice'
import Supplier from '#models/supplier'
import SupplierInvoices from '#services/supplier_invoices'
import { storagePath } from '#services/storage'
import { createUser } from '#tests/helpers/users'
import { createCustomer } from '#tests/helpers/customers'
import { createSite } from '#tests/helpers/sites'
import { createJob } from '#tests/helpers/jobs'
import { createItem } from '#tests/helpers/items'
import { completeCompany } from '#tests/helpers/company'
import { SUPPLIER_INVOICE_P7M, FIXTURE } from '#tests/helpers/supplier_invoices'
import { it } from '#tests/helpers/i18n'
import { seriousA11yViolations } from '#tests/helpers/axe'
import { SCREEN_SIZES } from '#shared/screen_sizes'

type ListCheck = {
  /** The list's heading */
  title: string
  /** "Nuovo …", where the list has one */
  primary: string | null
  /** The name of the record's link in its row; in the table, `cell` when it differs */
  row: string
  cell?: string
  /** Where the row goes */
  record: RegExp
}

/**
 * A list on the new UI (docs/ui.md "Lists", #238): on the phone a
 * top-level screen (the logo, no "‹"), its primary action in the bottom
 * bar, rows that open their record and no sideways scroll; on desktop the
 * primary in the header and the record's row in the table. No serious
 * accessibility violation at either size.
 */
async function checkList(page: Page, assert: Assert, list: ListCheck) {
  await page.setViewportSize(SCREEN_SIZES.phone)
  await page.getByRole('heading', { name: list.title, level: 1 }).waitFor()
  await page.getByRole('link', { name: it('ui.shell.wordmark') }).waitFor()
  assert.equal(await page.getByRole('link', { name: /^Indietro/ }).count(), 0, 'no "‹"')
  if (list.primary) {
    await page.getByTestId('primary-action').getByRole('link', { name: list.primary }).waitFor()
  }
  const sideways = await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth'
  )
  assert.isAtMost(sideways, 0, 'no sideways scroll on the phone')
  assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'phone')

  // The whole row opens the record, not only its name
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: list.row }) })
  const box = await row.boundingBox()
  await row.click({ position: { x: box!.width - 8, y: box!.height / 2 } })
  await page.waitForURL(list.record)
  await page.goBack()

  await page.setViewportSize(SCREEN_SIZES.desktop)
  if (list.primary) {
    await page.locator('main header').getByRole('link', { name: list.primary }).waitFor()
  }
  await page
    .getByRole('table')
    .getByRole('link', { name: list.cell ?? list.row })
    .waitFor()
  assert.deepEqual(await seriousA11yViolations(page, { content: true }), [], 'desktop')
}

test.group('Office lists in the browser', (group) => {
  group.each.teardown(() => rm(storagePath(), { recursive: true, force: true }))

  test('Commesse', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const job = await createJob(await createCustomer(), { title: 'Sostituzione caldaia' })

    const page = await visit('/jobs')
    await checkList(page, assert, {
      title: it('ui.jobs.title'),
      primary: it('ui.jobs.new'),
      row: job.number,
      record: new RegExp(`/jobs/${job.id}$`),
    })
  })

  test('Clienti', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Condominio Verdi' })

    const page = await visit('/customers')
    await checkList(page, assert, {
      title: it('ui.customers.title'),
      primary: it('ui.customers.new'),
      row: 'Condominio Verdi',
      record: new RegExp(`/customers/${customer.id}$`),
    })
  })

  test('Immobili', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const site = await createSite({ label: 'Centrale termica' })
    await site.refresh()

    const page = await visit('/sites')
    await checkList(page, assert, {
      title: it('ui.sites.title'),
      primary: it('ui.sites.new'),
      row: site.summary,
      record: new RegExp(`/sites/${site.id}$`),
    })
  })

  test('Articoli', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const item = await createItem({ code: 'RAC-12', description: 'Raccordo a T' })

    const page = await visit('/items')
    await checkList(page, assert, {
      title: it('ui.items.title'),
      primary: it('ui.items.new'),
      row: 'Raccordo a T',
      cell: 'RAC-12',
      record: new RegExp(`/items/${item.id}$`),
    })
  })

  test('Fatture', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const customer = await createCustomer({ name: 'Condominio Verdi' })
    const invoice = await Invoice.create({
      customerId: customer.id,
      documentType: 'legacy',
      status: 'delivered',
      legacyNumber: '7/2025',
      issuedOn: DateTime.fromISO('2025-03-01'),
      dueOn: DateTime.fromISO('2025-03-31'),
      taxable: '100.00',
      vat: '22.00',
      total: '122.00',
      pdfPath: 'invoices/legacy/original.pdf',
      pdfName: 'originale.pdf',
    })

    const page = await visit('/invoices')
    await checkList(page, assert, {
      title: it('ui.invoices.title'),
      primary: it('ui.invoices.new'),
      row: 'Condominio Verdi',
      record: new RegExp(`/invoices/${invoice.id}`),
    })
    await page
      .locator('main header')
      .getByRole('link', { name: it('ui.invoices.newLegacy') })
      .waitFor()
  })

  test('Fornitori', async ({ browserContext, visit, assert }) => {
    await browserContext.loginAs(await createUser('office'))
    const supplier = await Supplier.create({
      name: 'Idrotermica Srl',
      vatCountry: 'IT',
      vatNumber: '01234567890',
    })

    const page = await visit('/suppliers')
    await checkList(page, assert, {
      title: it('ui.suppliers.title'),
      primary: it('ui.suppliers.new'),
      row: 'Idrotermica Srl',
      record: new RegExp(`/suppliers/${supplier.id}/edit$`),
    })
  })

  test('Fatture passive', async ({ browserContext, visit, assert }) => {
    await completeCompany()
    const office = await createUser('office')
    const [invoice] = await SupplierInvoices.receive(
      { contents: await readFile(SUPPLIER_INVOICE_P7M), name: 'fattura.xml.p7m' },
      { via: 'upload', user: office }
    )
    await browserContext.loginAs(office)

    const page = await visit('/supplier-invoices')
    await checkList(page, assert, {
      title: it('ui.supplierInvoices.title'),
      primary: null,
      row: FIXTURE.supplierName,
      record: new RegExp(`/supplier-invoices/${invoice.id}$`),
    })
    await page
      .locator('main header')
      .getByRole('link', { name: it('ui.supplierInvoices.suppliers') })
      .waitFor()
  })

  test('a list over one page: Successiva and Precedente keep the search and filter', async ({
    browserContext,
    visit,
    assert,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    // 26 archived Rossi, one past a page of 25, and one the search leaves out
    for (let n = 1; n <= 26; n++) {
      await createCustomer({
        name: `Rossi ${String(n).padStart(2, '0')}`,
        vatNumber: `1234567${String(n).padStart(4, '0')}`,
        archivedAt: DateTime.now(),
      })
    }
    await createCustomer({ name: 'Bianchi Rossana', archivedAt: DateTime.now() })

    const page = await visit('/customers?archived=true')
    await page.getByLabel(it('ui.customers.searchLabel')).fill('Rossi')
    await page.getByRole('button', { name: it('ui.common.search') }).click()
    await page.waitForURL(/q=Rossi/)
    const pages = page.getByRole('navigation', { name: it('ui.common.paginationLabel') })
    await pages.getByText(it('ui.common.pagination', { current: 1, last: 2, total: 26 })).waitFor()
    assert.equal(await pages.getByRole('link', { name: it('ui.common.previous') }).count(), 0)

    await pages.getByRole('link', { name: it('ui.common.next') }).click()
    await page.waitForURL(/page=2/)
    const second = new URL(page.url()).searchParams
    assert.equal(second.get('q'), 'Rossi')
    assert.equal(second.get('archived'), 'true')
    await page.getByRole('table').getByRole('link', { name: 'Rossi 26' }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Rossi 01' }).count(), 0)
    assert.equal(await page.getByRole('link', { name: 'Bianchi Rossana' }).count(), 0)
    assert.equal(await pages.getByRole('link', { name: it('ui.common.next') }).count(), 0)

    await pages.getByRole('link', { name: it('ui.common.previous') }).click()
    await page.waitForURL(/page=1/)
    const first = new URL(page.url()).searchParams
    assert.equal(first.get('q'), 'Rossi')
    assert.equal(first.get('archived'), 'true')
    await page.getByRole('table').getByRole('link', { name: 'Rossi 01' }).waitFor()
  })

  test('a page past the last offers the way back to the last page', async ({
    browserContext,
    visit,
  }) => {
    await browserContext.loginAs(await createUser('office'))
    await createCustomer({ name: 'Condominio Verdi' })

    const page = await visit('/customers?q=Verdi&page=4')
    await page.getByText(it('ui.customers.noMatches', { q: 'Verdi' })).waitFor()
    await page
      .getByRole('navigation', { name: it('ui.common.paginationLabel') })
      .getByRole('link', { name: it('ui.common.backToLastPage') })
      .click()
    await page.waitForURL(/page=1/)
    await page.getByRole('table').getByRole('link', { name: 'Condominio Verdi' }).waitFor()
  })
})
