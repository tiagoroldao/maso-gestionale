import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from '@japa/runner'
import vine from '@vinejs/vine'
import app from '@adonisjs/core/services/app'
import i18nManager from '@adonisjs/i18n/services/main'
import { ROLES } from '#models/user'
import { CUSTOMER_TYPES } from '#models/customer'
import { QUOTE_LINE_KINDS } from '#models/quote_line'
import { STOCK_MOVEMENT_KINDS } from '#models/stock_movement'
import { VISIT_STATUSES } from '#models/visit'
import type { JobLeftovers } from '#services/jobs'
import { validationMessages } from '#validators/messages_provider'
import { ADVANCE_STATES } from '#shared/advances'
import { CHARGE_EVENT_KINDS, CHARGE_STATES, WORK_STATES } from '#shared/charges'
import { LIQUIDATION_STATUSES, SOLE_SHAREHOLDER } from '#shared/company'
import { CREDIT_NOTE_NUMBERING_MODES } from '#shared/credit_notes'
import {
  BUILT_IN_PLACEHOLDERS,
  ENTITY_PROPERTIES,
  FIELD_TYPES,
  TABLE_COLUMN_SOURCES,
  TABLE_COLUMN_TYPES,
} from '#shared/document_templates'
import { HOLIDAYS } from '#shared/holidays'
import { SDI_ENVIRONMENTS, SDI_MODES } from '#shared/instance'
import { INVOICE_STAGES, INVOICE_STATUSES, SUBMISSION_OUTCOMES } from '#shared/invoice_lifecycle'
import { ORGANISE_BY } from '#shared/invoice_sections'
import { JOB_FILTERS, JOB_STATUSES, WORK_CATEGORIES, type JobIndicators } from '#shared/jobs'
import { PAYMENT_STATUSES } from '#shared/payment_status'
import { PAYMENT_METHODS } from '#shared/payments'
import { QUOTE_STATUSES } from '#shared/quotes'
import { POLL_STEPS, SDI_FAILURE_CODES } from '#shared/sdi_failures'
import {
  ALL_PAYMENT_METHODS,
  DOCUMENT_TYPES,
  SUPPLIER_INVOICE_SOURCES,
  SUPPLIER_INVOICE_STATUSES,
  type LineReceiptRefusal,
} from '#shared/supplier_invoices'
import { LINE_KINDS } from '#shared/vat'
import { REPEAT_FREQUENCIES, WEEKDAYS } from '#shared/visit_repeats'
import { EXPORT_COLUMNS } from '#services/supplier_invoice_export'

/** The values of a type no list holds: typecheck keeps the object complete. */
const valuesOf = <Value extends string>(all: Record<Value, true>) => Object.keys(all)

/**
 * Keys the pages build at run time (`t(\`<prefix>.${value}\`)`), with every
 * value each prefix takes.
 */
const BUILT_IN_PAGES: Record<string, readonly (string | number)[]> = {
  'ui.roles': ROLES,
  'ui.customers.types': CUSTOMER_TYPES,
  'ui.invoices.paymentStatuses': PAYMENT_STATUSES,
  'ui.jobs.indicators': valuesOf<keyof JobIndicators>({
    workComplete: true,
    invoiced: true,
    paid: true,
  }),
  'ui.jobs.statuses': JOB_STATUSES,
  'ui.jobs.workCategories': WORK_CATEGORIES,
  'ui.jobs.filters': JOB_FILTERS,
  'ui.jobs.leftToClose': valuesOf<keyof JobLeftovers>({
    visits: true,
    charges: true,
    unpaid: true,
    overpaid: true,
    advances: true,
    drafts: true,
  }),
  'ui.quotes.statuses': QUOTE_STATUSES,
  'ui.quotes.kinds': QUOTE_LINE_KINDS,
  'ui.charges.vatKinds': LINE_KINDS,
  'ui.charges.workStates': WORK_STATES,
  'ui.charges.states': CHARGE_STATES,
  'ui.charges.events': CHARGE_EVENT_KINDS,
  'ui.visits.statuses': VISIT_STATUSES,
  'ui.visits.repeats': REPEAT_FREQUENCIES,
  'ui.visits.weekdayNames': WEEKDAYS,
  'ui.visits.holidays': HOLIDAYS,
  // A list inside installed_equipment/form.vue
  'ui.equipment.commonTypes': [
    'boiler',
    'waterHeater',
    'airConditioner',
    'heatPump',
    'solarThermal',
    'waterSoftener',
    'pressurePump',
  ],
  'ui.instance.pollSteps': POLL_STEPS,
  'ui.instance.sdiModes': SDI_MODES,
  'ui.instance.sdiEnvironments': SDI_ENVIRONMENTS,
  'ui.sdiFailures': SDI_FAILURE_CODES,
  'ui.invoices.organiseOptions': ORGANISE_BY,
  'ui.invoices.outcomes': SUBMISSION_OUTCOMES,
  'ui.invoices.statuses': INVOICE_STATUSES,
  'ui.invoices.stages': INVOICE_STAGES,
  'ui.invoices.advanceStates': ADVANCE_STATES,
  'ui.invoiceNumbering.creditNotesModes': CREDIT_NOTE_NUMBERING_MODES,
  'ui.items.kinds': STOCK_MOVEMENT_KINDS,
  'ui.company.soleShareholders': SOLE_SHAREHOLDER,
  'ui.company.liquidationStatuses': LIQUIDATION_STATUSES,
  'ui.documentTemplates.builtIn': BUILT_IN_PLACEHOLDERS,
  'ui.documentTemplates.properties': Object.values(ENTITY_PROPERTIES).flat(),
  'ui.documentTemplates.fieldTypes': FIELD_TYPES,
  'ui.documentTemplates.columnTypes': TABLE_COLUMN_TYPES,
  'ui.documentTemplates.columnSources': TABLE_COLUMN_SOURCES,
  'ui.paymentMethods': PAYMENT_METHODS,
  'ui.vatRules.lineKinds': LINE_KINDS,
  'ui.supplierInvoices.statuses': SUPPLIER_INVOICE_STATUSES,
  'ui.supplierInvoices.sources': SUPPLIER_INVOICE_SOURCES,
  'ui.supplierInvoices.documentTypes': DOCUMENT_TYPES,
  'ui.supplierInvoices.paymentMethods': ALL_PAYMENT_METHODS,
  'ui.supplierInvoices.refusals': valuesOf<LineReceiptRefusal>({
    creditNote: true,
    currency: true,
    negativeTotal: true,
  }),
}

