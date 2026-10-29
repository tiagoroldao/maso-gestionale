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
import { ORGANISE_BY, SECTION_KINDS } from '#shared/invoice_sections'
import { JOB_FILTERS, JOB_STATUSES, WORK_CATEGORIES, type JobIndicators } from '#shared/jobs'
import { PAYMENT_STATUSES } from '#shared/payment_status'
import { PAYMENT_METHODS } from '#shared/payments'
import { QUOTE_STATUSES } from '#shared/quotes'
import { POLL_STEPS, SDI_FAILURE_CODES } from '#shared/sdi_failures'
import {
  ALL_PAYMENT_METHODS,
  DOCUMENT_TYPES,
  SUPPLIER_INVOICE_SOURCES,
  LEGAL_ARCHIVING_STATES,
  SUPPLIER_INVOICE_STATUSES,
  type LineReceiptRefusal,
} from '#shared/supplier_invoices'
import { LINE_KINDS } from '#shared/vat'
import { REPEAT_FREQUENCIES, WEEKDAYS } from '#shared/visit_repeats'
import { EXPORT_COLUMNS } from '#services/supplier_invoice_export'
import type { ChargeRefusedError } from '#services/charges'
import type { FieldWorkRefusedError } from '#services/field_work'
import type { CreditNoteRefusedError, InvoiceNotFinalisableError } from '#services/invoices'
import type { EquipmentWarning } from '#services/installations'
import type { IssuingRefusedError } from '#services/issued_documents'
import type { LegacyInvoiceRefusedError } from '#services/legacy_invoices'
import type { PaymentRemovalWarning, PaymentWarning } from '#services/payments'
import type { QuoteImportRefusedError } from '#services/quotes'
import type { VisitCancelRefusedError } from '#services/scheduling'
import type { LineRefusedError } from '#services/supplier_invoice_lines'
import type { SupplierInvoiceRefusedError } from '#services/supplier_invoices'
import type { ArchivingRefusedError } from '#services/supplier_invoice_archiving'
import type { WorkReportLabels } from '#shared/work_report'

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
  'ui.supplierInvoices.legalArchivingStates': LEGAL_ARCHIVING_STATES,
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

/**
 * Keys the server builds at run time (`i18n.t(\`<prefix>.${value}\`)`), with
 * every value each prefix takes. Refusal reasons are listed through their
 * error's type, so typecheck fails when a reason is added or removed.
 */
