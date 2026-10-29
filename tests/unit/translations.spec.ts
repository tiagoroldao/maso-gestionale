import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ROLES } from '#models/user'
import { CUSTOMER_TYPES } from '#models/customer'
import { POLL_STEPS, SDI_FAILURE_CODES } from '#shared/sdi_failures'
import {
  ALL_PAYMENT_METHODS,
  DOCUMENT_TYPES,
  SUPPLIER_INVOICE_SOURCES,
  SUPPLIER_INVOICE_STATUSES,
} from '#shared/supplier_invoices'
import { EXPORT_COLUMNS } from '#services/supplier_invoice_export'

async function catalogue() {
  const directory = app.makePath('resources/lang/it')
  const keys = new Set<string>()
  const collect = (prefix: string, value: unknown) => {
    if (typeof value === 'string') keys.add(prefix)
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) collect(`${prefix}.${key}`, child)
    }
  }
  for (const file of await readdir(directory)) {
    collect(file.replace(/\.json$/, ''), JSON.parse(await readFile(join(directory, file), 'utf8')))
  }
  return keys
}

async function frontendSources(directory = app.makePath('inertia')): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return frontendSources(path)
      return /\.(vue|ts)$/.test(entry.name) ? [path] : []
    })
  )
  return files.flat()
}

test.group('Translations', () => {
  test('every key used in the Vue pages exists in the catalogue', async ({ assert }) => {
    const keys = await catalogue()
    const missing: string[] = []

    for (const file of await frontendSources()) {
      const source = await readFile(file, 'utf8')
      for (const [, key] of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!keys.has(key)) missing.push(`${key} (${file})`)
      }
    }

    assert.deepEqual(missing, [])
  })

  test('keys built at runtime exist for every value', async ({ assert }) => {
    const keys = await catalogue()
    const dynamic = [
      ...ROLES.map((role) => `ui.roles.${role}`),
      ...CUSTOMER_TYPES.map((type) => `ui.customers.types.${type}`),
      ...[
        'boiler',
        'waterHeater',
        'airConditioner',
        'heatPump',
        'solarThermal',
        'waterSoftener',
        'pressurePump',
      ].map((key) => `ui.equipment.commonTypes.${key}`),
      ...SUPPLIER_INVOICE_STATUSES.map((status) => `ui.supplierInvoices.statuses.${status}`),
      ...SUPPLIER_INVOICE_SOURCES.map((source) => `ui.supplierInvoices.sources.${source}`),
      ...DOCUMENT_TYPES.map((type) => `ui.supplierInvoices.documentTypes.${type}`),
      ...ALL_PAYMENT_METHODS.map((method) => `ui.supplierInvoices.paymentMethods.${method}`),
      ...['unreadable', 'unsupported', 'signature', 'duplicate', 'notForCompany'].map(
        (reason) => `flash.supplierInvoiceRefused.${reason}`
      ),
      ...EXPORT_COLUMNS.map((column) => `documents.supplierInvoiceExport.columns.${column}`),
      ...SUPPLIER_INVOICE_SOURCES.map(
        (source) => `documents.supplierInvoiceExport.receivedVia.${source}`
      ),
    ]

    assert.deepEqual(
      dynamic.filter((key) => !keys.has(key)),
      []
    )
  })

  test('every SDI failure code and poll step has its Italian text', async ({ assert }) => {
    // Pages build these keys at run time, so the usage check above can't see them
    const keys = await catalogue()
    const missing = [
      ...SDI_FAILURE_CODES.map((code) => `ui.sdiFailures.${code}`),
      ...POLL_STEPS.map((step) => `ui.instance.pollSteps.${step}`),
    ].filter((key) => !keys.has(key))
    assert.deepEqual(missing, [])
  })
})