/** Prefixes the pages build from values no list holds, so not checked here. */
const NOT_CHECKED: Record<string, string> = {
  'ui.charges.fields': 'the Charge values a correction changed, plain records in Charges service',
  'ui.suppliers': 'field names listed inside suppliers/form.vue',
}

/** Keys the server builds at run time, from lists it exports. */
const BUILT_ON_SERVER = [
  ...['unreadable', 'unsupported', 'signature', 'duplicate', 'notForCompany'].map(
    (reason) => `flash.supplierInvoiceRefused.${reason}`
  ),
  ...EXPORT_COLUMNS.map((column) => `documents.supplierInvoiceExport.columns.${column}`),
  ...SUPPLIER_INVOICE_SOURCES.map(
    (source) => `documents.supplierInvoiceExport.receivedVia.${source}`
  ),
]

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

/** The pages and the modules they share with the server. */
async function frontendSources(
  directories = [app.makePath('inertia'), app.makePath('shared')]
): Promise<string[]> {
  const files = await Promise.all(
    directories.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true })
      return Promise.all(
        entries.map((entry) => {
          const path = join(directory, entry.name)
          if (entry.isDirectory()) return frontendSources([path])
          return /\.(vue|ts)$/.test(entry.name) ? [path] : []
        })
      )
    })
  )
  return files.flat(2)
}

async function matchesInSources(pattern: RegExp) {
  const found: { key: string; file: string }[] = []
  for (const file of await frontendSources()) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      found.push({ key: match.at(-1)!, file: relative(app.makePath(), file) })
    }
  }
  return found
}

test.group('Translations', () => {
  test('every key written in the pages exists in the catalogue', async ({ assert }) => {
    const keys = await catalogue()
    // Any key in a string, passed to t() or kept for it ('ui.x' or `ui.x`); a
    // double-quoted one is a Vue attribute, an expression ("errors.email")
    const written = await matchesInSources(
      /(['`])((?:documents|errors|flash|ui|validator)\.[a-zA-Z0-9_.]*[a-zA-Z0-9_])\1/g
    )
    // A comment may name a group of keys (`ui.sdiFailures`)
    const groups = new Set(
      [...keys].flatMap((key) => key.split('.').map((_, i, parts) => parts.slice(0, i).join('.')))
    )

    assert.isAbove(written.length, 100)
    assert.deepEqual(
      written
        .filter(({ key }) => !keys.has(key) && !groups.has(key))
        .map(({ key, file }) => `${key} (${file})`),
      []
    )
  })

  test('every key the pages build at run time has its values listed', async ({ assert }) => {
    const built = await matchesInSources(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)

    assert.isAbove(built.length, 10)
    assert.deepEqual(
      built
        .filter(({ key }) => !(key in BUILT_IN_PAGES) && !(key in NOT_CHECKED))
        .map(({ key, file }) => `${key} (${file})`),
      []
    )
  })

  test('keys built at run time exist for every value', async ({ assert }) => {
    const keys = await catalogue()
    const built = [
      ...Object.entries(BUILT_IN_PAGES).flatMap(([prefix, values]) =>
        values.map((value) => `${prefix}.${value}`)
      ),
      ...BUILT_ON_SERVER,
    ]

    assert.deepEqual(
      built.filter((key) => !keys.has(key)),
      []
    )
  })

  test('a missing key throws under test', ({ assert }) => {
    const i18n = i18nManager.locale('it')
    assert.throws(
      () => i18n.t('ui.notInTheCatalogue'),
      'Missing translation: it, ui.notInTheCatalogue'
    )
  })

  test('a missing validation message or field name throws under test', async ({ assert }) => {
    const messagesProvider = validationMessages(i18nManager.locale('it'))

    // No catalogue message for the rule
    const noMessage = vine.create({ email: vine.string().alpha() })
    await assert.rejects(
      () => noMessage.validate({ email: 'a1' }, { messagesProvider }),
      'Missing validation message: email.alpha'
    )

    // A message naming a field the catalogue doesn't
    const noField = vine.create({ notInTheCatalogue: vine.string() })
    await assert.rejects(
      () => noField.validate({}, { messagesProvider }),
      'Missing validation field name: notInTheCatalogue'
    )
  })
})