const BUILT_ON_SERVER: Record<string, readonly (string | number)[]> = {
  'flash.chargeRefused': valuesOf<ChargeRefusedError['reason']>({
    billed: true,
    credited: true,
    notBilled: true,
    closed: true,
    cancelled: true,
    archived: true,
    worker: true,
    frozen: true,
    inDraft: true,
    visitOpen: true,
    visitCancelled: true,
    wholeQuantity: true,
  }),
  // Office marks done or not done; planned is never flashed
  'flash.chargeWork': WORK_STATES.filter((state) => state !== 'planned'),
  'flash.creditNoteNumbering': CREDIT_NOTE_NUMBERING_MODES,
  'flash.invoiceNotFinalisable': valuesOf<InvoiceNotFinalisableError['reason']>({
    empty: true,
    companyIncomplete: true,
    negativeTotal: true,
    deductionTooLarge: true,
    belowDeducted: true,
    belowDeductedRow: true,
    jobClosed: true,
    creditTooLarge: true,
    uncreditedLine: true,
    partialDeduction: true,
    lineCreditTooLarge: true,
    negativeCredit: true,
    deductionGivenBack: true,
    legacyVatRow: true,
    vatCreditTooLarge: true,
  }),
  'flash.creditNoteRefused': valuesOf<CreditNoteRefusedError['reason']>({
    creditNote: true,
    notIssued: true,
    advanceTakenBack: true,
  }),
  'flash.submissionOutcome': SUBMISSION_OUTCOMES,
  'flash.paymentWarning': valuesOf<PaymentWarning['reason']>({
    overpaid: true,
    refundBeyondOverpaid: true,
    beforeIssued: true,
  }),
  'flash.paymentRemovedWarning': valuesOf<PaymentRemovalWarning['reason']>({
    overpaid: true,
    owing: true,
  }),
  'flash.legacyInvoiceRefused': valuesOf<LegacyInvoiceRefusedError['reason']>({
    advanceWithoutJob: true,
    noVatRows: true,
    duplicateVatRow: true,
    rowsTaxable: true,
    rowsVat: true,
    advanceTotal: true,
    customerNotOfJob: true,
    duplicateNumber: true,
    paid: true,
    takenBack: true,
    credited: true,
    changed: true,
  }),
  'flash.fieldWorkRefused': valuesOf<FieldWorkRefusedError['reason']>({
    done: true,
    visitCancelled: true,
    closed: true,
    cancelled: true,
    notCancelled: true,
    notStarted: true,
    notOnVisit: true,
    wholeQuantity: true,
    notAtSite: true,
    reviewed: true,
  }),
  'flash.quoteImportRefused': valuesOf<QuoteImportRefusedError['reason']>({
    notAccepted: true,
    closed: true,
    cancelled: true,
    done: true,
    noLines: true,
    worker: true,
  }),
  'flash.supplierInvoiceLineRefused': valuesOf<LineRefusedError['reason']>({
    handled: true,
    notHandled: true,
    archivedItem: true,
    creditNote: true,
    currency: true,
    negativeTotal: true,
    receiptNotLinkable: true,
  }),
  'flash.supplierInvoiceArchivingRefused': valuesOf<ArchivingRefusedError['reason']>({
    notOffered: true,
    notWaiting: true,
  }),
  'flash.supplierInvoiceRefused': valuesOf<SupplierInvoiceRefusedError['reason']>({
    unreadable: true,
    unsupported: true,
    signature: true,
    duplicate: true,
    notForCompany: true,
  }),
  'flash.visitCancelRefused': [
    ...valuesOf<VisitCancelRefusedError['reason']>({
      closed: true,
      cancelled: true,
      notOpen: true,
      notCancelled: true,
    }),
    // The Charge refusals that stop a cancellation (visits_controller refusable())
    ...(['inDraft', 'frozen'] satisfies ChargeRefusedError['reason'][]),
  ],
  'flash.equipmentWarning': [
    ...valuesOf<EquipmentWarning['reason']>({
      left: true,
      quantity: true,
      noSite: true,
      detailsDone: true,
    }),
    // noSite, as a Technician reads it
    'noSiteTechnician',
  ],
  'errors.issuedDocuments': valuesOf<IssuingRefusedError['reason']>({
    templateArchived: true,
    alreadyReplaced: true,
  }),
  'ui.sdiFailures': SDI_FAILURE_CODES,
  'ui.jobs.leftToClose': BUILT_IN_PAGES['ui.jobs.leftToClose'],
  'ui.paymentMethods': PAYMENT_METHODS,
  'documents.invoice.sections': SECTION_KINDS,
  'documents.workReport': valuesOf<keyof WorkReportLabels>({
    date: true,
    technicians: true,
    description: true,
    quantity: true,
    unitPrice: true,
    amount: true,
    notes: true,
    notBilled: true,
    jobCharges: true,
    total: true,
    visitsTotal: true,
  }),
  'documents.supplierInvoiceExport.columns': EXPORT_COLUMNS,
  'documents.supplierInvoiceExport.receivedVia': SUPPLIER_INVOICE_SOURCES,
}

/** Prefixes the server builds from values no list holds, so not checked here. */
const NOT_CHECKED_ON_SERVER: Record<string, string> = {
  'errors.templateData': 'reasons passed as plain strings to fail() in the template data service',
}

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

/** The .vue and .ts files under `directories`. */
async function sources(directories: string[]): Promise<string[]> {
  const files = await Promise.all(
    directories.map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true })
      return Promise.all(
        entries.map((entry) => {
          const path = join(directory, entry.name)
          if (entry.isDirectory()) return sources([path])
          return /\.(vue|ts)$/.test(entry.name) ? [path] : []
        })
      )
    })
  )
  return files.flat(2)
}

/** The pages and the modules they share with the server; the server. */
const PAGES = ['inertia', 'shared']
const SERVER = ['app', 'start']

async function matchesInSources(pattern: RegExp, directories = PAGES) {
  const found: { key: string; text: string; file: string }[] = []
  for (const file of await sources(directories.map((directory) => app.makePath(directory)))) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      found.push({ key: match.at(-1)!, text: match[0], file: relative(app.makePath(), file) })
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
      /(?:\bt\(\s*)?(['`])((?:documents|errors|flash|ui|validator)\.[a-zA-Z0-9_.]*[a-zA-Z0-9_])\1/g
    )
    // A comment may name a group of keys (`ui.sdiFailures`); t() never takes one
    const groups = new Set(
      [...keys].flatMap((key) => key.split('.').map((_, i, parts) => parts.slice(0, i).join('.')))
    )
    const named = ({ key, text }: { key: string; text: string }) =>
      keys.has(key) || (groups.has(key) && !text.startsWith('t('))

    assert.isAbove(written.length, 100)
    assert.deepEqual(
      written.filter((found) => !named(found)).map(({ key, file }) => `${key} (${file})`),
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

  test('every key the server builds at run time has its values listed', async ({ assert }) => {
    const built = await matchesInSources(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g, SERVER)

    assert.isAbove(built.length, 10)
    assert.deepEqual(
      built
        .filter(({ key }) => !(key in BUILT_ON_SERVER) && !(key in NOT_CHECKED_ON_SERVER))
        .map(({ key, file }) => `${key} (${file})`),
      []
    )
  })

  test('keys built at run time exist for every value', async ({ assert }) => {
    const keys = await catalogue()
    const built = [BUILT_IN_PAGES, BUILT_ON_SERVER].flatMap((lists) =>
      Object.entries(lists).flatMap(([prefix, values]) =>
        values.map((value) => `${prefix}.${value}`)
      )
    )

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

    // A made-up rule, so no catalogue message can ever exist for it
    const madeUp = vine.createRule((_value, _options, field) => {
      field.report('Made up', 'madeUpRule', field)
    })
    const noMessage = vine.create({ email: vine.string().use(madeUp()) })
    await assert.rejects(
      () => noMessage.validate({ email: 'a' }, { messagesProvider }),
      'Missing validation message: email.madeUpRule'
    )

    // A message naming a field the catalogue doesn't
    const noField = vine.create({ notInTheCatalogue: vine.string() })
    await assert.rejects(
      () => noField.validate({}, { messagesProvider }),
      'Missing validation field name: notInTheCatalogue'
    )
  })

  test('a refused sameAs leaves the validator comparing the same field', async ({ assert }) => {
    // VineJS builds a rule's options once per validator; translating the other
    // field's name in place would make every later matching value fail. Not
    // strict, as in production.
    const validator = vine.create({
      backupPassphrase: vine.string(),
      backupPassphraseConfirmation: vine.string().sameAs('backupPassphrase'),
    })
    const messagesProvider = validationMessages(i18nManager.locale('it'), { strict: false })

    await assert.rejects(() =>
      validator.validate(
        { backupPassphrase: 'one', backupPassphraseConfirmation: 'two' },
        { messagesProvider }
      )
    )
    const matching = { backupPassphrase: 'one', backupPassphraseConfirmation: 'one' }
    assert.deepEqual(await validator.validate(matching, { messagesProvider }), matching)
  })
})
